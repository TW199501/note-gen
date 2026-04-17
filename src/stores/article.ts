import { getFiles as getGithubFiles } from '@/lib/sync/github'
import { GithubContent } from '@/lib/sync/github.types'
import { getFiles as getGiteeFiles } from '@/lib/sync/gitee'
import { getFiles as getGiteaFiles } from '@/lib/sync/gitea'
import { getFiles as getGitlabFiles } from '@/lib/sync/gitlab'
import { GiteeFile } from '@/lib/sync/gitee'
import { GiteaDirectoryItem } from '@/lib/sync/gitea.types'
import { getSyncRepoName } from '@/lib/sync/repo-utils'
import { s3ListObjects } from '@/lib/sync/s3'
import { webdavListObjects } from '@/lib/sync/webdav'
import { S3Config, WebDAVConfig } from '@/types/sync'
import { hasNetworkConnection, ensureDirectoryExists, pullRemoteFile, saveLocalFile } from '@/lib/sync/auto-sync'
import { syncOnOpen } from '@/lib/sync/sync-manager'
import { sanitizeFilePath, hasInvalidFileNameChars } from '@/lib/sync/filename-utils'
import { getCurrentFolder, computedParentPath } from '@/lib/path'
import useVectorStore from './vector'
import { join, appDataDir } from '@tauri-apps/api/path'
import { BaseDirectory, DirEntry, exists, mkdir, readDir, readTextFile, writeTextFile, stat } from '@tauri-apps/plugin-fs'
import { Store } from '@tauri-apps/plugin-store'
import { cloneDeep, uniq } from 'lodash-es'
import { create } from 'zustand'
import { getFilePathOptions, getWorkspacePath, toWorkspaceRelativePath } from '@/lib/workspace'
import emitter from '@/lib/emitter'
import { isSkillsFolder } from '@/lib/skills/utils'
import { buildVectorIndexedMap, getVectorDocumentKey } from '@/lib/vector-document-key'
import { buildRemotePathsToLoad } from './article-remote-sync'

// 快取 Store 例項，避免每次都重新載入
let storeInstance: Store | null = null
async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await Store.load('store.json')
  }
  return storeInstance
}

export type SortType = 'name' | 'created' | 'modified' | 'none'
export type SortDirection = 'asc' | 'desc'

export interface DirTree extends DirEntry {
  children?: DirTree[]
  parent?: DirTree
  sha?: string
  size?: number
  isEditing?: boolean
  isLocale: boolean
  createdAt?: string
  modifiedAt?: string
  loading?: boolean  // 資料夾正在載入中
  vectorCalcStatus?: 'idle' | 'calculating' | 'completed'  // 向量計算狀態
}

export interface Article {
  article: string
  path: string
}

export interface EditorViewState {
  selectionFrom: number
  selectionTo: number
  scrollTop: number
}

// 查詢資料夾節點
export const findFolderInTree = (path: string, tree: DirTree[]): DirTree | null => {
  for (const item of tree) {
    const itemPath = computedParentPath(item)
    if (itemPath === path && item.isDirectory) {
      return item
    }
    if (item.children && item.children.length > 0) {
      const found = findFolderInTree(path, item.children)
      if (found) return found
    }
  }
  return null
}

function isLikelyFilePath(path: string): boolean {
  const name = path.split('/').pop() || path
  return name.includes('.')
}

function getFolderPathsToExpand(path: string): string[] {
  const segments = path.split('/').filter(Boolean)
  const folderSegments = isLikelyFilePath(path) ? segments.slice(0, -1) : segments

  return folderSegments.map((_, index) => folderSegments.slice(0, index + 1).join('/'))
}

function createLocalTreeNode(name: string, isDirectory: boolean, parent?: DirTree): DirTree {
  return {
    name,
    isDirectory,
    isFile: !isDirectory,
    isSymlink: false,
    children: isDirectory ? [] : undefined,
    parent,
    isEditing: false,
    isLocale: true,
    sha: '',
    createdAt: undefined,
    modifiedAt: undefined,
  }
}

function insertNodeIntoTree(tree: DirTree[], relativePath: string, isDirectory: boolean): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    if (tree.some(item => item.name === name)) {
      return true
    }
    tree.unshift(createLocalTreeNode(name, isDirectory))
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  if (parentFolder.children.some(item => item.name === name)) {
    return true
  }

  parentFolder.children.unshift(createLocalTreeNode(name, isDirectory, parentFolder))
  return true
}

function removeNodeFromTree(tree: DirTree[], relativePath: string): DirTree | null {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath

  if (!parentPath) {
    const index = tree.findIndex(item => item.name === name)
    if (index === -1) {
      return null
    }
    return tree.splice(index, 1)[0] || null
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder?.children) {
    return null
  }

  const index = parentFolder.children.findIndex(item => item.name === name)
  if (index === -1) {
    return null
  }

  return parentFolder.children.splice(index, 1)[0] || null
}

function attachNodeToTree(tree: DirTree[], relativePath: string, node: DirTree): boolean {
  const parentPath = relativePath.split('/').slice(0, -1).join('/')
  const name = relativePath.split('/').pop() || relativePath
  node.name = name

  if (!parentPath) {
    node.parent = undefined
    if (!tree.some(item => item.name === name)) {
      tree.unshift(node)
    }
    return true
  }

  const parentFolder = getCurrentFolder(parentPath, tree)
  if (!parentFolder || !parentFolder.isDirectory) {
    return false
  }

  if (!parentFolder.children) {
    parentFolder.children = []
  }

  node.parent = parentFolder
  if (!parentFolder.children.some(item => item.name === name)) {
    parentFolder.children.unshift(node)
  }
  return true
}

interface NoteState {
  loading: boolean
  setLoading: (loading: boolean) => void

  activeFilePath: string
  setActiveFilePath: (name: string) => void

  // 當前正在讀取的檔案路徑，用於避免競態條件
  readFilePath: string
  setReadFilePath: (path: string) => void

  // Tabs for multi-file editing
  openTabs: Array<{ id: string; path: string; name: string; isFolder: boolean }>
  setOpenTabs: (tabs: Array<{ id: string; path: string; name: string; isFolder: boolean }>) => void
  activeTabId: string
  setActiveTabId: (id: string) => void
  addTab: (tab: { id: string; path: string; name: string; isFolder: boolean }) => void
  removeTab: (id: string) => void
  editorViewStates: Record<string, EditorViewState>
  setEditorViewState: (path: string, state: EditorViewState) => void
  getEditorViewState: (path: string) => EditorViewState | null
  removeEditorViewState: (path: string) => void
  moveEditorViewState: (oldPath: string, newPath: string) => void
  cleanTabsByDeletedFile: (deletedPath: string) => Promise<void>
  cleanTabsByDeletedFolder: (deletedFolderPath: string) => Promise<void>
  clearTabs: () => void

  matchPosition: number | null
  setMatchPosition: (position: number | null) => void
  pendingSearchKeyword: string
  setPendingSearchKeyword: (keyword: string) => void

  html2md: boolean
  initHtml2md: () => Promise<void>
  setHtml2md: (html2md: boolean) => Promise<void>

  showCloudFiles: boolean
  initShowCloudFiles: () => Promise<void>
  setShowCloudFiles: (show: boolean) => Promise<void>

  // Initialize tabs from store
  initOpenTabs: () => Promise<void>

  sortType: SortType
  sortDirection: SortDirection
  initSortSettings: () => Promise<void>
  initEventListeners: () => void
  setSortType: (sortType: SortType) => Promise<void>
  setSortDirection: (direction: SortDirection) => Promise<void>
  sortFileTree: (tree: DirTree[]) => DirTree[]
  updateFileStats: (path: string, tree: DirTree[]) => Promise<DirTree[]>
  loadFileStatsIfNeeded: () => Promise<void>

  fileTree: DirTree[]
  fileTreeLoading: boolean
  setFileTree: (tree: DirTree[]) => void
  addFile: (file: DirTree) => void
  ensurePathExpanded: (path: string) => Promise<void>
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => boolean
  removeLocalEntry: (relativePath: string) => boolean
  moveLocalEntry: (oldPath: string, newPath: string) => boolean
  syncOpenTabsForPathChange: (oldPath: string, newPath: string) => Promise<void>
  loadFileTree: (options?: { skipRemoteSync?: boolean }) => Promise<void>
  loadRemoteSyncFiles: () => Promise<void>
  loadCollapsibleFiles: (folderName: string, options?: { force?: boolean }) => Promise<void>
  loadFolderRemoteFiles: (folderName: string) => Promise<void>
  newFolder: () => void
  newFile: () => void
  newFileOnFolder: (path: string) => void
  newFolderInFolder: (path: string) => void

  collapsibleList: string[]
  collapsibleListInitialized: boolean
  initCollapsibleList: () => Promise<void>
  setCollapsibleList: (name: string, value: boolean) => Promise<void>
  expandAllFolders: () => Promise<void>
  collapseAllFolders: () => Promise<void>
  toggleAllFolders: () => Promise<void>
  clearCollapsibleList: () => Promise<void>

  currentArticle: string
  isPulling: boolean // 新增：拉取狀態
  justPulledFile: boolean // 標記是否剛從遠端拉取檔案（用於避免立即推送）
  skipSyncOnSave: boolean // 標記是否跳過同步（用於程式寫入時）
  aiGeneratingFilePath: string | null // 標記當前正在 AI 生成的檔案路徑
  aiTerminateFn: (() => void) | null // AI 生成的終止函式
  readArticle: (path: string, sha?: string, isLocale?: boolean, autoSync?: boolean) => Promise<void>
  setCurrentArticle: (content: string) => void
  setIsPulling: (pulling: boolean) => void
  setJustPulledFile: (justPulled: boolean) => void
  setSkipSyncOnSave: (skip: boolean) => void
  setAiGeneratingFilePath: (path: string | null) => void
  setAiTerminateFn: (fn: (() => void) | null) => void
  saveCurrentArticle: (content: string) => Promise<void>
  // 防抖儲存相關
  debounceSaveTimer: NodeJS.Timeout | null
  pendingSaveContent: string | null
  // 更新檔案 sha 狀態（推送成功後呼叫）
  updateFileSha: (path: string, sha: string) => void

  // 向量計算相關
  vectorCalcTimer: NodeJS.Timeout | null
  vectorCalcProgressInterval: NodeJS.Timeout | null
  vectorCalcProgress: number
  isVectorCalculating: boolean
  lastEditTime: number
  pendingVectorContent: { path: string; content: string } | null
  scheduleVectorCalculation: (path: string, content: string) => void
  executeVectorCalculation: () => Promise<void>
  cancelVectorCalculation: () => void
  triggerVectorCalculation: () => Promise<void> // 手動觸發向量計算
  // 向量索引狀態
  vectorIndexedFiles: Map<string, number> // 工作區相對路徑 -> 向量索引時間戳
  checkFileVectorIndexed: (filePath: string) => Promise<boolean>
  clearFileVector: (filePath: string) => Promise<void>
  initVectorIndexedFiles: () => Promise<void> // 初始化向量索引狀態
  // 向量計算狀態更新
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => void

  allArticle: Article[]
  loadAllArticle: () => Promise<void>
}

const useArticleStore = create<NoteState>((set, get) => ({
  loading: false,

  // 防抖儲存相關狀態
  debounceSaveTimer: null,
  pendingSaveContent: null,

  setLoading: (loading: boolean) => { set({ loading }) },

  sortType: 'none',
  sortDirection: 'asc',
  initSortSettings: async () => {
    const store = await getStore()
    const sortType = await store.get<SortType>('sortType')
    const sortDirection = await store.get<SortDirection>('sortDirection')
    if (sortType) set({ sortType })
    if (sortDirection) set({ sortDirection })

    // 如果需要按時間排序，載入統計資訊
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }

    // 初始化事件監聽器
    get().initEventListeners()
  },

  // 初始化事件監聽器
  initEventListeners: () => {
    // 監聽同步推送完成事件，更新檔案樹的 sha 狀態
    emitter.on('sync-push-completed', ((event: { path: string; success: boolean; sha?: string }) => {
      const { path, success, sha } = event
      if (success && sha) {
        get().updateFileSha(path, sha)
      }
    }) as any)
  },
  setSortType: async (sortType: SortType) => {
    set({ sortType })
    const store = await getStore()
    await store.set('sortType', sortType)
    
    // 如果需要按時間排序，先載入統計資訊
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  setSortDirection: async (direction: SortDirection) => {
    set({ sortDirection: direction })
    const store = await getStore()
    await store.set('sortDirection', direction)
    
    // 如果當前是按時間排序，確保統計資訊已載入
    const sortType = get().sortType
    if (sortType === 'created' || sortType === 'modified') {
      await get().loadFileStatsIfNeeded()
    }
    
    const currentTree = get().fileTree
    const sortedTree = get().sortFileTree(currentTree)
    set({ fileTree: sortedTree })
  },
  
  sortFileTree: (tree: DirTree[]) => {
    const sortType = get().sortType
    const sortDirection = get().sortDirection

    // 複製樹結構，避免直接修改原始資料
    const sortedTree = cloneDeep(tree)

    // skills 資料夾始終置頂（在任何排序方式下，包括 sortType 為 'none' 時）
    const sortFunction = (a: DirTree, b: DirTree) => {
      const aIsSkills = a.isDirectory && isSkillsFolder(a.name)
      const bIsSkills = b.isDirectory && isSkillsFolder(b.name)
      if (aIsSkills && !bIsSkills) return -1
      if (!aIsSkills && bIsSkills) return 1

      // 如果排序型別為 'none'，在 skills 置頂後，資料夾在檔案上方
      if (sortType === 'none') {
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return 0
      }

      // 資料夾始終在檔案上方
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1

      // 同型別的進行排序
      let result = 0
      switch (sortType) {
        case 'name':
          result = a.name.localeCompare(b.name)
          break
        case 'created':
          if (a.createdAt && b.createdAt) {
            result = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        case 'modified':
          if (a.modifiedAt && b.modifiedAt) {
            result = new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime()
          } else {
            result = a.name.localeCompare(b.name)
          }
          break
        default:
          result = 0
      }
      return sortDirection === 'asc' ? result : -result
    }

    sortedTree.sort(sortFunction)

    const sortChildren = (items: DirTree[]) => {
      for (const item of items) {
        if (item.children && item.children.length > 0) {
          item.children.sort(sortFunction)
          sortChildren(item.children)
        }
      }
    }

    sortChildren(sortedTree)
    return sortedTree
  },

  activeFilePath: '',
  setActiveFilePath: async (path: string) => {
    // 切換檔案時，先清空 currentArticle，避免內容覆蓋
    set({ currentArticle: '', activeFilePath: path })
    const store = await getStore();
    await store.set('activeFilePath', path)
    // 觸發事件，讓推送佇列重置計時器
    emitter.emit('article-opened', { path })

    // 自動展開父資料夾，確保檔案在樹中可見
    const parts = path.split('/')
    if (parts.length > 1) {
      const collapsibleList = get().collapsibleList
      const parentPaths: string[] = []
      for (let i = 1; i < parts.length; i++) {
        const parentPath = parts.slice(0, i).join('/')
        if (!collapsibleList.includes(parentPath)) {
          parentPaths.push(parentPath)
        }
      }
      if (parentPaths.length > 0) {
        const newList = uniq([...collapsibleList, ...parentPaths])
        await store.set('collapsibleList', newList)
        set({ collapsibleList: newList })
      }
    }

    // 觸發讀取檔案內容（包括遠端拉取）
    // 需要確保是檔案而不是資料夾
    const fileName = path.split('/').pop() || ''
    if (fileName && fileName.includes('.')) {
      get().readArticle(path)
    }
  },

  // Tabs initialization - load from store
  openTabs: [],
  activeTabId: '',
  editorViewStates: {},
  setOpenTabs: async (tabs) => {
    const keptPaths = new Set(tabs.map(tab => tab.path))
    const nextEditorViewStates = Object.fromEntries(
      Object.entries(get().editorViewStates).filter(([path]) => keptPaths.has(path))
    )
    set({ openTabs: tabs, editorViewStates: nextEditorViewStates })
    const store = await getStore();
    await store.set('openTabs', tabs)
  },
  setActiveTabId: async (id) => {
    set({ activeTabId: id })
    const store = await getStore();
    await store.set('activeTabId', id)
  },
  addTab: async (tab) => {
    const currentTabs = get().openTabs
    // Check if tab already exists
    if (currentTabs.find(t => t.path === tab.path)) {
      return
    }
    const newTabs = [...currentTabs, tab].slice(-10) // Limit to 10 tabs
    set({ openTabs: newTabs, activeTabId: tab.id })
    const store = await getStore();
    await store.set('openTabs', newTabs)
    await store.set('activeTabId', tab.id)
  },
  removeTab: async (id) => {
    const currentTabs = get().openTabs
    const removedTab = currentTabs.find(t => t.id === id)
    const newTabs = currentTabs.filter(t => t.id !== id)
    const nextEditorViewStates = { ...get().editorViewStates }
    if (removedTab) {
      delete nextEditorViewStates[removedTab.path]
    }
    set({ openTabs: newTabs, editorViewStates: nextEditorViewStates })
    const store = await getStore();
    await store.set('openTabs', newTabs)
  },
  setEditorViewState: (path, state) => {
    if (!path) {
      return
    }
    set(current => ({
      editorViewStates: {
        ...current.editorViewStates,
        [path]: state,
      }
    }))
  },
  getEditorViewState: (path) => {
    if (!path) {
      return null
    }
    return get().editorViewStates[path] || null
  },
  removeEditorViewState: (path) => {
    if (!path) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[path]
    set({ editorViewStates: nextEditorViewStates })
  },
  moveEditorViewState: (oldPath, newPath) => {
    if (!oldPath || !newPath || oldPath === newPath) {
      return
    }
    const currentState = get().editorViewStates[oldPath]
    if (!currentState) {
      return
    }
    const nextEditorViewStates = { ...get().editorViewStates }
    delete nextEditorViewStates[oldPath]
    nextEditorViewStates[newPath] = currentState
    set({ editorViewStates: nextEditorViewStates })
  },

  // 清理已被刪除的檔案對應的 tabs（根據路徑匹配）
  cleanTabsByDeletedFile: async (deletedPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const newTabs = currentTabs.filter(t => t.path !== deletedPath)

    // 如果有標籤頁被移除，更新狀態
    if (newTabs.length !== currentTabs.length) {
      // 如果刪除的是當前活動的 tab，自動選擇另一個 tab
      const deletedTab = currentTabs.find(t => t.path === deletedPath)
      let newActiveTabId = currentActiveTabId
      let newActiveFilePath = currentActiveFilePath

      if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
        // 選擇最後一個 tab
        const targetTab = newTabs[newTabs.length - 1]
        newActiveTabId = targetTab.id
        newActiveFilePath = targetTab.path
      } else if (deletedTab && currentActiveTabId === deletedTab.id) {
        // 沒有其他 tab 了
        newActiveTabId = ''
        newActiveFilePath = ''
      }

      const nextEditorViewStates = { ...get().editorViewStates }
      delete nextEditorViewStates[deletedPath]
      set({ openTabs: newTabs, activeTabId: newActiveTabId, activeFilePath: newActiveFilePath, currentArticle: '', editorViewStates: nextEditorViewStates })
      const store = await getStore();
      await store.set('openTabs', newTabs)
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
    }
  },

  // 清理已被刪除的資料夾對應的 tabs（清理該資料夾下所有檔案的 tabs）
  cleanTabsByDeletedFolder: async (deletedFolderPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const currentActiveFilePath = get().activeFilePath
    const folderPrefix = deletedFolderPath.endsWith('/') ? deletedFolderPath : deletedFolderPath + '/'
    const newTabs = currentTabs.filter(t => !t.path.startsWith(folderPrefix))

    // 如果有標籤頁被移除，更新狀態
    if (newTabs.length !== currentTabs.length) {
      // 如果刪除的是當前活動的 tab，自動選擇另一個 tab
      const deletedTab = currentTabs.find(t => t.path.startsWith(folderPrefix))
      let newActiveTabId = currentActiveTabId
      let newActiveFilePath = currentActiveFilePath

      if (deletedTab && currentActiveTabId === deletedTab.id && newTabs.length > 0) {
        // 選擇最後一個 tab
        const targetTab = newTabs[newTabs.length - 1]
        newActiveTabId = targetTab.id
        newActiveFilePath = targetTab.path
      } else if (deletedTab && currentActiveTabId === deletedTab.id) {
        // 沒有其他 tab 了
        newActiveTabId = ''
        newActiveFilePath = ''
      }

      const nextEditorViewStates = { ...get().editorViewStates }
      Object.keys(nextEditorViewStates).forEach(path => {
        if (path.startsWith(folderPrefix)) {
          delete nextEditorViewStates[path]
        }
      })
      set({ openTabs: newTabs, activeTabId: newActiveTabId, activeFilePath: newActiveFilePath, currentArticle: '', editorViewStates: nextEditorViewStates })
      const store = await getStore();
      await store.set('openTabs', newTabs)
      await store.set('activeTabId', newActiveTabId)
      await store.set('activeFilePath', newActiveFilePath)
    }
  },

  clearTabs: async () => {
    set({ openTabs: [], activeTabId: '', editorViewStates: {} })
    const store = await getStore();
    await store.set('openTabs', [])
    await store.set('activeTabId', '')
  },

  matchPosition: null,
  setMatchPosition: (position: number | null) => {
    set({ matchPosition: position })
  },
  pendingSearchKeyword: '',
  setPendingSearchKeyword: (keyword: string) => {
    set({ pendingSearchKeyword: keyword })
  },

  html2md: false,
  initHtml2md: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('html2md')
    set({ html2md: res || false })
  },
  setHtml2md: async (html2md: boolean) => {
    set({ html2md })
    const store = await getStore();
    store.set('html2md', html2md)
  },

  showCloudFiles: true,
  initShowCloudFiles: async () => {
    const store = await getStore();
    const res = await store.get<boolean>('showCloudFiles')
    set({ showCloudFiles: res ?? true })
  },

  // Initialize open tabs from store
  initOpenTabs: async () => {
    const store = await getStore();
    const tabs = await store.get<Array<{ id: string; path: string; name: string; isFolder: boolean }>>('openTabs')
    const activeTabId = await store.get<string>('activeTabId')
    set({ openTabs: tabs || [], activeTabId: activeTabId || '' })
  },
  setShowCloudFiles: async (show: boolean) => {
    set({ showCloudFiles: show })
    const store = await getStore();
    await store.set('showCloudFiles', show)
  },

  fileTree: [],
  setFileTree: (tree: DirTree[]) => {
    const sortedTree = get().sortFileTree(tree)
    set({ fileTree: sortedTree })
  },
  addFile: (file: DirTree) => {
    set({ fileTree: [file, ...get().fileTree] })
  },
  ensurePathExpanded: async (path: string) => {
    const folderPaths = getFolderPathsToExpand(path)
    if (folderPaths.length === 0) {
      return
    }

    const collapsibleList = uniq([...get().collapsibleList, ...folderPaths])
    const store = await getStore()
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList })
  },
  insertLocalEntry: (relativePath: string, isDirectory: boolean) => {
    const cacheTree = cloneDeep(get().fileTree)
    const inserted = insertNodeIntoTree(cacheTree, relativePath, isDirectory)

    if (!inserted) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  removeLocalEntry: (relativePath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removed = removeNodeFromTree(cacheTree, relativePath)

    if (!removed) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  moveLocalEntry: (oldPath: string, newPath: string) => {
    const cacheTree = cloneDeep(get().fileTree)
    const removedNode = removeNodeFromTree(cacheTree, oldPath)

    if (!removedNode) {
      return false
    }

    const attached = attachNodeToTree(cacheTree, newPath, removedNode)
    if (!attached) {
      return false
    }

    get().setFileTree(cacheTree)
    return true
  },
  syncOpenTabsForPathChange: async (oldPath: string, newPath: string) => {
    const currentTabs = get().openTabs
    const currentActiveTabId = get().activeTabId
    const newTabs = currentTabs.map(tab => {
      if (tab.path !== oldPath) {
        return tab
      }

      return {
        ...tab,
        path: newPath,
        name: newPath.split('/').pop() || newPath,
      }
    })

    const nextActiveTabId = currentTabs.some(tab => tab.path === oldPath)
      ? currentActiveTabId
      : get().activeTabId

    const nextEditorViewStates = { ...get().editorViewStates }
    if (nextEditorViewStates[oldPath]) {
      nextEditorViewStates[newPath] = nextEditorViewStates[oldPath]
      delete nextEditorViewStates[oldPath]
    }

    set({ openTabs: newTabs, activeTabId: nextActiveTabId, editorViewStates: nextEditorViewStates })
    const store = await getStore()
    await store.set('openTabs', newTabs)
    await store.set('activeTabId', nextActiveTabId)
  },
  fileTreeLoading: false,
  updateFileStats: async (basePath: string, tree: DirTree[]) => {
    const workspace = await getWorkspacePath()
    
    for (const entry of tree) {
      // 跳過非本地檔案（遠端同步檔案）
      if (entry.isFile && entry.isLocale) {
        const filePath = await join(basePath, entry.name)
        try {
          let fileStat
          if (workspace.isCustom) {
            // 自定義工作區，使用絕對路徑
            fileStat = await stat(filePath)
          } else {
            // 預設工作區，使用AppData路徑
            const relPath = await toWorkspaceRelativePath(filePath)
            const pathOptions = await getFilePathOptions(relPath)
            fileStat = await stat(pathOptions.path, { baseDir: pathOptions.baseDir })
          }
          entry.createdAt = fileStat.birthtime?.toISOString()
          entry.modifiedAt = fileStat.mtime?.toISOString()
          entry.size = fileStat.size
        } catch {
          // 靜默失敗，不阻塞排序功能
        }
      } else if (entry.isDirectory && entry.children) {
        const dirPath = await join(basePath, entry.name)
        await get().updateFileStats(dirPath, entry.children)
      }
    }
    return tree
  },
  
  // 按需載入檔案統計資訊（僅在需要排序時）
  loadFileStatsIfNeeded: async () => {
    const fileTree = get().fileTree
    
    // 檢查是否已載入過統計資訊（檢查第一個檔案）
    const hasStats = fileTree.some(entry => 
      entry.isFile && (entry.createdAt !== undefined || entry.modifiedAt !== undefined)
    )
    
    if (hasStats) {
      // 已經載入過，無需重複載入
      return
    }
    
    // 載入統計資訊
    const workspace = await getWorkspacePath()
    // 使用正確的基礎路徑
    const basePath = workspace.isCustom ? workspace.path : await join(await appDataDir(), 'article')
    await get().updateFileStats(basePath, fileTree)
    set({ fileTree: [...fileTree] }) // 觸發重新渲染
  },
  
  loadFileTree: async (options) => {
    set({ fileTreeLoading: true })
    set({ fileTree: [] })

    // 確保 collapsibleList 已初始化
    if (!get().collapsibleListInitialized) {
      await get().initCollapsibleList()
    }

    // 獲取當前工作區路徑
    const workspace = await getWorkspacePath()
    
    // 確保工作區目錄存在
    if (workspace.isCustom) {
      // 自定義工作區
      const isWorkspaceExists = await exists(workspace.path)
      if (!isWorkspaceExists) {
        await mkdir(workspace.path)
      }
    } else {
      // 預設工作區
      const isArticleDir = await exists('article', { baseDir: BaseDirectory.AppData })
      if (!isArticleDir) {
        await mkdir('article', { baseDir: BaseDirectory.AppData })
      }
    }

    // 讀取工作區檔案（僅根目錄）
    let dirs: DirTree[] = []
    if (workspace.isCustom) {
      // 自定義工作區
      dirs = (await readDir(workspace.path))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined
        }))
    } else {
      // 預設工作區
      dirs = (await readDir('article', { baseDir: BaseDirectory.AppData }))
        .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
          ...file,
          isEditing: false,
          isLocale: true,
          parent: undefined,
          sha: '',
          createdAt: undefined,
          modifiedAt: undefined,
          children: file.isDirectory ? [] : undefined
        }))
    }
    
    // 為已展開的資料夾載入子內容
    const collapsibleList = get().collapsibleList
    if (collapsibleList.length > 0) {
      // 只載入根級別已展開的資料夾
      const rootExpandedFolders = dirs.filter(dir => dir.isDirectory && collapsibleList.includes(dir.name))
      for (const folder of rootExpandedFolders) {
        await loadFolderChildren(workspace, folder)
      }
    }
    
    // 遞迴載入已展開資料夾的子內容
    async function loadFolderChildren(workspace: any, folder: DirTree, parentPath: string = '') {
      const folderPath = parentPath ? `${parentPath}/${folder.name}` : folder.name
      const fullPath = await join(workspace.path, folderPath)
      
      let children: DirTree[] = []
      
      // 檢查目錄是否存在
      let dirExists = false
      try {
        if (workspace.isCustom) {
          dirExists = await exists(fullPath)
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }
      } catch {
        dirExists = false
      }
      
      // 如果目錄存在，載入本地檔案
      if (dirExists) {
        try {
          if (workspace.isCustom) {
            children = (await readDir(fullPath))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined
              })) as DirTree[]
          } else {
            const dirRelative = await toWorkspaceRelativePath(fullPath)
            const pathOptions = await getFilePathOptions(dirRelative)
            children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
              .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.')).map(file => ({
                ...file,
                parent: folder,
                isEditing: false,
                isLocale: true,
                sha: '',
                createdAt: undefined,
                modifiedAt: undefined,
                children: file.isDirectory ? [] : undefined
              })) as DirTree[]
          }
        } catch {
          // 讀取失敗，使用空陣列
        }
      }
      
      folder.children = children
      
      // 遞迴載入子資料夾中已展開的資料夾
      for (const child of children) {
        if (child.isDirectory && collapsibleList.includes(`${folderPath}/${child.name}`)) {
          await loadFolderChildren(workspace, child, folderPath)
        }
      }
    }
        
    // 排序檔案樹
    const sortedDirs = get().sortFileTree(dirs)
    set({ fileTree: sortedDirs })

    // 先顯示本地檔案樹
    set({ fileTreeLoading: false })

    // 初始化向量索引狀態（非同步，不阻塞介面）
    get().initVectorIndexedFiles()

    // 非同步載入遠端同步檔案（不阻塞介面）
    if (!options?.skipRemoteSync) {
      get().loadRemoteSyncFiles()
    }
  },
  
  // 載入遠端同步檔案（後臺任務）
  loadRemoteSyncFiles: async () => {
    try {
      const store = await getStore();
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github'
      
      if (primaryBackupMethod === 'github') {
        const accessToken = await store.get<string>('accessToken')
        if (!accessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitee') {
        const giteeAccessToken = await store.get<string>('giteeAccessToken')
        if (!giteeAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitlab') {
        const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
        if (!gitlabAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 'gitea') {
        const giteaAccessToken = await store.get<string>('giteaAccessToken')
        if (!giteaAccessToken) {
          return
        }
      } else if (primaryBackupMethod === 's3') {
        const s3Config = await store.get<S3Config>('s3SyncConfig')
        if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) {
          return
        }
      } else if (primaryBackupMethod === 'webdav') {
        const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
        if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) {
          return
        }
      }

    // 為根目錄和已展開的目錄載入遠端檔案。
    // 這樣即使目錄只存在於雲端，只要使用者已展開過，也能繼續載入其遠端內容。
    const collapsibleList = get().collapsibleList
    const pathsToLoad = buildRemotePathsToLoad(collapsibleList)
    
    // 目錄樹會在載入過程中逐步插入父級節點，因此這裡必須按層級順序載入。
    // 如果併發請求深層路徑，遠端子目錄可能會在父目錄節點尚未寫入樹時被跳過。
    for (const path of pathsToLoad) {
      try {
        let files;
        switch (primaryBackupMethod) {
          case 'github':
            const githubRepo = await getSyncRepoName('github');
            files = await getGithubFiles({ path, repo: githubRepo });
            break;
          case 'gitee':
            const giteeRepo = await getSyncRepoName('gitee');
            files = await getGiteeFiles({ path, repo: giteeRepo });
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab');
            files = await getGitlabFiles({ path, repo: gitlabRepo });
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea');
            files = await getGiteaFiles({ path, repo: giteaRepo });
            break;
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              files = await s3ListObjects(s3Config, path)
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              files = await webdavListObjects(webdavConfig, path)
            }
            break;
          }
        }

        if (files) {
          const dirs = get().fileTree

          // S3 或 WebDAV 檔案處理
          if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            const fullPrefix = prefix ? `${prefix}/${path}` : path

            s3Files.forEach((file) => {
              const fileName = file.key.split('/').pop() || file.key
              if (fileName.startsWith('.')) {
                return;
              }

              // 計算相對路徑
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return
              }

              const isDirectory = file.key.endsWith('/')

              // 移除 pathPrefix 字首，轉換為本地相對路徑
              let localItemPath = file.key
              if (prefix && localItemPath.startsWith(prefix + '/')) {
                localItemPath = localItemPath.substring(prefix.length + 1)
              }

              let currentFolder: DirTree | undefined
              if (isDirectory) {
                currentFolder = getCurrentFolder(localItemPath, dirs)?.parent
              } else {
                const filePath = localItemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }

              if (localItemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.etag
                  currentFolder.children[index].size = file.size
                  currentFolder.children[index].modifiedAt = file.lastModified
                } else {
                  currentFolder?.children?.push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === fileName)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.etag
                  dirs[index].size = file.size
                  dirs[index].modifiedAt = file.lastModified
                } else {
                  (dirs as any).push({
                    name: fileName,
                    isFile: !isDirectory,
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: isDirectory,
                    sha: file.etag,
                    size: file.size,
                    isLocale: false,
                    modifiedAt: file.lastModified,
                    children: isDirectory ? [] : undefined
                  })
                }
              }
            })
          } else {
            // Git 平臺處理邏輯
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // 過濾以"."開頭的檔案和資料夾
              if (file.name.startsWith('.')) {
                return;
              }

              // 只載入直接子項，不載入孫子項
              const relativePath = path ? file.path.substring(path.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳過非直接子項
              }

              const itemPath = file.path;
              let currentFolder: DirTree | undefined
              if (file.type === 'dir') {
                currentFolder = getCurrentFolder(itemPath, dirs)?.parent
              } else {
                const filePath = itemPath.split('/').slice(0, -1).join('/')
                currentFolder = getCurrentFolder(filePath, dirs)
              }
              if (itemPath.includes('/')) {
                const index = currentFolder?.children?.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined && currentFolder?.children) {
                  currentFolder.children[index].sha = file.sha
                  currentFolder.children[index].size = (file as any).size
                } else {
                  currentFolder?.children?.push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: currentFolder,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              } else {
                const index = dirs.findIndex(item => item.name === file.name)
                if (index !== -1 && index !== undefined) {
                  dirs[index].sha = file.sha
                  dirs[index].size = (file as any).size
                } else {
                  (dirs as any).push({
                    name: file.name,
                    isFile: file.type === 'file',
                    isSymlink: false,
                    parent: undefined,
                    isEditing: false,
                    isDirectory: file.type === 'dir',
                    sha: file.sha,
                    size: (file as any).size,
                    isLocale: false,
                    children: file.type === 'dir' ? [] : undefined
                  })
                }
              }
            });
          }
          set({ fileTree: [...dirs] })
        }
      } catch {
      }
    }
  } catch {
  }
},
  // 載入資料夾內部的本地和遠端檔案（按需載入）
  loadCollapsibleFiles: async (fullpath: string, options?: { force?: boolean }) => {
    const cacheTree: DirTree[] = get().fileTree
    const currentFolder = getCurrentFolder(fullpath, cacheTree)

    if (!currentFolder) {
      return
    }

    // 檢查是否是目錄（防止誤將檔案當作目錄處理）
    if (!currentFolder.isDirectory) {
      return
    }

    // 如果已經載入過子內容，則跳過
    if (!options?.force && currentFolder.children && currentFolder.children.length > 0) {
      // 僅非同步更新遠端同步狀態
      get().loadFolderRemoteFiles(fullpath)
      return
    }
    
    // 檢查是否配置了雲同步
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    let hasCloudSync = false
    
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      hasCloudSync = !!accessToken
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      hasCloudSync = !!giteeAccessToken
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      hasCloudSync = !!gitlabAccessToken
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      hasCloudSync = !!giteaAccessToken
    } else if (primaryBackupMethod === 's3') {
      const s3Config = await store.get<S3Config>('s3SyncConfig')
      hasCloudSync = !!(s3Config && s3Config.accessKeyId && s3Config.secretAccessKey && s3Config.region && s3Config.bucket)
    } else if (primaryBackupMethod === 'webdav') {
      const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
      hasCloudSync = !!(webdavConfig && webdavConfig.url && webdavConfig.username && webdavConfig.password)
    }

    // 只有在配置了雲同步時才設定載入狀態
    if (hasCloudSync) {
      currentFolder.loading = true
      set({ fileTree: [...cacheTree] })
    }
    
    // 嘗試載入本地子目錄內容
    const workspace = await getWorkspacePath()
    const fullFolderPath = await join(workspace.path, fullpath)
    
    let children: DirTree[] = []
    
    // 檢查目錄是否存在
    let dirExists = false
    try {
      if (workspace.isCustom) {
        dirExists = await exists(fullFolderPath)
      } else {
        const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
        const pathOptions = await getFilePathOptions(dirRelative)
        dirExists = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
      }
    } catch {
      dirExists = false
    }
    
    // 如果目錄存在，載入本地檔案
    if (dirExists) {
      try {
        if (workspace.isCustom) {
          children = (await readDir(fullFolderPath))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined
            })) as DirTree[]
        } else {
          const dirRelative = await toWorkspaceRelativePath(fullFolderPath)
          const pathOptions = await getFilePathOptions(dirRelative)
          children = (await readDir(pathOptions.path, { baseDir: pathOptions.baseDir }))
            .filter(file => file.name !== '.DS_Store' && !file.name.startsWith('.') && (file.isDirectory || file.name.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)))
            .map(file => ({
              ...file,
              parent: currentFolder,
              isEditing: false,
              isLocale: true,
              sha: '',
              createdAt: undefined,
              modifiedAt: undefined,
              children: file.isDirectory ? [] : undefined
            })) as DirTree[]
        }
      } catch {
        // 讀取失敗，使用空陣列
      }
    }

    // 設定子節點（可能為空），並按當前檔案樹規則排序
    currentFolder.children = get().sortFileTree(children)
    set({ fileTree: [...cacheTree] })
    
    // 非同步載入遠端同步檔案狀態（不阻塞介面）
    // 這將會填充僅存在於雲端的檔案
    get().loadFolderRemoteFiles(fullpath)
  },
  
  // 載入特定資料夾的遠端同步檔案（後臺任務）
  loadFolderRemoteFiles: async (fullpath: string) => {
    const store = await getStore();
    const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
    
    // 檢查是否配置了訪問令牌
    if (primaryBackupMethod === 'github') {
      const accessToken = await store.get<string>('accessToken')
      if (!accessToken) return
    } else if (primaryBackupMethod === 'gitee') {
      const giteeAccessToken = await store.get<string>('giteeAccessToken')
      if (!giteeAccessToken) return
    } else if (primaryBackupMethod === 'gitlab') {
      const gitlabAccessToken = await store.get<string>('gitlabAccessToken')
      if (!gitlabAccessToken) return
    } else if (primaryBackupMethod === 'gitea') {
      const giteaAccessToken = await store.get<string>('giteaAccessToken')
      if (!giteaAccessToken) return
    } else if (primaryBackupMethod === 's3') {
      const s3Config = await store.get<S3Config>('s3SyncConfig')
      if (!s3Config || !s3Config.accessKeyId || !s3Config.secretAccessKey || !s3Config.region || !s3Config.bucket) return
    } else if (primaryBackupMethod === 'webdav') {
      const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
      if (!webdavConfig || !webdavConfig.url || !webdavConfig.username || !webdavConfig.password) return
    }

    try {
      let files;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo1 = await getSyncRepoName('github');
          files = await getGithubFiles({ path: fullpath, repo: githubRepo1 });
          break;
        case 'gitee':
          const giteeRepo1 = await getSyncRepoName('gitee');
          files = await getGiteeFiles({ path: fullpath, repo: giteeRepo1 });
          break;
        case 'gitlab':
          const gitlabRepo1 = await getSyncRepoName('gitlab');
          files = await getGitlabFiles({ path: fullpath, repo: gitlabRepo1 });
          break;
        case 'gitea':
          const giteaRepo1 = await getSyncRepoName('gitea');
          files = await getGiteaFiles({ path: fullpath, repo: giteaRepo1 });
          break;
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            files = await s3ListObjects(s3Config, fullpath)
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            files = await webdavListObjects(webdavConfig, fullpath)
          }
          break;
        }
      }

      if (files) {
        const cacheTree = get().fileTree
        const currentFolder = getCurrentFolder(fullpath, cacheTree)

        if (currentFolder) {
          // S3 和 WebDAV 返回的檔案格式相同，需要特殊處理
          if (primaryBackupMethod === 's3' || primaryBackupMethod === 'webdav') {
            const s3Files = files as Array<{ key: string; etag: string; lastModified: string; size: number }>
            let prefix = ''
            if (primaryBackupMethod === 's3') {
              const config = await store.get<S3Config>('s3SyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            } else {
              const config = await store.get<WebDAVConfig>('webdavSyncConfig')
              prefix = config?.pathPrefix ? config.pathPrefix.trim().replace(/\/+$/, '') : ''
            }
            const fullPrefix = prefix ? `${prefix}/${fullpath}` : fullpath

            s3Files.forEach((file) => {
              // 提取檔名（key 的最後一部分）
              const fileName = file.key.split('/').pop() || file.key
              // 過濾以"."開頭的檔案和資料夾
              if (fileName.startsWith('.')) {
                return;
              }

              // 只載入直接子項，不載入孫子項
              // 例如: fullPrefix='test', file.key='test/file.md' → 載入
              //      fullPrefix='test', file.key='test/sub/file.md' → 跳過
              const relativePath = fullPrefix ? file.key.substring(fullPrefix.length + 1) : file.key
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳過非直接子項
              }

              // S3 沒有資料夾概念，檢查 key 是否以 / 結尾來判斷是否是"資料夾"
              const isDirectory = file.key.endsWith('/')

              const index = currentFolder.children?.findIndex(item => item.name === fileName)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.etag
                currentFolder.children[index].size = file.size
                currentFolder.children[index].modifiedAt = file.lastModified
              } else {
                currentFolder.children?.push({
                  name: fileName,
                  isFile: !isDirectory,
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: isDirectory,
                  sha: file.etag,
                  size: file.size,
                  isLocale: false,
                  modifiedAt: file.lastModified,
                  children: isDirectory ? [] : undefined
                })
              }
            })
          } else {
            // Git 平臺處理邏輯
            files.forEach((file: GithubContent | GiteeFile | GiteaDirectoryItem) => {
              // 過濾以"."開頭的檔案和資料夾
              if (file.name.startsWith('.')) {
                return;
              }

              // 只載入直接子項，不載入孫子項
              // 例如: fullpath='test', file.path='test/file.md' → 載入
              //      fullpath='test', file.path='test/sub/file.md' → 跳過
              const relativePath = fullpath ? file.path.substring(fullpath.length + 1) : file.path
              const isDirectChild = !relativePath.includes('/')

              if (!isDirectChild) {
                return // 跳過非直接子項
              }

              const index = currentFolder.children?.findIndex(item => item.name === file.name)
              if (index !== undefined && index !== -1 && currentFolder.children) {
                currentFolder.children[index].sha = file.sha
                currentFolder.children[index].size = (file as any).size
              } else {
                currentFolder.children?.push({
                  name: file.name,
                  isFile: file.type === 'file',
                  isSymlink: false,
                  parent: currentFolder,
                  isEditing: false,
                  isDirectory: file.type === 'dir',
                  sha: file.sha,
                  size: (file as any).size,
                  isLocale: false,
                  children: file.type === 'file' ? undefined : []
                })
              }
            });
          }

          // 移除載入狀態
          currentFolder.loading = false
          set({ fileTree: [...cacheTree] })
        }
      }
    } catch {
      // 確保載入狀態被移除
      const cacheTree = get().fileTree
      const currentFolder = getCurrentFolder(fullpath, cacheTree)
      if (currentFolder) {
        currentFolder.loading = false
        set({ fileTree: [...cacheTree] })
      }
    }
  },
  newFolder: async () => {
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isDirectory)
    if (exists) {
      return
    }
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      children: []
    }

    try {
      cacheTree.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },
  newFile: async () => {
    // 檢查現有樹中是否已有空檔名的檔案（正在編輯中）
    const cacheTree = cloneDeep(get().fileTree)
    const exists = cacheTree.find(item => item.name === '' && item.isFile)
    if (exists) {
      return
    }
  
    // 判斷 activeFilePath 是否存在 parent
    const path = get().activeFilePath;
    if (path.includes('/')) {
      // 在當前活動檔案的父資料夾下建立新檔案
      const folderPath = path.split('/').slice(0, -1).join('/')
      const currentFolder = getCurrentFolder(folderPath, cacheTree)
      
      // 如果資料夾中已經有一個空名稱的檔案，不再建立新的
      if (currentFolder?.children?.find(item => item.name === '' && item.isFile)) {
        return
      }
      
      // 確保資料夾是展開狀態
      const collapsibleList = get().collapsibleList
      if (!collapsibleList.includes(folderPath)) {
        collapsibleList.push(folderPath)
        set({ collapsibleList })
      }
      
      if (currentFolder) {
        const newFile: DirTree = {
          name: '',
          isFile: true,
          isSymlink: false,
          parent: currentFolder,
          isEditing: true,
          isDirectory: false,
          isLocale: true,
          sha: '',
          children: []
        }
        currentFolder.children?.unshift(newFile)
        set({ fileTree: cacheTree })
      }
    } else {
      // 不存在 parent，直接在根目錄下建立
      const newFile: DirTree = {
        name: '',
        isFile: true,
        isSymlink: false,
        parent: undefined,
        isEditing: true,
        isDirectory: false,
        isLocale: true,
        sha: '',
        children: []
      }
      cacheTree.unshift(newFile)
      set({ fileTree: cacheTree })
    }
  },

  newFileOnFolder: async (path: string) => {
    // 獲取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 獲取工作區路徑資訊
    const workspace = await getWorkspacePath()
    
    // 建立新檔案
    const file = `新建檔案-${new Date().getTime()}.md`
    const fullPath = `${path}/${file}`
    const pathOptions = await getFilePathOptions(fullPath)
    
    // 寫入空檔案
    if (workspace.isCustom) {
      await writeTextFile(pathOptions.path, '')
    } else {
      await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
    }

    // 更新樹
    const node = {
      name: file,
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isEditing: false,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
      get().setActiveFilePath(fullPath)
    } catch {
    }
  },
  newFolderInFolder: async (path: string) => {
    // 獲取 parent folder
    const cacheTree = cloneDeep(get().fileTree)
    const currentFolder = path.includes('/') ? getCurrentFolder(path, cacheTree) : cacheTree.find(item => item.name === path)
    
    // 如果資料夾中已存在未命名資料夾，不建立新的
    const hasEmptyFolder = currentFolder?.children?.find(item => item.name === '' && item.isDirectory)
    if (hasEmptyFolder) {
      return
    }

    // 更新樹
    const node = {
      name: '',
      isFile: false,
      isDirectory: true,
      isSymlink: false,
      isEditing: true,
      isLocale: true,
      parent: currentFolder,
      sha: '',
      children: []
    }

    try {
      currentFolder?.children?.unshift(node as DirTree)
      set({ fileTree: cacheTree })
    } catch {
    }
  },

  collapsibleList: [],
  collapsibleListInitialized: false,
  initCollapsibleList: async () => {
    // 防止重複初始化
    if (get().collapsibleListInitialized) {
      return
    }

    const store = await getStore();
    const res = await store.get<string[]>('collapsibleList')
    const activeFilePath = await store.get<string>('activeFilePath')
    set({
      collapsibleList: res ? uniq(res.filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i))) : [],
      collapsibleListInitialized: true
    })

    if (activeFilePath) {
      set({ activeFilePath })

      // 檢查是否是資料夾（所有支援的副檔名都是檔案，不是資料夾）
      if (!activeFilePath.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) {
        // 資料夾：確保展開並載入內容
        if (!get().collapsibleList.includes(activeFilePath)) {
          await get().setCollapsibleList(activeFilePath, true)
        }
        await get().loadCollapsibleFiles(activeFilePath)
      } else {
        // 檔案：讀取內容
        get().readArticle(activeFilePath)
      }
    }
  },
  
  setCollapsibleList: async (path: string, value: boolean) => {
    const collapsibleList = cloneDeep(get().collapsibleList)
    if (value) {
      collapsibleList.push(path)
    } else {
      const index = collapsibleList.indexOf(path)
      if (index !== -1) {
        collapsibleList.splice(index, 1)
      }
    }
    const store = await getStore();
    await store.set('collapsibleList', collapsibleList)
    set({ collapsibleList: uniq(collapsibleList).filter(item => !item.match(/\.(md|txt|markdown|py|js|ts|jsx|tsx|css|scss|less|html|xml|json|yaml|yml|sh|bash|java|c|cpp|h|go|rs|sql|rb|php|vue|svelte|astro|toml|ini|conf|cfg|gitignore|env|example|template|jpg|jpeg|png|gif|bmp|webp|svg)$/i)) })
  },
  
  expandAllFolders: async () => {
    // Get all folder paths from fileTree recursively
    const getAllFolderPaths = (tree: DirTree[], parentPath: string = ''): string[] => {
      let paths: string[] = []
      for (const item of tree) {
        if (!item.isFile) {
          const currentPath = parentPath ? `${parentPath}/${item.name}` : item.name
          paths.push(currentPath)
          if (item.children && item.children.length > 0) {
            paths = [...paths, ...getAllFolderPaths(item.children, currentPath)]
          }
        }
      }
      return paths
    }
    
    const folderPaths = getAllFolderPaths(get().fileTree)
    const store = await getStore()
    await store.set('collapsibleList', folderPaths)
    set({ collapsibleList: uniq(folderPaths) })
    
    // Load all children for expanded folders
    for (const path of folderPaths) {
      await get().loadCollapsibleFiles(path)
    }
  },
  
  collapseAllFolders: async () => {
    const store = await getStore()
    await store.set('collapsibleList', [])
    set({ collapsibleList: [] })
  },
  
  toggleAllFolders: async () => {
    // If there are any expanded folders, collapse all; otherwise, expand all
    if (get().collapsibleList.length > 0) {
      await get().collapseAllFolders()
    } else {
      await get().expandAllFolders()
    }
  },
  clearCollapsibleList: async () => {
    set({ collapsibleList: [] })
    const store = await getStore()
    await store.set('collapsibleList', [])
  },

  currentArticle: '',
  readFilePath: '',
  isPulling: false, // 新增：拉取狀態
  justPulledFile: false, // 標記是否剛從遠端拉取檔案
  skipSyncOnSave: false, // 標記是否跳過同步
  aiGeneratingFilePath: null, // 標記當前正在 AI 生成的檔案路徑
  aiTerminateFn: null, // AI 生成的終止函式

  setReadFilePath: (path: string) => {
    set({ readFilePath: path })
  },

  readArticle: async (path: string, sha?: string, autoSync = true) => {
    get().setLoading(true)

    // 設定當前正在讀取的檔案路徑，用於避免競態條件
    set({ readFilePath: path })

    // 處理檔名相容性問題
    let actualPath = path
    if (hasInvalidFileNameChars(path)) {
      actualPath = sanitizeFilePath(path)
      // 更新活動檔案路徑為清理後的路徑
      await get().setActiveFilePath(actualPath)
    }

    // 優先載入本地內容（快速響應）
    let localContent = ''

    // 輔助函式：查詢檔案資訊
    const findFileInTree = (tree: DirTree[], targetPath: string): DirTree | null => {
      for (const item of tree) {
        const itemPath = computedParentPath(item)
        if (itemPath === targetPath && item.isFile) {
          return item
        }
        if (item.children && item.children.length > 0) {
          const found = findFileInTree(item.children, targetPath)
          if (found) return found
        }
      }
      return null
    }

    try {
      const workspace = await getWorkspacePath()
      const pathOptions = await getFilePathOptions(actualPath)
      if (workspace.isCustom) {
        localContent = await readTextFile(pathOptions.path)
      } else {
        localContent = await readTextFile(pathOptions.path, { baseDir: pathOptions.baseDir })
      }

      // 檢查是否是遠端檔案且本地內容為空
      const fileTree = get().fileTree
      const fileInfo = findFileInTree(fileTree, actualPath)
      const isRemoteFile = fileInfo && !fileInfo.isLocale

      // 如果是遠端檔案且本地內容為空，先顯示編輯器（禁用），再非同步拉取
      if (isRemoteFile && (!localContent || localContent.trim() === '')) {
        // 先設定當前內容為空，顯示編輯器
        set({ currentArticle: '', loading: true })

        // 標記正在拉取
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        // 非同步拉取遠端內容
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            // 再次檢查當前是否還是同一個檔案
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
              emitter.emit('editor-content-from-remote', { content: remoteContent })
            }

            // 拉取成功後，更新檔案樹的 isLocale 狀態為本地檔案
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)

        return
      }

      // 正常的本地檔案，顯示內容（即使是空檔案也正確顯示）
      set({ currentArticle: localContent })
      // 本地內容載入完成，解除載入狀態
      get().setLoading(false)
      // 檢查檔案的向量索引狀態
      get().checkFileVectorIndexed(actualPath)
    } catch (error) {
      // 本地檔案不存在，檢查是否是遠端檔案

      // 先查詢檔案資訊（可能 fileTree 還沒載入完成）
      const fileInfo = findFileInTree(get().fileTree, actualPath)

      // 檢查是否是"檔案不存在"錯誤（相容不同平臺的大小寫）
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isFileNotFound = errorMsg.toLowerCase().includes('no such file') ||
                            errorMsg.toLowerCase().includes('not found') ||
                            errorMsg.toLowerCase().includes('系統找不到指定的路徑')

      if (isFileNotFound && fileInfo && !fileInfo.isLocale) {
        // 先設定當前內容為空，顯示編輯器
        set({ currentArticle: '', loading: true })

        // 標記正在拉取
        get().setIsPulling(true)
        get().setJustPulledFile(true)

        // 非同步拉取遠端內容
        setTimeout(async () => {
          try {
            const remoteContent = await pullRemoteFile(actualPath)
            await saveLocalFile(actualPath, remoteContent)

            // 再次檢查當前是否還是同一個檔案
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: remoteContent })
              emitter.emit('editor-content-from-remote', { content: remoteContent })
            }

            // 拉取成功後，更新檔案樹的 isLocale 狀態為本地檔案
            const cacheTree = cloneDeep(get().fileTree)
            const fileNode = findFileInTree(cacheTree, actualPath)
            if (fileNode) {
              fileNode.isLocale = true
              set({ fileTree: cacheTree })
            }
          } catch {
            if (get().activeFilePath === actualPath) {
              set({ currentArticle: '' })
            }
          } finally {
            get().setIsPulling(false)
            get().setLoading(false)
            setTimeout(() => {
              get().setJustPulledFile(false)
            }, 1000)
          }
        }, 0)
      } else if (isFileNotFound) {
        // 本地檔案，建立空白檔案
        await ensureDirectoryExists(actualPath)
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(actualPath)

        try {
          if (workspace.isCustom) {
            await writeTextFile(pathOptions.path, '')
          } else {
            await writeTextFile(pathOptions.path, '', { baseDir: pathOptions.baseDir })
          }
          set({ currentArticle: '' })
          get().setLoading(false)
        } catch {
          get().setLoading(false)
        }
      } else {
        set({ currentArticle: '' })
        get().setLoading(false)
      }
    }

    // 非同步檢查遠端更新（使用新的 SyncManager）
    // 只有噹噹前讀取的檔案路徑仍然是 actualPath 時才執行同步
    // 同時檢查 activeFilePath 是否仍然匹配，防止競態條件
    if (autoSync && await hasNetworkConnection()) {
      try {
        // 在執行同步前檢查路徑是否仍然匹配
        const currentReadPath = get().readFilePath
        const currentActivePath = get().activeFilePath
        if (currentReadPath === actualPath && currentActivePath === actualPath) {
          const result = await syncOnOpen(actualPath)
          // 在設定 content 前再次確認路徑沒有變化
          if (result?.updated && result.content && get().activeFilePath === actualPath) {
            // 拉取了新內容，更新 currentArticle
            set({ currentArticle: result.content })
          }
        }
      } catch {
      }
    }

    // 讀取完成後清除 readFilePath（僅當沒有其他 readArticle 在執行時）
    // 透過檢查 activeFilePath 是否變化來判斷
    if (get().activeFilePath === actualPath) {
      set({ readFilePath: '' })
    }
  },

  // 向量計算相關狀態
  vectorCalcTimer: null as NodeJS.Timeout | null,
  vectorCalcProgressInterval: null as NodeJS.Timeout | null,
  vectorCalcProgress: 0, // 0-100，表示距離自動計算的進度
  isVectorCalculating: false,
  lastEditTime: 0,
  pendingVectorContent: null as { path: string; content: string } | null,
  // 向量索引狀態
  vectorIndexedFiles: new Map<string, number>(), // 檔名 -> 向量索引時間戳

  setCurrentArticle: (content: string) => {
    set({ currentArticle: content })
  },

  setIsPulling: (pulling: boolean) => {
    set({ isPulling: pulling })
  },

  setJustPulledFile: (justPulled: boolean) => {
    set({ justPulledFile: justPulled })
  },

  setSkipSyncOnSave: (skip: boolean) => {
    set({ skipSyncOnSave: skip })
  },

  setAiGeneratingFilePath: (path: string | null) => {
    set({ aiGeneratingFilePath: path })
  },

  setAiTerminateFn: (fn: (() => void) | null) => {
    set({ aiTerminateFn: fn })
  },

  // 更新檔案 sha 狀態（推送成功後呼叫）
  updateFileSha: (path: string, sha: string) => {
    const cacheTree = cloneDeep(get().fileTree)

    // 遞迴查詢並更新檔案的 sha
    const updateShaInTree = (items: DirTree[], depth: number = 0): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path && item.isFile) {
          item.sha = sha
          return true
        }
        if (item.children && updateShaInTree(item.children, depth + 1)) {
          return true
        }
      }
      return false
    }

    if (updateShaInTree(cacheTree)) {
      const sortedTree = get().sortFileTree(cacheTree)
      set({ fileTree: sortedTree })
    } else {
      // 未找到匹配的檔案
    }
  },

  saveCurrentArticle: async (content: string) => {
    const path = get().activeFilePath
    const justPulled = get().justPulledFile

    if (path && content !== undefined && content !== null) {
      // 如果是從遠端剛拉取的檔案，不觸發推送（避免 SHA 不匹配錯誤）
      if (justPulled) {
        // 清除標誌
        get().setJustPulledFile(false)
        // 只儲存本地檔案，不觸發同步推送
        const workspace = await getWorkspacePath()
        const pathOptions = await getFilePathOptions(path)
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, content)
        } else {
          await writeTextFile(pathOptions.path, content, { baseDir: pathOptions.baseDir })
        }
        set({ currentArticle: content })
        return
      }

      // 清除之前的防抖定時器
      const existingTimer = get().debounceSaveTimer
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // 設定新的防抖定時器，500ms 後執行儲存
      // 這樣可以合併短時間內多次 content change
      // 儲存 pendingContent 用於防抖檢查
      set({ pendingSaveContent: content, debounceSaveTimer: undefined })
      const timer = setTimeout(async () => {
        const state = get()
        const debouncedContent = state.pendingSaveContent || content

        // Bug fix: 檢查路徑是否仍然匹配，避免檔案切換時儲存到錯誤的檔案
        const currentActivePath = state.activeFilePath
        if (currentActivePath !== path) {
          // 檔案已切換，取消儲存
          set({ debounceSaveTimer: null, pendingSaveContent: null })
          return
        }

        set({ debounceSaveTimer: null, pendingSaveContent: null })

        // 執行實際儲存操作
        const savePath = path
        const saveContent = debouncedContent
        const workspace = await getWorkspacePath()

        // 檢查檔案是否存在
        let isLocale = false
        const pathOptions = await getFilePathOptions(savePath)
        if (workspace.isCustom) {
          isLocale = await exists(pathOptions.path)
        } else {
          isLocale = await exists(pathOptions.path, { baseDir: pathOptions.baseDir })
        }

        // 確保目錄結構存在
        if (savePath.includes('/')) {
          let dir = ''
          const dirPath = savePath.split('/')
          for (let index = 0; index < dirPath.length - 1; index += 1) {
            dir += `${dirPath[index]}/`
            const dirOptions = await getFilePathOptions(dir)
            let dirExists = false
            if (workspace.isCustom) {
              dirExists = await exists(dirOptions.path)
            } else {
              dirExists = await exists(dirOptions.path, { baseDir: dirOptions.baseDir })
            }
            if (!dirExists) {
              if (workspace.isCustom) {
                await mkdir(dirOptions.path)
              } else {
                await mkdir(dirOptions.path, { baseDir: dirOptions.baseDir })
              }
            }
          }
        }

        // 儲存檔案內容
        if (workspace.isCustom) {
          await writeTextFile(pathOptions.path, saveContent)
        } else {
          await writeTextFile(pathOptions.path, saveContent, { baseDir: pathOptions.baseDir })
        }

        // 更新快取樹
        if (!isLocale) {
          const cacheTree = cloneDeep(get().fileTree)
          const current = savePath.includes('/') ? getCurrentFolder(savePath, cacheTree) : cacheTree.find(item => item.name === savePath)
          if (current) {
            current.isLocale = true

            // 更新父資料夾鏈的 isLocale 狀態
            const updateParentFolders = async (node: DirTree | undefined) => {
              let parent = node
              const pathParts = savePath.split('/')
              let currentDepth = pathParts.length - 1

              while (parent && currentDepth > 0) {
                if (parent.isLocale) {
                  break
                }
                const parentPath = pathParts.slice(0, currentDepth).join('/')
                const parentOptions = await getFilePathOptions(parentPath)
                let parentExists = false
                try {
                  if (workspace.isCustom) {
                    parentExists = await exists(parentOptions.path)
                  } else {
                    parentExists = await exists(parentOptions.path, { baseDir: parentOptions.baseDir })
                  }
                } catch {
                  parentExists = false
                }
                if (parentExists) {
                  parent.isLocale = true
                  parent = parent.parent
                  currentDepth--
                } else {
                  break
                }
              }
            }

            await updateParentFolders(current.parent)
          }
          set({ fileTree: cacheTree })
        }

        // 觸發防抖向量計算
        if (savePath.endsWith('.md')) {
          get().scheduleVectorCalculation(savePath, saveContent)
        }

        // 更新 currentArticle
        set({ currentArticle: saveContent })

        // 記錄寫作活動（獨立事件日誌，不受後續刪除影響）
        try {
          const { recordWritingActivity } = await import('@/db/activity')
          const fileName = savePath.split('/').pop() || savePath
          await recordWritingActivity({
            path: savePath,
            title: fileName,
            description: savePath,
          })
        } catch (error) {
          console.error('記錄寫作活動失敗:', error)
        }

        // 通知檔案已儲存，觸發同步推送（除非設定了 skipSyncOnSave）
        const shouldSkipSync = get().skipSyncOnSave
        if (!shouldSkipSync) {
          emitter.emit('article-saved', { path: savePath, content: saveContent })
        }
      }, 500)

      // 儲存待處理的內容（最新的內容）
      set({ debounceSaveTimer: timer as any, pendingSaveContent: content })
    }
  },

  // 安排向量計算（防抖5秒）
  scheduleVectorCalculation: (path: string, content: string) => {
    const state = get()
    
    // 清除之前的定時器
    if (state.vectorCalcTimer) {
      clearTimeout(state.vectorCalcTimer)
    }
    if (state.vectorCalcProgressInterval) {
      clearInterval(state.vectorCalcProgressInterval)
    }
    
    // 更新最後編輯時間和待處理內容
    const now = Date.now()
    set({ 
      lastEditTime: now,
      pendingVectorContent: { path, content },
      vectorCalcProgress: 0
    })
    
    // 建立進度更新定時器（每100ms更新一次進度）
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - get().lastEditTime
      const progress = Math.min((elapsed / 5000) * 100, 100)
      set({ vectorCalcProgress: progress })
      
      if (progress >= 100) {
        clearInterval(progressInterval)
      }
    }, 100)
    
    // 設定5秒後自動執行向量計算
    const timer = setTimeout(() => {
      clearInterval(progressInterval)
      get().executeVectorCalculation()
    }, 5000)
    
    set({ 
      vectorCalcTimer: timer as any,
      vectorCalcProgressInterval: progressInterval as any
    })
  },

  // 執行向量計算
  executeVectorCalculation: async () => {
    const state = get()
    
    // 如果沒有待處理內容或正在計算中，直接返回
    if (!state.pendingVectorContent || state.isVectorCalculating) {
      return
    }
    
    try {
      set({ isVectorCalculating: true, vectorCalcProgress: 100 })
      
      const { path, content } = state.pendingVectorContent
      const vectorStore = useVectorStore.getState()

      // 執行向量計算
      await vectorStore.processDocument(path, content)
      // 更新向量索引狀態
      const vectorKey = getVectorDocumentKey(path)
      const newMap = new Map(get().vectorIndexedFiles)
      newMap.set(vectorKey, Date.now())
      set({ vectorIndexedFiles: newMap })

      // 清除待處理內容和定時器
      if (state.vectorCalcTimer) {
        clearTimeout(state.vectorCalcTimer)
      }
      if (state.vectorCalcProgressInterval) {
        clearInterval(state.vectorCalcProgressInterval)
      }
      
      set({ 
        pendingVectorContent: null,
        vectorCalcTimer: null,
        vectorCalcProgressInterval: null,
        vectorCalcProgress: 0
      })
    } catch {
      set({ isVectorCalculating: false })
    }
  },

  // 取消向量計算
  cancelVectorCalculation: () => {
    const state = get()
    if (state.vectorCalcTimer) {
      clearTimeout(state.vectorCalcTimer)
    }
    if (state.vectorCalcProgressInterval) {
      clearInterval(state.vectorCalcProgressInterval)
    }
    set({
      vectorCalcTimer: null,
      vectorCalcProgressInterval: null,
      vectorCalcProgress: 0,
      pendingVectorContent: null
    })
  },

  // 檢查檔案是否已被向量索引
  checkFileVectorIndexed: async (filePath: string) => {
    const { checkVectorDocumentExists, getVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    const hasVector = await checkVectorDocumentExists(vectorKey)
    if (hasVector) {
      // 獲取向量文件記錄更新時間
      const docs = await getVectorDocumentsByFilename(vectorKey)
      if (docs.length > 0) {
        const latestTime = Math.max(...docs.map(d => d.updated_at))
        const newMap = new Map(get().vectorIndexedFiles)
        newMap.set(vectorKey, latestTime)
        set({ vectorIndexedFiles: newMap })
        return true
      }
    }
    // 如果沒有向量，從對映中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
    return false
  },

  // 清除檔案的向量資料
  clearFileVector: async (filePath: string) => {
    const { deleteVectorDocumentsByFilename } = await import('@/db/vector')
    const vectorKey = getVectorDocumentKey(filePath)
    await deleteVectorDocumentsByFilename(vectorKey)
    // 從對映中移除
    const newMap = new Map(get().vectorIndexedFiles)
    newMap.delete(vectorKey)
    set({ vectorIndexedFiles: newMap })
  },

  // 初始化向量索引狀態 - 載入所有已索引的檔案
  initVectorIndexedFiles: async () => {
    try {
      const { getAllVectorDocumentFilenames, getVectorDocumentsByFilename } = await import('@/db/vector')
      const indexedFiles = await getAllVectorDocumentFilenames()

      // 構建 vectorIndexedFiles Map
      const vectorIndexedDocs = []
      for (const file of indexedFiles) {
        const docs = await getVectorDocumentsByFilename(file.filename)
        vectorIndexedDocs.push(...docs)
      }

      const vectorIndexedMap = buildVectorIndexedMap(vectorIndexedDocs)

      set({ vectorIndexedFiles: vectorIndexedMap })
    } catch {
    }
  },

  // 手動觸發向量計算（使用當前文章內容）
  triggerVectorCalculation: async () => {
    const state = get()
    if (!state.activeFilePath || state.isVectorCalculating) {
      return
    }

    // 使用當前文章內容
    const content = state.currentArticle
    if (!content) {
      return
    }

    // 設定待處理內容並執行
    set({
      pendingVectorContent: {
        path: state.activeFilePath,
        content
      }
    })

    await get().executeVectorCalculation()
  },

  // 設定向量計算狀態
  setVectorCalcStatus: (path: string, status: 'idle' | 'calculating' | 'completed') => {
    const fileTree = get().fileTree

    // 遞迴查詢並更新檔案/資料夾的狀態
    const updateStatus = (items: DirTree[]): boolean => {
      for (const item of items) {
        const itemPath = computedParentPath(item)
        if (itemPath === path) {
          item.vectorCalcStatus = status
          return true
        }
        if (item.children && updateStatus(item.children)) {
          return true
        }
      }
      return false
    }

    updateStatus(fileTree)
    set({ fileTree: [...fileTree] })
  },

  allArticle: [],
  loadAllArticle: async () => {
    const workspace = await getWorkspacePath()
    let allArticle: Article[] = []
    
    const readDirRecursively = async (dirPath: string, basePath: string, isCustomWorkspace: boolean): Promise<Article[]> => {
      let allArticles: Article[] = []
      
      // 讀取當前目錄內容
      const res = isCustomWorkspace 
        ? await readDir(dirPath)
        : await readDir(dirPath, { baseDir: BaseDirectory.AppData })
      
      // 過濾檔案
      const files = res.filter(file => 
        file.isFile && 
        file.name !== '.DS_Store' && 
        !file.name.startsWith('.') && 
        file.name.endsWith('.md')
      )
      
      // 新增檔案到結果列表
      for (const file of files) {
        // 構建相對路徑
        const relativePath = await join(basePath, file.name)
        
        // 讀取檔案內容
        let article = ''
        if (isCustomWorkspace) {
          const fullPath = await join(dirPath, file.name)
          article = await readTextFile(fullPath)
        } else {
          article = await readTextFile(`${dirPath}/${file.name}`, { baseDir: BaseDirectory.AppData })
        }
        
        allArticles.push({ article, path: relativePath })
      }
      
      // 遞迴處理子目錄
      const directories = res.filter(entry => 
        entry.isDirectory && 
        !entry.name.startsWith('.')
      )
      
      for (const dir of directories) {
        const newDirPath = await join(dirPath, dir.name)
        const newBasePath = await join(basePath, dir.name)
        const subDirArticles = await readDirRecursively(newDirPath, newBasePath, isCustomWorkspace)
        allArticles = [...allArticles, ...subDirArticles]
      }
      
      return allArticles
    }

    if (workspace.isCustom) {
      // 自定義工作區
      allArticle = await readDirRecursively(workspace.path, '', true)
    } else {
      // 預設工作區
      allArticle = await readDirRecursively('article', '', false)
    }

    set({ allArticle })
  }
}))

export default useArticleStore
