'use client'
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { extractTitle } from "@/lib/markdown"
import { getFilePathOptions, getWorkspacePath, getGenericPathOptions } from "@/lib/workspace"
import useTagStore from "@/stores/tag"
import { CheckedState } from "@radix-ui/react-checkbox"
import { BaseDirectory, readDir, writeTextFile } from "@tauri-apps/plugin-fs"
import { Store } from "@tauri-apps/plugin-store"
import { SquarePen, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Chat } from "@/db/chats"
import { useTranslations } from "next-intl"
import useArticleStore from "@/stores/article"
import useBrowserStore from "@/stores/browser"
import { toast } from "@/hooks/use-toast"

export function NoteOutput({chat}: {chat: Chat}) {
  const { deleteTag, currentTagId } = useTagStore()
  const { loadFileTree } = useArticleStore()
  const { workspaceMode } = useBrowserStore()
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('')
  const [path, setPath] = useState('/')
  const [folders, setFolders] = useState<string[]>([])
  const [isRemove, setIsRemove] = useState<CheckedState>(true)
  const t = useTranslations('record.chat')

  async function handleTransform() {
    const content = chat?.content || ''
    // 统一处理：将空格替换为下划线，确保本地和远程文件名一致
    const sanitizedTitle = title.replace(/\s+/g, '_')
    const writePath = `${path}/${sanitizedTitle}`

    // Use workspace functions instead of directly using BaseDirectory.AppData
    const pathOptions = await getFilePathOptions(writePath)
    try {
      if (pathOptions.baseDir) {
        await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
      } else {
        // Handle custom workspace (direct path, no baseDir)
        await writeTextFile(pathOptions.path, content)
      }
    } catch (err) {
      toast({
        title: '儲存失敗',
        description: (err as Error)?.message ?? String(err),
        variant: 'destructive',
      })
      return
    }

    const store = await Store.load('store.json');
    await store.set('activeFilePath', title)
    if (isRemove) {
      deleteTag(currentTagId)
    }
    setOpen(false)
    await loadFileTree()

    // 寫完顯示 toast。Browser 模式下保持原位 (使用者還在看網頁/對話)，notes 模式維持原本
    // 「跳到剛存的筆記」直覺路徑 — 這在「整理筆記後想立刻看結果」場景比較順手。
    toast({
      title: '已存為筆記',
      description: `${path === '/' ? '' : path + '/'}${sanitizedTitle}`,
    })
    if (workspaceMode === 'notes') {
      window.location.href = '/core/article'
    }
  }

  async function readArticleDir() {
    const workspace = await getWorkspacePath()
    let folders = []
    
    if (workspace.isCustom) {
      const pathOptions = await getGenericPathOptions('', '')
      const dirs = (await readDir(pathOptions.path)).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    } else {
      const dirs = (await readDir('article', { baseDir: BaseDirectory.AppData })).filter(dir => dir.isDirectory).map(dir => `/${dir.name}`)
      folders = dirs
    }
    
    setFolders(folders)
  }

  useEffect(() => {
    setIsRemove(chat?.tagId !== 1)
    setTitle(extractTitle(chat?.content || '') + '.md')
    readArticleDir()
  }, [chat])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <a className="cursor-pointer flex items-center gap-1 hover:underline">
          <SquarePen className="size-4" />
        </a>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>{t('note.convert')}</DialogTitle>
          <DialogDescription>
            {t('note.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 mt-2">
          <Label>{t('note.filename')}</Label>
          <div className="flex border rounded-lg">
            <Select value={path} onValueChange={setPath}>
              <SelectTrigger className="w-[180px] border-none outline-none">
                <SelectValue placeholder={t('note.selectFolder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="/">{t('note.rootDirectory')}</SelectItem>
                  {
                    folders.map((folder, index) => {
                      return <SelectItem key={index} value={folder}>{folder}</SelectItem>
                    })
                  }
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input className="border-none" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <Checkbox disabled={chat?.tagId === 1} id="terms" checked={isRemove} onCheckedChange={value => setIsRemove(value)} />
            <label
              htmlFor="terms"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {t('note.deleteTag')}
            </label>
          </div>
        </div>
        <DialogFooter>
          <div className="flex items-center justify-end gap-2 pt-4">
            <p className="text-xs text-zinc-400 flex items-center gap-1"><TriangleAlert className="size-4" />{t('note.warning')}</p>
            <Button type="submit" onClick={handleTransform}>{t('note.convert_button')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}