"use client"

import { TooltipButton } from "@/components/tooltip-button"
import { FilePlus, FolderPlus, FolderInput, LoaderCircle, Sparkles } from "lucide-react"
import { useTranslations } from "next-intl"
import * as React from "react"
import useArticleStore from "@/stores/article"
import { debounce } from "lodash-es"
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readDir, copyFile, mkdir, exists } from '@tauri-apps/plugin-fs'
import { join } from '@tauri-apps/api/path'
import { getWorkspacePath } from '@/lib/workspace'
import { toast } from '@/hooks/use-toast'
import { OrganizeFiles } from './organize-files'

export function FileActions() {
  const { newFolder, newFile, loadFileTree } = useArticleStore()
  const t = useTranslations('article.file.toolbar')
  const [isImporting, setIsImporting] = React.useState(false)
  const [organizeOpen, setOrganizeOpen] = React.useState(false)

  const debounceNewFile = debounce(newFile, 200)
  const debounceNewFolder = debounce(newFolder, 200)

  // 遞迴複製資料夾中的所有 markdown 檔案和圖片
  async function copyMarkdownFilesRecursively(
    sourceDir: string,
    targetDir: string,
    relativePath: string = ''
  ): Promise<number> {
    let copiedCount = 0
    
    try {
      const entries = await readDir(sourceDir)
      
      for (const entry of entries) {
        // 跳過隱藏檔案和資料夾
        if (entry.name.startsWith('.')) {
          continue
        }
        
        const sourcePath = await join(sourceDir, entry.name)
        const newRelativePath = relativePath ? await join(relativePath, entry.name) : entry.name
        const targetPath = await join(targetDir, newRelativePath)
        
        if (entry.isDirectory) {
          // 遞迴處理子資料夾
          const subDirCopied = await copyMarkdownFilesRecursively(
            sourcePath,
            targetDir,
            newRelativePath
          )
          copiedCount += subDirCopied
        } else if (entry.isFile) {
          // 檢查是否是 markdown 檔案或圖片檔案
          const isMd = entry.name.endsWith('.md')
          const isImage = /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(entry.name)
          
          if (isMd || isImage) {
            // 確保目標資料夾存在
            const targetDirPath = relativePath ? await join(targetDir, relativePath) : targetDir
            if (!(await exists(targetDirPath))) {
              await mkdir(targetDirPath, { recursive: true })
            }
            
            // 複製檔案
            await copyFile(sourcePath, targetPath)
            copiedCount++
          }
        }
      }
    } catch (error) {
      console.error('Error copying files:', error)
      throw error
    }
    
    return copiedCount
  }

  async function handleImportMarkdown() {
    try {
      setIsImporting(true)
      
      // 開啟資料夾選擇對話方塊
      const selectedPath = await openDialog({
        directory: true,
        multiple: false,
        title: t('importMarkdown')
      })
      
      if (!selectedPath) {
        setIsImporting(false)
        return
      }
      
      // 獲取工作區路徑
      const workspace = await getWorkspacePath()
      const targetDir = workspace.isCustom ? workspace.path : await join(await import('@tauri-apps/api/path').then(m => m.appDataDir()), 'article')
      
      // 遞迴複製所有 markdown 檔案和圖片
      const copiedCount = await copyMarkdownFilesRecursively(selectedPath as string, targetDir)
      
      // 重新整理檔案樹
      await loadFileTree()
      
      // 顯示成功提示
      toast({
        title: t('importSuccess'),
        description: t('importSuccessDesc', { count: copiedCount })
      })
    } catch (error) {
      console.error('Import markdown error:', error)
      toast({
        title: t('importError'),
        description: String(error),
        variant: 'destructive'
      })
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <TooltipButton 
        icon={<FilePlus className="h-4 w-4" />} 
        tooltipText={t('newArticle')} 
        onClick={debounceNewFile}
        side="bottom"
      />
      <TooltipButton 
        icon={<FolderPlus className="h-4 w-4" />} 
        tooltipText={t('newFolder')} 
        onClick={debounceNewFolder}
        side="bottom"
      />
      <TooltipButton 
        icon={isImporting ? <LoaderCircle className="animate-spin h-4 w-4" /> : <FolderInput className="h-4 w-4" />} 
        tooltipText={isImporting ? t('importing') : t('importMarkdown')} 
        onClick={handleImportMarkdown}
        disabled={isImporting}
        side="bottom"
      />
      <TooltipButton 
        icon={<Sparkles className="h-4 w-4" />} 
        tooltipText={t('organizeFiles')} 
        onClick={() => setOrganizeOpen(true)}
        side="bottom"
      />
      <OrganizeFiles open={organizeOpen} onOpenChange={setOrganizeOpen} />
    </div>
  )
}
