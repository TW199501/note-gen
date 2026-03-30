"use client"

import { useState, useCallback } from "react"
import { useTranslations } from "next-intl"
import useArticleStore, { DirTree } from "@/stores/article"
import { fetchAi } from "@/lib/ai/chat"
import { getAISettings } from "@/lib/ai/utils"
import { readTextFile, rename, mkdir, exists } from "@tauri-apps/plugin-fs"
import { getFilePathOptions, getWorkspacePath } from "@/lib/workspace"
import { toast } from "@/hooks/use-toast"
import { computedParentPath } from "@/lib/path"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Loader2, FolderOpen, FileText, ChevronDown, ChevronRight, ArrowRight, Pencil } from "lucide-react"

interface FileClassification {
  fileName: string
  folder: string
  newFileName: string
  reason: string
}

interface OrganizeFilesProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function OrganizeFiles({ open, onOpenChange }: OrganizeFilesProps) {
  const t = useTranslations('article.file.organize')
  const { fileTree, loadFileTree } = useArticleStore()
  const [loading, setLoading] = useState(false)
  const [moving, setMoving] = useState(false)
  const [classifications, setClassifications] = useState<FileClassification[]>([])
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [renameEnabled, setRenameEnabled] = useState<Set<string>>(new Set())
  const [step, setStep] = useState<'idle' | 'analyzing' | 'review' | 'applying'>('idle')
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

  const getRootFiles = useCallback((): DirTree[] => {
    return fileTree.filter(item => item.isFile && item.isLocale && item.name.endsWith('.md'))
  }, [fileTree])

  const getExistingFolders = useCallback((): string[] => {
    return fileTree
      .filter(item => item.isDirectory && item.isLocale)
      .map(item => item.name)
  }, [fileTree])

  const readFilePreview = useCallback(async (relativePath: string): Promise<string> => {
    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(relativePath)
      let content: string
      if (workspace.isCustom) {
        content = await readTextFile(pathOptions.path)
      } else {
        content = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
      return content.substring(0, 500)
    } catch {
      return ''
    }
  }, [])

  const handleAnalyze = useCallback(async () => {
    const organizeConfig = await getAISettings('organizeModel')
    if (!organizeConfig) {
      toast({
        title: t('noModel'),
        description: t('noModelDesc'),
        variant: 'destructive',
      })
      return
    }

    const rootFiles = getRootFiles()
    if (rootFiles.length === 0) {
      toast({ description: t('noFiles') })
      return
    }

    setStep('analyzing')
    setLoading(true)
    setClassifications([])

    try {
      const existingFolders = getExistingFolders()

      const filePreviews = await Promise.all(
        rootFiles.map(async (file) => {
          const path = computedParentPath(file)
          const preview = await readFilePreview(path)
          return { name: file.name, preview }
        })
      )

      const prompt = `You are a note organizer. Analyze the following markdown files and suggest folder classifications AND better file names for each.

Existing folders: ${existingFolders.length > 0 ? existingFolders.join(', ') : 'None'}

Files to classify:
${filePreviews.map((f, i) => `--- File ${i + 1}: ${f.name} ---
${f.preview}
---`).join('\n\n')}

Rules:
1. Prefer using existing folders when appropriate
2. Create new folder names only when no existing folder fits
3. Folder names should be short, clear, and in the same language as the content
4. Each file must be assigned to exactly one folder
5. Create 3-8 distinct categories. Avoid putting too many files into one folder - aim for balanced distribution
6. Classify by specific topic/domain rather than one broad category
7. If a file doesn't clearly fit any specific category, use a general folder
8. For newFileName: suggest a better, more descriptive filename based on the file content. Keep the .md extension. Use the same language as the content. If the current name is already good, use the same name
9. newFileName must be a valid filename (no slashes, no special chars like :*?"<>|)
10. Reason should be concise, under 15 characters

Return ONLY a valid JSON array with this format, no other text:
[{"fileName":"original.md","folder":"folder-name","newFileName":"better-name.md","reason":"brief reason"}]`

      const result = await fetchAi(prompt, 'organizeModel')

      const jsonMatch = result.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        toast({ description: t('analyzeError'), variant: 'destructive' })
        setStep('idle')
        setLoading(false)
        return
      }

      const parsed: FileClassification[] = JSON.parse(jsonMatch[0])
      setClassifications(parsed)
      setSelectedFiles(new Set(parsed.map(c => c.fileName)))

      const autoRename = new Set<string>()
      parsed.forEach(c => {
        if (c.newFileName && c.newFileName !== c.fileName) {
          autoRename.add(c.fileName)
        }
      })
      setRenameEnabled(autoRename)

      setStep('review')
    } catch (error) {
      console.error('Analyze error:', error)
      toast({
        description: t('analyzeError'),
        variant: 'destructive',
      })
      setStep('idle')
    } finally {
      setLoading(false)
    }
  }, [getRootFiles, getExistingFolders, readFilePreview, t])

  const handleApply = useCallback(async () => {
    const toApply = classifications.filter(c => selectedFiles.has(c.fileName))
    if (toApply.length === 0) return

    setStep('applying')
    setMoving(true)

    try {
      const workspace = await getWorkspacePath()
      const foldersToCreate = new Set(toApply.map(c => c.folder))

      for (const folder of foldersToCreate) {
        const folderPathOptions = await getFilePathOptions(folder)
        const folderExists = workspace.isCustom
          ? await exists(folderPathOptions.path)
          : await exists(folderPathOptions.path, { baseDir: folderPathOptions.baseDir })

        if (!folderExists) {
          if (workspace.isCustom) {
            await mkdir(folderPathOptions.path)
          } else {
            await mkdir(folderPathOptions.path, { baseDir: folderPathOptions.baseDir })
          }
        }
      }

      let movedCount = 0
      for (const item of toApply) {
        try {
          const oldPath = item.fileName
          const shouldRename = renameEnabled.has(item.fileName) && item.newFileName && item.newFileName !== item.fileName
          const targetFileName = shouldRename ? item.newFileName : item.fileName
          const newPath = `${item.folder}/${targetFileName}`

          const oldPathOptions = await getFilePathOptions(oldPath)
          const newPathOptions = await getFilePathOptions(newPath)

          if (workspace.isCustom) {
            await rename(oldPathOptions.path, newPathOptions.path)
          } else {
            await rename(oldPathOptions.path, newPathOptions.path, {
              newPathBaseDir: (await import('@tauri-apps/plugin-fs')).BaseDirectory.AppData,
              oldPathBaseDir: (await import('@tauri-apps/plugin-fs')).BaseDirectory.AppData,
            })
          }
          movedCount++
        } catch (err) {
          console.error(`Failed to move ${item.fileName}:`, err)
        }
      }

      await loadFileTree()

      toast({
        description: t('applySuccess', { count: movedCount }),
      })

      setStep('idle')
      setClassifications([])
      setSelectedFiles(new Set())
      setRenameEnabled(new Set())
      onOpenChange(false)
    } catch (error) {
      console.error('Apply error:', error)
      toast({
        description: t('applyError'),
        variant: 'destructive',
      })
      setStep('review')
    } finally {
      setMoving(false)
    }
  }, [classifications, selectedFiles, renameEnabled, loadFileTree, onOpenChange, t])

  const toggleFile = useCallback((fileName: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      if (next.has(fileName)) {
        next.delete(fileName)
      } else {
        next.add(fileName)
      }
      return next
    })
  }, [])

  const toggleRename = useCallback((fileName: string) => {
    setRenameEnabled(prev => {
      const next = new Set(prev)
      if (next.has(fileName)) {
        next.delete(fileName)
      } else {
        next.add(fileName)
      }
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    if (selectedFiles.size === classifications.length) {
      setSelectedFiles(new Set())
    } else {
      setSelectedFiles(new Set(classifications.map(c => c.fileName)))
    }
  }, [selectedFiles.size, classifications])

  const toggleFolder = useCallback((folder: string) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folder)) {
        next.delete(folder)
      } else {
        next.add(folder)
      }
      return next
    })
  }, [])

  const toggleFolderFiles = useCallback((folder: string, files: FileClassification[]) => {
    setSelectedFiles(prev => {
      const next = new Set(prev)
      const allSelected = files.every(f => next.has(f.fileName))
      files.forEach(f => {
        if (allSelected) {
          next.delete(f.fileName)
        } else {
          next.add(f.fileName)
        }
      })
      return next
    })
  }, [])

  const handleClose = useCallback(() => {
    if (loading || moving) return
    setStep('idle')
    setClassifications([])
    setSelectedFiles(new Set())
    setRenameEnabled(new Set())
    onOpenChange(false)
  }, [loading, moving, onOpenChange])

  const rootFileCount = getRootFiles().length
  const renameCount = classifications.filter(c => c.newFileName && c.newFileName !== c.fileName).length

  const folderGroups = classifications.reduce<Record<string, FileClassification[]>>((acc, c) => {
    if (!acc[c.folder]) acc[c.folder] = []
    acc[c.folder].push(c)
    return acc
  }, {})

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {step === 'idle' && t('desc', { count: rootFileCount })}
            {step === 'analyzing' && t('analyzing')}
            {step === 'review' && t('reviewDesc', { count: classifications.length })}
            {step === 'applying' && t('applying')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {step === 'review' && classifications.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={toggleAll}>
                  {selectedFiles.size === classifications.length ? t('deselectAll') : t('selectAll')}
                </Button>
                {renameCount > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Pencil className="w-3 h-3" />
                    {t('renameCount', { count: renameCount })}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {t('selected', { count: selectedFiles.size, total: classifications.length })}
              </span>
            </div>
            <ScrollArea className="max-h-[60vh] rounded-md border">
              <div className="p-2">
                {Object.entries(folderGroups).map(([folder, files]) => {
                  const isCollapsed = collapsedFolders.has(folder)
                  const folderSelectedCount = files.filter(f => selectedFiles.has(f.fileName)).length
                  const allSelected = folderSelectedCount === files.length

                  return (
                    <div key={folder} className="mb-2">
                      <div
                        className="flex items-center gap-1.5 py-1.5 px-1 rounded hover:bg-muted/50 cursor-pointer select-none"
                        onClick={() => toggleFolder(folder)}
                      >
                        {isCollapsed
                          ? <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        }
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() => toggleFolderFiles(folder, files)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />
                        <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{folder}</span>
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 shrink-0">
                          {folderSelectedCount}/{files.length}
                        </Badge>
                      </div>

                      {!isCollapsed && (
                        <div className="pl-8 space-y-0.5 mt-0.5">
                          {files.map((item) => {
                            const hasNewName = item.newFileName && item.newFileName !== item.fileName
                            const isRenaming = hasNewName && renameEnabled.has(item.fileName)

                            return (
                              <div key={item.fileName} className="flex items-start gap-2 hover:bg-muted/50 rounded px-1.5 py-1.5">
                                <Checkbox
                                  checked={selectedFiles.has(item.fileName)}
                                  onCheckedChange={() => toggleFile(item.fileName)}
                                  className="shrink-0 mt-0.5"
                                />
                                <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1">
                                    <span className={`text-sm break-all ${isRenaming ? 'line-through text-muted-foreground' : ''}`}>
                                      {item.fileName}
                                    </span>
                                    {hasNewName && (
                                      <button
                                        className={`p-0.5 rounded shrink-0 transition-colors ${isRenaming ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground'}`}
                                        onClick={() => toggleRename(item.fileName)}
                                        title={isRenaming ? t('disableRename') : t('enableRename')}
                                      >
                                        <Pencil className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                  {isRenaming && (
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <ArrowRight className="w-3 h-3 shrink-0 text-primary" />
                                      <span className="text-sm break-all text-primary font-medium">
                                        {item.newFileName}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        <AlertDialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading || moving}>
            {t('cancel')}
          </Button>
          {step === 'idle' && (
            <Button onClick={handleAnalyze} disabled={rootFileCount === 0}>
              {t('startAnalyze')}
            </Button>
          )}
          {step === 'analyzing' && (
            <Button disabled>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              {t('analyzing')}
            </Button>
          )}
          {step === 'review' && (
            <>
              <Button variant="secondary" onClick={handleAnalyze}>
                {t('reAnalyze')}
              </Button>
              <Button onClick={handleApply} disabled={selectedFiles.size === 0 || moving}>
                {moving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {t('apply', { count: selectedFiles.size })}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
