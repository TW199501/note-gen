import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, ContextMenuShortcut } from "@/components/ui/enhanced-context-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import useArticleStore, { DirTree } from "@/stores/article";
import { BaseDirectory, exists, readTextFile, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, Database, File, FileDown, FileUp, FolderOpen, ImageIcon, LoaderCircle, RefreshCwOff, Trash2 } from "lucide-react"
import { useEffect, useRef, useState, useCallback } from "react";
import { ask } from '@tauri-apps/plugin-dialog';
import { platform } from '@tauri-apps/plugin-os';
import { Store } from '@tauri-apps/plugin-store';
import { RepoNames } from "@/lib/sync/github.types";
import { S3Config, WebDAVConfig } from "@/types/sync";
import { cloneDeep } from "lodash-es";
import { openPath } from "@tauri-apps/plugin-opener";
import { computedParentPath, getCurrentFolder } from "@/lib/path";
import { toast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import useClipboardStore from "@/stores/clipboard";
import { appDataDir, join } from '@tauri-apps/api/path';
import { deleteFile } from "@/lib/sync/github";
import { deleteFile as deleteGiteeFile } from "@/lib/sync/gitee";
import { deleteFile as deleteGitlabFile } from "@/lib/sync/gitlab";
import { deleteFile as deleteGiteaFile } from "@/lib/sync/gitea";
import { s3Delete } from "@/lib/sync/s3";
import { webdavDelete } from "@/lib/sync/webdav";
import { getSyncRepoName } from "@/lib/sync/repo-utils";
import { generateUniqueFilename } from "@/lib/default-filename";
import { MobileActionMenu, MobileMenuItem, MobileSeparator } from "./mobile-action-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import useSettingStore from "@/stores/setting";
import { VectorKnowledgeMenu } from "./vector-knowledge-menu";
import { isSkillsFolder } from "@/lib/skills/utils";

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

function shouldAutoSyncOnInitialRead(options?: { isNewFile?: boolean }) {
  return options?.isNewFile !== true
}

function buildFileRenamePlan({
  originalName,
  currentPath,
  enteredName,
}: {
  originalName: string
  currentPath: string
  enteredName: string
}) {
  const sanitizedName = enteredName.replace(/\s+/g, '_')
  const needsMarkdownSuffix = originalName === '' && !sanitizedName.endsWith('.md')
  const displayName = needsMarkdownSuffix ? `${sanitizedName}.md` : sanitizedName
  const parentPath = currentPath.split('/').slice(0, -1).join('/')
  const targetRelativePath = parentPath ? `${parentPath}/${displayName}` : displayName

  return {
    operation: originalName === '' ? 'create' : 'rename',
    displayName,
    targetRelativePath,
  } as const
}

export function FileItem({ item, focusSidebar }: { item: DirTree; focusSidebar?: () => void }) {
  const [isEditing, setIsEditing] = useState(item.isEditing)
  const [name, setName] = useState(item.name)
  const [isComposing, setIsComposing] = useState(false) // 追蹤輸入法合成狀態
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRef = useRef<HTMLDivElement>(null)
  const { activeFilePath, setActiveFilePath, readArticle, fileTree, setFileTree, loadFileTree, vectorIndexedFiles, checkFileVectorIndexed, cleanTabsByDeletedFile, cleanTabsByDeletedFolder } = useArticleStore()
  const setArticleState = useArticleStore.setState
  const { setClipboardItem, clipboardItem, clipboardOperation } = useClipboardStore()
  const { fileManagerTextSize } = useSettingStore()
  const t = useTranslations('article.file')
  const isMobile = useIsMobile()

  // 檢查路徑是否在 skills 資料夾下
  const isInSkillsFolder = (itemPath: string): boolean => {
    const parts = itemPath.split('/')
    return parts.some(part => isSkillsFolder(part))
  }

  const path = computedParentPath(item)

  // 當檔案成為 active 時自動滾動到可見範圍
  useEffect(() => {
    if (path === activeFilePath && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [activeFilePath, path])

  // 向量狀態更新回撥
  const handleVectorUpdated = useCallback(() => {
    checkFileVectorIndexed(path)
  }, [path, checkFileVectorIndexed])

  // 根據文字大小對映圖示大小
  const getIconSize = (textSize: string) => {
    const sizeMap = {
      'xs': 'size-3',
      'sm': 'size-3.5',
      'md': 'size-4',
      'lg': 'size-5',
      'xl': 'size-6'
    }
    return sizeMap[textSize as keyof typeof sizeMap] || 'size-4'
  }

  const iconSize = getIconSize(fileManagerTextSize)

  // 檢查檔案是否被剪下
  const isCut = clipboardOperation === 'cut' && clipboardItem?.path === path

  // 檢查檔案是否已計算向量（skills 資料夾下的檔案不顯示）
  const hasVector = item.isFile && !isInSkillsFolder(path) && vectorIndexedFiles.has(path)

  // 向量計算狀態圖示
  const renderVectorIcon = () => {
    if (isInSkillsFolder(path)) return null

    const status = item.vectorCalcStatus

    if (status === 'calculating') {
      return <LoaderCircle className={`${iconSize} mr-2 animate-spin`} />
    } else if (status === 'completed' || hasVector) {
      return <Database className={`${iconSize} text-muted-foreground mr-2 opacity-60`} />
    }
    return null
  }

  const isRoot = path.split('/').length === 1
  const folderPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
  // 不需要 cloneDeep，因為 getCurrentFolder 只讀取資料不修改
  const currentFolder = getCurrentFolder(folderPath, fileTree)

  // 最佳化的輸入處理，支援輸入法
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    // 如果正在使用輸入法合成，不進行空格替換
    if (isComposing) {
      setName(value)
      return
    }
    
    // 檢查是否包含空格，只有包含空格時才需要處理游標位置
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 保持游標位置
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [isComposing])

  // 輸入法合成開始
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true)
  }, [])

  // 輸入法合成結束，進行空格替換
  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    setIsComposing(false)
    const input = e.currentTarget
    const value = input.value
    const cursorPosition = input.selectionStart || 0
    
    // 只有當值包含空格時才需要替換和恢復游標位置
    if (value.includes(' ')) {
      const sanitizedValue = value.replace(/\s+/g, '_')
      setName(sanitizedValue)
      
      // 計算新的游標位置（空格變為下劃線，長度不變，所以位置保持不變）
      requestAnimationFrame(() => {
        if (input.selectionStart !== null) {
          input.setSelectionRange(cursorPosition, cursorPosition)
        }
      })
    } else {
      setName(value)
    }
  }, [])

  async function handleSelectFile() {
    // 讓檔案管理器獲得焦點，以便響應快捷鍵
    focusSidebar?.()
    const currentPath = computedParentPath(item)

    if (item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
      // 圖片檔案：設定 activeFilePath，讓 EditorLayout 顯示圖片編輯器
      setActiveFilePath(currentPath)
    } else if (item.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template)$/i)) {
      // Markdown/文字檔案：設定 activeFilePath
      setActiveFilePath(currentPath)

      // 檢查是否是遠端檔案
      // 讀取內容的邏輯移到 EditorLayout 中處理，避免重複渲染
    } else {
      // 其他檔案型別：設定 activeFilePath，讓 EditorLayout 顯示 UnsupportedFile 元件
      setActiveFilePath(currentPath)
    }
  }

  async function handleDeleteFile() {
    // 新增確認彈窗
    const answer = await ask(t('deleteConfirm'), {
      title: item.name,
      kind: 'warning',
    });
    // 如果使用者確認刪除，則繼續執行
    if (answer) {
      try {
        // 獲取工作區路徑資訊
        const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
        const workspace = await getWorkspacePath()

        // 使用當前路徑，而不是重新計算的路徑
        const currentPath = computedParentPath(item)

        // 根據工作區型別正確刪除檔案
        const pathOptions = await getFilePathOptions(currentPath)

        if (workspace.isCustom) {
          // 自定義工作區
          await remove(pathOptions.path)
        } else {
          // 預設工作區
          await remove(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // 更新檔案樹
        if (currentFolder) {
          const index = currentFolder.children?.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1 && currentFolder.children) {
            const current = currentFolder.children[index]
            if (current.sha) {
              // 有云端版本：只標記為非本地檔案，保留雲端檔案
              current.isLocale = false
            } else {
              // 純本地檔案：直接從檔案樹中移除
              currentFolder.children.splice(index, 1)
            }
          }
        } else {
          // 根目錄檔案：需要克隆 fileTree 來更新
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(file => file.name === item.name)
          if (index !== undefined && index !== -1) {
            const current = cacheTree[index]
            if (current.sha) {
              // 有云端版本：只標記為非本地檔案，保留雲端檔案
              current.isLocale = false
            } else {
              // 純本地檔案：直接從檔案樹中移除
              cacheTree.splice(index, 1)
            }
          }
          setFileTree(cacheTree)
        }

        // 刪除向量資料庫中的記錄
        try {
          const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
          await deleteVectorDocumentsByFilename(path)
          // 從向量索引對映中移除
          const newMap = new Map(vectorIndexedFiles)
          newMap.delete(path)
          setArticleState({ vectorIndexedFiles: newMap })
        } catch (error) {
          console.error(`刪除檔案 ${item.name} 的向量資料失敗:`, error)
        }

        // 清理已被刪除的檔案對應的 tabs（包括自動選擇其他 tab）
        await cleanTabsByDeletedFile(currentPath)
      } catch (error) {
        console.error('Delete file failed:', error)
        toast({
          title: t('context.deleteLocalFile'),
          description: '刪除檔案失敗: ' + error,
          variant: 'destructive'
        })
      }
    }
  }

  async function handleDeleteSyncFile() {
    const answer = await ask(t('context.deleteSyncFile') + '?', {
      title: item.name,
      kind: 'warning',
    });
    if (answer) {
      const currentPath = computedParentPath(item)

      // 設定 loading 狀態
      const cacheTree = cloneDeep(fileTree)
      const setLoadingStatus = (items: typeof cacheTree): boolean => {
        for (const entry of items) {
          const entryPath = computedParentPath(entry)
          if (entryPath === currentPath && entry.isFile) {
            entry.loading = true
            return true
          }
          if (entry.children && setLoadingStatus(entry.children)) {
            return true
          }
        }
        return false
      }
      if (setLoadingStatus(cacheTree)) {
        setFileTree(cacheTree)
      }

      try {
        // 獲取當前主要備份方式
        const store = await Store.load('store.json');
        const backupMethod = await store.get<'github' | 'gitee' | 'gitlab' | 'gitea' | 's3' | 'webdav'>('primaryBackupMethod') || 'github';
        const repoName = backupMethod === 's3' || backupMethod === 'webdav'
          ? RepoNames.sync
          : await getSyncRepoName(backupMethod)

        let success = false
        switch (backupMethod) {
          case 'github': {
            const result = await deleteFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitee': {
            const result = await deleteGiteeFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = result !== false
            break;
          }
          case 'gitlab': {
            const result = await deleteGitlabFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 'gitea': {
            const result = await deleteGiteaFile({ path: currentPath, sha: item.sha as string, repo: repoName });
            success = !!result
            break;
          }
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              const result = await s3Delete(s3Config, currentPath)
              success = result
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              const result = await webdavDelete(webdavConfig, currentPath)
              success = result
            }
            break;
          }
        }

        if (success) {
          // 只更新當前檔案的狀態，不重新整理整個檔案樹
          const cacheTree = cloneDeep(fileTree)

          // 遞迴查詢並更新/刪除檔案
          const updateOrRemoveFile = (items: typeof cacheTree): boolean => {
            for (let i = 0; i < items.length; i++) {
              const entry = items[i]
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                if (entry.isLocale) {
                  // 本地存在：只清除遠端 SHA
                  entry.sha = undefined
                  entry.loading = undefined
                } else {
                  // 本地不存在：從列表中移除
                  items.splice(i, 1)
                }
                return true
              }
              if (entry.children && updateOrRemoveFile(entry.children)) {
                return true
              }
            }
            return false
          }

          if (updateOrRemoveFile(cacheTree)) {
            setFileTree(cacheTree)
          }

          toast({
            title: t('context.delete'),
            description: t('context.deleteSyncFileSuccess'),
          });
        } else {
          // 刪除失敗，清除 loading 狀態
          const cacheTree = cloneDeep(fileTree)
          const clearLoadingStatus = (items: typeof cacheTree): boolean => {
            for (const entry of items) {
              const entryPath = computedParentPath(entry)
              if (entryPath === currentPath && entry.isFile) {
                entry.loading = undefined
                return true
              }
              if (entry.children && clearLoadingStatus(entry.children)) {
                return true
              }
            }
            return false
          }
          if (clearLoadingStatus(cacheTree)) {
            setFileTree(cacheTree)
          }
          throw new Error('刪除操作返回失敗')
        }
      } catch (error) {
        // 刪除失敗，清除 loading 狀態
        const cacheTree = cloneDeep(fileTree)
        const clearLoadingStatus = (items: typeof cacheTree): boolean => {
          for (const entry of items) {
            const entryPath = computedParentPath(entry)
            if (entryPath === currentPath && entry.isFile) {
              entry.loading = undefined
              return true
            }
            if (entry.children && clearLoadingStatus(entry.children)) {
              return true
            }
          }
          return false
        }
        if (clearLoadingStatus(cacheTree)) {
          setFileTree(cacheTree)
        }
        console.error('[handleDeleteSyncFile] 刪除遠端檔案失敗:', error);
        toast({
          title: t('context.delete'),
          description: t('context.deleteSyncFileError'),
          variant: 'destructive',
        });
      }
    }
  }

  async function handleStartRename() {
    // 延遲執行，確保上下文選單完全關閉
    setTimeout(() => {
      setIsEditing(true)
      setTimeout(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          // 只選中檔名，不包含副檔名
          const lastDotIndex = item.name.lastIndexOf('.')
          if (lastDotIndex > 0) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
    }, 300)
  }

  async function handleRename() {
    // 獲取工作區路徑資訊
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    const originalName = item.name
    const nextTree = cloneDeep(fileTree)
    const nextFolder = getCurrentFolder(folderPath, nextTree)
    
    let finalName = name
    
    // 如果輸入為空字串，生成預設檔名
    if (!name || name.trim() === '') {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''
      finalName = await generateUniqueFilename(parentPath)
      setName(finalName)
    } else {
      // 統一處理：將空格替換為下劃線，確保本地和遠端檔名一致
      finalName = name.replace(/\s+/g, '_')
      setName(finalName)
    }
  
    if (finalName && finalName.trim() !== '' && finalName !== originalName) {
      const renamePlan = buildFileRenamePlan({
        originalName,
        currentPath: path,
        enteredName: finalName,
      })
      const { displayName, operation, targetRelativePath } = renamePlan
      
      // 更新快取樹中的名稱
      if (nextFolder && nextFolder.children) {
        const fileIndex = nextFolder?.children?.findIndex(file => file.name === originalName)
        if (fileIndex !== undefined && fileIndex !== -1) {
          nextFolder.children[fileIndex].name = displayName
          nextFolder.children[fileIndex].isEditing = false
        }
      } else {
        const fileIndex = nextTree.findIndex(file => file.name === originalName)
        if (fileIndex !== -1 && fileIndex !== undefined) {
          nextTree[fileIndex].name = displayName
          nextTree[fileIndex].isEditing = false
        }
      }
      setFileTree(nextTree)
      
      // 確定是重新命名現有檔案還是建立新檔案
      if (operation === 'rename') {
        // 重新命名現有檔案
        // 獲取源路徑和目標路徑
        const oldPathOptions = await getFilePathOptions(path)
        const newPathOptions = await getFilePathOptions(targetRelativePath)
        
        // 根據工作區型別執行重新命名操作
        if (workspace.isCustom) {
          await rename(oldPathOptions.path, newPathOptions.path)
        } else {
          await rename(oldPathOptions.path, newPathOptions.path, { 
            newPathBaseDir: BaseDirectory.AppData, 
            oldPathBaseDir: BaseDirectory.AppData 
          })
        }
      } else {
        // 建立新檔案
        const pathOptions = await getFilePathOptions(targetRelativePath)
        
        // 檢查檔案是否已存在
        let isExists = false
        if (workspace.isCustom) {
          isExists = await exists(pathOptions.path)
        } else {
          isExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
        
        if (isExists) {
          toast({ title: '檔名已存在' })
          setTimeout(() => inputRef.current?.focus(), 300);
          return
        } else {
          // 建立新檔案
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
        }
      }
      
      // 構建新檔案的完整路徑用於啟用檔案
      let newPath = targetRelativePath
      // 判斷 newPath 是否以 / 開頭
      if (newPath.startsWith('/')) {
        newPath = newPath.slice(1)
      }
      setActiveFilePath(newPath)
      // 新建檔案後自動選擇該檔案並讀取內容
      readArticle(newPath, '', shouldAutoSyncOnInitialRead({ isNewFile: true }))
    } else {
      // 處理取消建立或無變更的情況
      if (originalName === '') {
        // 只有當原檔名為空（新建檔案）時才刪除列表項
        if (currentFolder && currentFolder.children) {
          const index = currentFolder?.children?.findIndex(item => item.name === '')
          if (index !== undefined && index !== -1 && currentFolder?.children) {
            currentFolder?.children?.splice(index, 1)
          }
          setFileTree(fileTree)
        } else {
          // 根目錄檔案：需要克隆 fileTree 來更新
          const cacheTree = cloneDeep(fileTree)
          const index = cacheTree.findIndex(item => item.name === '')
          if (index !== -1) {
            cacheTree.splice(index, 1)
          }
          setFileTree(cacheTree)
        }
      } else {
        // 對於重新命名現有檔案，如果沒有輸入新名稱，則保持原狀態
        if (currentFolder && currentFolder.children) {
          const fileIndex = currentFolder?.children?.findIndex(file => file.name === item.name)
          if (fileIndex !== undefined && fileIndex !== -1) {
            currentFolder.children[fileIndex].isEditing = false
          }
          setFileTree(fileTree)
        } else {
          // 根目錄檔案：需要克隆 fileTree 來更新
          const cacheTree = cloneDeep(fileTree)
          const fileIndex = cacheTree.findIndex(file => file.name === item.name)
          if (fileIndex !== -1 && fileIndex !== undefined) {
            cacheTree[fileIndex].isEditing = false
          }
          setFileTree(cacheTree)
        }
      }
    }

    setIsEditing(false)
  }

  async function handleShowFileManager() {
    // 獲取工作區路徑資訊
    const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
    const workspace = await getWorkspacePath()
    
    // 確定檔案所在的目錄路徑
    const folderPath = item.parent ? computedParentPath(item.parent) : ''
    
    // 根據工作區型別確定正確的路徑
    if (workspace.isCustom) {
      // 自定義工作區 - 直接使用工作區路徑
      const pathOptions = await getFilePathOptions(folderPath)
      openPath(pathOptions.path)
    } else {
      // 預設工作區 - 使用 AppData 目錄
      const appDir = await appDataDir()
      openPath(await join(appDir, 'article', folderPath))
    }
  }

  async function handleDragStart(ev: React.DragEvent<HTMLDivElement>) {
    ev.dataTransfer.setData('text', path)
  }

  async function handleCopyFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'copy')
    toast({ title: t('clipboard.copied') })
  }

  async function handleCutFile() {
    setClipboardItem({
      path,
      name: item.name,
      isDirectory: false,
      sha: item.sha,
      isLocale: item.isLocale
    }, 'cut')
    toast({ title: t('clipboard.cut') })
  }

  async function handlePasteFile() {
    if (!clipboardItem) {
      toast({ title: t('clipboard.empty'), variant: 'destructive' })
      return
    }

    try {
      const { getFilePathOptions, getWorkspacePath } = await import('@/lib/workspace')
      const workspace = await getWorkspacePath()

      // 貼上目標：檔案所在的目錄（同級貼上）
      const targetDir = path.includes('/') ? path.split('/').slice(0, -1).join('/') : ''

      // 檢查是否會造成迴圈巢狀
      if (clipboardItem.isDirectory) {
        // 檢查是否貼上到其子資料夾內部（targetDir 以 clipboardItem.path/ 開頭）
        // 注意：允許貼上到自身內部（targetDir === clipboardItem.path），但需要特殊處理避免迴圈
        if (targetDir.startsWith(clipboardItem.path + '/')) {
          toast({ title: '無法將父資料夾貼上到其子資料夾內部', variant: 'destructive' })
          return
        }
      }

      if (clipboardItem.isDirectory) {
        // 貼上資料夾
        const { generateCopyFoldername } = await import('@/lib/default-filename')
        const { mkdir, readDir } = await import('@tauri-apps/plugin-fs')

        const targetName = await generateCopyFoldername(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${targetName}` : targetName
        const targetPathOptions = await getFilePathOptions(targetPathRelative)
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)

        // 檢查是否是貼上到自身內部（需要避免迴圈引用）
        const isPasteIntoSelf = targetDir === clipboardItem.path

        // 建立目標資料夾
        if (workspace.isCustom) {
          await mkdir(targetPathOptions.path)
        } else {
          await mkdir(targetPathOptions.path, { baseDir: targetPathOptions.baseDir })
        }

        // 遞迴複製資料夾內容
        const copyDirRecursively = async (srcRelative: string, destRelative: string) => {
          const entries = await readDir(
            srcRelative,
            workspace.isCustom ? {} : { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData }
          )

          for (const entry of entries) {
            const srcEntryPath = `${srcRelative}/${entry.name}`
            const destEntryPath = `${destRelative}/${entry.name}`

            if (entry.isDirectory) {
              // 如果貼上到自身內部，跳過與目標資料夾同名的子資料夾（避免迴圈引用）
              if (isPasteIntoSelf && entry.name === targetName) {
                continue
              }

              if (workspace.isCustom) {
                await mkdir(destEntryPath)
              } else {
                await mkdir(destEntryPath, { baseDir: targetPathOptions.baseDir })
              }
              await copyDirRecursively(srcEntryPath, destEntryPath)
            } else {
              try {
                let content = ''
                if (workspace.isCustom) {
                  content = await readTextFile(srcEntryPath)
                  await writeTextFile(destEntryPath, content)
                } else {
                  content = await readTextFile(srcEntryPath, { baseDir: sourcePathOptions.baseDir || BaseDirectory.AppData })
                  await writeTextFile(destEntryPath, content, { baseDir: targetPathOptions.baseDir })
                }
              } catch (err) {
                console.error(`Error copying file ${srcEntryPath}:`, err)
              }
            }
          }
        }

        await copyDirRecursively(sourcePathOptions.path, targetPathOptions.path)

        // 如果是剪下操作，刪除原資料夾
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path, { recursive: true })
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir, recursive: true })
          }
          // 清理已被刪除的原資料夾對應的 tabs
          await cleanTabsByDeletedFolder(clipboardItem?.path || '')
          setClipboardItem(null, 'none')
        }
      } else {
        // 貼上檔案
        const sourcePathOptions = await getFilePathOptions(clipboardItem.path)
        const { generateCopyFilename } = await import('@/lib/default-filename')
        const uniqueFilename = await generateCopyFilename(targetDir, clipboardItem.name)
        const targetPathRelative = targetDir ? `${targetDir}/${uniqueFilename}` : uniqueFilename
        const targetPathOptions = await getFilePathOptions(targetPathRelative)

        // Read content from source file
        let content = ''
        if (workspace.isCustom) {
          content = await readTextFile(sourcePathOptions.path)
          await writeTextFile(targetPathOptions.path, content)
        } else {
          content = await readTextFile(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          await writeTextFile(targetPathOptions.path, content, { baseDir: targetPathOptions.baseDir })
        }

        // If cut operation, delete the original file
        if (clipboardOperation === 'cut') {
          if (workspace.isCustom) {
            await remove(sourcePathOptions.path)
          } else {
            await remove(sourcePathOptions.path, { baseDir: sourcePathOptions.baseDir })
          }
          // 清理已被刪除的原檔案對應的 tabs
          await cleanTabsByDeletedFile(clipboardItem?.path || '')
          // Clear clipboard after cut & paste operation
          setClipboardItem(null, 'none')
        }
      }

      // Refresh file tree
      loadFileTree()
      toast({ title: t('clipboard.pasted') })
    } catch (error) {
      console.error('Paste operation failed:', error)
      toast({ title: t('clipboard.pasteFailed'), variant: 'destructive' })
    }
  }

  async function handleEditEnd() {
    if (currentFolder && currentFolder.children) {
      const index = currentFolder?.children?.findIndex(item => item.name === '')
      if (index !== undefined && index !== -1 && currentFolder?.children) {
        currentFolder?.children?.splice(index, 1)
      }
      setFileTree(fileTree)
    } else {
      // 根目錄檔案：需要克隆 fileTree 來更新
      const cacheTree = cloneDeep(fileTree)
      const index = cacheTree.findIndex(item => item.name === '')
      if (index !== -1) {
        cacheTree.splice(index, 1)
      }
      setFileTree(cacheTree)
    }
    setIsEditing(false)
  }

  useEffect(() => {
    if (item.isEditing) {
      setIsEditing(true)
      setName(item.name)
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [item])

  // 監聽檔案管理器統一快捷鍵觸發的自定義事件
  useEffect(() => {
    const handleRenameEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail.path === path) {
        handleStartRename()
      }
    }

    const handleDeleteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ item: { path: string } }>
      if (customEvent.detail.item.path === path) {
        handleDeleteFile()
      }
    }

    const handlePasteEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ targetPath: string }>
      // 貼上到檔案所在目錄（同級貼上）
      if (customEvent.detail.targetPath === path) {
        handlePasteFile()
      }
    }

    window.addEventListener('filemanager-rename', handleRenameEvent)
    window.addEventListener('filemanager-delete', handleDeleteEvent)
    window.addEventListener('filemanager-paste', handlePasteEvent)

    return () => {
      window.removeEventListener('filemanager-rename', handleRenameEvent)
      window.removeEventListener('filemanager-delete', handleDeleteEvent)
      window.removeEventListener('filemanager-paste', handlePasteEvent)
    }
  }, [path, handleStartRename, handleDeleteFile, handlePasteFile])

  // 獲取當前平臺（用於顯示快捷鍵）
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')

  useEffect(() => {
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch {
      setCurrentPlatform('unknown')
    }
  }, [])

  // 快捷鍵顯示文字
  const modKey = currentPlatform === 'macos' ? '⌘' : 'Ctrl'
  const deleteKey = currentPlatform === 'macos' ? '⌫' : 'Del'
  const renameKey = currentPlatform === 'macos' ? '↩' : 'F2'

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            ref={itemRef}
            className={`${path === activeFilePath ? 'file-manange-item active' : 'file-manange-item'} ${!isRoot && 'translate-x-5 w-[calc(100%-20px)]!'}`}
            onClick={handleSelectFile}
          >
            {
              isEditing ? 
              <div className="flex gap-1 items-center w-full select-none">
                <span className={item.parent ? 'size-0' : `${iconSize} ml-1`} />
                <File className={iconSize} />
                <Input
                  ref={inputRef}
                  className={`h-5 rounded-sm text-${fileManagerTextSize} px-1 font-normal flex-1 mr-1`}
                  value={name}
                  onBlur={handleRename}
                  onChange={handleInputChange}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  onKeyDown={(e) => {
                    // 阻止刪除快捷鍵冒泡到全域性快捷鍵處理器
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      e.stopPropagation()
                    }
                    if (e.code === 'Enter' && !e.nativeEvent.isComposing) {
                      handleRename()
                    } else if (e.code === 'Escape') {
                      handleEditEnd()
                    }
                  }}
                />
              </div> :
              item.name.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i) ?
              <span
                draggable
                onDragStart={handleDragStart}
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                <div className="flex flex-1 gap-1 select-none relative items-center">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex items-center">
                    <ImageIcon className={iconSize} />
                  </div>
                  <span className={`text-${fileManagerTextSize} flex-1 line-clamp-1`}>{item.name}</span>
                  {path === activeFilePath && renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span> :
              <span
                draggable
                onDragStart={handleDragStart}
                title={item.name}
                className={`${!item.isLocale || isCut ? 'opacity-50' : ''} flex justify-between flex-1 select-none items-center gap-1 dark:hover:text-white`}>
                <div className="flex flex-1 gap-1 select-none relative items-center">
                  <span className={item.parent ? 'size-0' : `${iconSize} ml-1`}></span>
                  <div className="relative flex items-center">
                    { item.loading ? (
                      <LoaderCircle className={`${iconSize} animate-spin`} />
                    ) : item.isLocale ? (
                      item.sha ? <FileUp className={iconSize} /> : <File className={iconSize} />
                    ) : (
                      <FileDown className={iconSize} />
                    )}
                  </div>
                  <span className={`text-${fileManagerTextSize} flex-1 line-clamp-1`}>{item.name}</span>
                  {path === activeFilePath && renderVectorIcon()}
                </div>
                {isMobile && (
                  <MobileActionMenu className="ml-1">
                    <MobileMenuItem onClick={handleShowFileManager}>
                      {t('context.viewDirectory')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleCutFile}>
                      {t('context.cut')}
                    </MobileMenuItem>
                    <MobileMenuItem onClick={handleCopyFile}>
                      {t('context.copy')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!clipboardItem} onClick={handlePasteFile}>
                      {t('context.paste')}
                    </MobileMenuItem>
                    <MobileSeparator />
                    <MobileMenuItem disabled={!item.isLocale} onClick={handleStartRename}>
                      {t('context.rename')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.sha} className="text-red-600" onClick={handleDeleteSyncFile}>
                      {t('context.deleteSyncFile')}
                    </MobileMenuItem>
                    <MobileMenuItem disabled={!item.isLocale || item.name === ''} className="text-red-600" onClick={handleDeleteFile}>
                      {t('context.deleteLocalFile')}
                    </MobileMenuItem>
                  </MobileActionMenu>
                )}
              </span>
            }
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem inset onClick={handleShowFileManager} menuType="file">
            <FolderOpen className="mr-2 h-4 w-4" />
            {t('context.viewDirectory')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <VectorKnowledgeMenu
            item={item}
            hasVector={hasVector}
            onVectorUpdated={handleVectorUpdated}
          />
          <ContextMenuSeparator />
          <ContextMenuItem inset disabled={!item.isLocale} onClick={handleCutFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.cut')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}X</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset onClick={handleCopyFile} menuType="file">
            <Copy className="mr-2 h-4 w-4" />
            {t('context.copy')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}C</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem inset disabled={!clipboardItem} onClick={handlePasteFile} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.paste')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{modKey}V</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!item.isLocale} inset onClick={handleStartRename} menuType="file">
            <File className="mr-2 h-4 w-4" />
            {t('context.rename')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{renameKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.sha} inset className="text-red-900" onClick={handleDeleteSyncFile} menuType="file">
            <RefreshCwOff className="mr-2 h-4 w-4" />
            {t('context.deleteSyncFile')}
          </ContextMenuItem>
          <ContextMenuItem disabled={!item.isLocale || item.name === ''} inset className="text-red-900" onClick={handleDeleteFile} menuType="file">
            <Trash2 className="mr-2 h-4 w-4" />
            {t('context.deleteLocalFile')}
            <ContextMenuShortcut menuType="file">
              <Kbd>{deleteKey}</Kbd>
            </ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
