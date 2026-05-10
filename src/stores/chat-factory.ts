import { create, StoreApi, UseBoundStore } from 'zustand'
import { Chat, clearChatsByTagId, deleteChat, initChatsDb, insertChat, updateChat, updateChatsInsertedById, getAllChats, deleteAllChats, insertChats, updateChatCondensedContent, getChatsByConversation } from '@/db/chats'
import { uploadFile as uploadGithubFile, getFiles as githubGetFiles, decodeBase64ToString } from '@/lib/sync/github';
import { uploadFile as uploadGiteeFile, getFiles as giteeGetFiles } from '@/lib/sync/gitee';
import { uploadFile as uploadGitlabFile, getFiles as gitlabGetFiles, getFileContent as gitlabGetFileContent } from '@/lib/sync/gitlab';
import { uploadFile as uploadGiteaFile, getFiles as giteaGetFiles, getFileContent as giteaGetFileContent } from '@/lib/sync/gitea';
import { s3Upload, s3Delete, s3HeadObject, s3Download } from '@/lib/sync/s3'
import { webdavUpload, webdavDelete, webdavHeadObject, webdavDownload } from '@/lib/sync/webdav'
import { getSyncRepoName } from '@/lib/sync/repo-utils';
import { getRemoteFileContent } from '@/lib/sync/remote-file';
import { Store } from '@tauri-apps/plugin-store';
import { locales } from '@/lib/locales';
import { AgentState, ToolCall } from '@/lib/agent/types'
import { LinkedResource } from '@/lib/files'
import type { Conversation, ConversationSource } from '@/db/conversations'
import { S3Config, WebDAVConfig } from '@/types/sync'

// 模块级别的 condense 版本计数器，防止竞态条件
// 跨 store 共用 (notes / browser 都遞增同一個計數器) — 仍然 monotonic、不衝突
let _condenseVersion = 0

export interface PendingQuote {
  quote: string
  fullContent: string
  fileName: string
  startLine: number
  endLine: number
  from: number
  to: number
  articlePath: string
}

// M1: browser 模式下「當前網頁」context — 由 browser-webview 在頁面載入完成後 auto-extract
// 寫進來，chat-send 送訊息時 prepend 到 system message。User 可在 chat-input pill 上 ✕ 拔掉。
export interface CurrentPageContext {
  url: string
  title: string
  content: string
}

// MCP 工具调用记录（临时，不保存到数据库）
export interface McpToolCall {
  id: string
  chatId: number
  toolName: string
  serverId: string
  serverName: string
  params: Record<string, any>
  result: string
  status: 'calling' | 'success' | 'error'
  timestamp: number
}

export interface ChatState {
  // 此 store 服務的對話 source ('notes' | 'browser')，提供給 AI runtime / agent 識別
  source: ConversationSource

  loading: boolean
  setLoading: (loading: boolean) => void

  isCondensing: boolean
  _condenseLock: boolean
  maybeCondense: () => void

  // 兼容旧代码：按标签加载（内部映射到默认会话）
  chats: Chat[]
  init: (tagId: number) => Promise<void>
  insert: (chat: Omit<Chat, 'id' | 'createdAt'>) => Promise<Chat | null>
  updateChat: (chat: Chat) => void
  saveChat: (chat: Chat, isSave?: boolean) => Promise<void>
  deleteChat: (id: number) => Promise<void>

  locale: string
  getLocale: () => Promise<void>
  setLocale: (locale: string) => void

  clearChats: (tagId: number) => Promise<void>
  updateInsert: (id: number) => Promise<void>

  // 同步
  syncState: boolean
  setSyncState: (syncState: boolean) => void
  lastSyncTime: string
  setLastSyncTime: (lastSyncTime: string) => void
  uploadChats: () => Promise<boolean>
  downloadChats: () => Promise<Chat[]>

  // MCP 工具调用记录（临时缓存）
  mcpToolCalls: McpToolCall[]
  addMcpToolCall: (toolCall: McpToolCall) => void
  updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => void
  getMcpToolCallsByChatId: (chatId: number) => McpToolCall[]
  clearMcpToolCalls: () => void

  // Agent 模式
  agentState: AgentState
  setAgentState: (state: Partial<AgentState>) => void
  resetAgentState: () => void
  addAgentToolCall: (toolCall: ToolCall) => void
  updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => void
  agentAutoApproveConversationId: number | null
  setAgentAutoApproveConversationId: (conversationId: number | null) => void
  agentAutoApproveRuntimeSkillId: string | null
  setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => void

  // Placeholder 状态
  isPlaceholderEnabled: boolean
  setPlaceholderEnabled: (enabled: boolean) => void

  // 关联的文件或文件夹（仅 notes store 实际使用，browser store 永远 null）
  linkedResource: LinkedResource | null
  setLinkedResource: (resource: LinkedResource | null) => void

  // 关联文件的行号预览（仅 notes store 实际使用）
  linkedResourcePreview: string | null
  setLinkedResourcePreview: (preview: string | null) => void

  pendingQuote: PendingQuote | null
  setPendingQuote: (quote: PendingQuote | null) => void
  clearPendingQuote: () => void

  // M1: 仅 browser store 使用 — 當前網頁 auto-extracted context（notes store 永远 null）
  currentPageContext: CurrentPageContext | null
  setCurrentPageContext: (ctx: CurrentPageContext | null) => void

  // 仅 notes store 使用（onboarding 流程是 notes-only）
  onboardingPromptDraft: string | null
  setOnboardingPromptDraft: (prompt: string | null) => void

  // === 会话管理 ===
  currentConversationId: number | null
  conversations: Conversation[]

  // 当 init() 在 Chat 元件重新 mount 时被呼叫（例如 workspace mode 切换造成
  // page.tsx return 不同 JSX 树、Chat 整组 unmount/remount），原本的 auto-
  // restore 逻辑会把刚被 startNewConversation 清掉的 currentConversationId
  // 重新设回最近的对话——defeat 整个清空意图。
  // startNewConversation 会把这个 flag 设成 true，init() 看到就跳过 auto-
  // restore，并在自己跑完后把 flag 清回 false（一次性的）。
  skipAutoRestore: boolean

  initConversations: () => Promise<void>
  createConversation: (title?: string) => Promise<number>
  switchConversation: (id: number) => Promise<void>
  updateConversationTitle: (id: number, title: string) => Promise<void>
  deleteConversation: (id: number) => Promise<void>
  toggleConversationPin: (id: number) => Promise<boolean>
  startNewConversation: () => Promise<void>
}

export interface ChatStoreOptions {
  source: ConversationSource
}

// Zustand store 的 hook 型別 (UseBoundStore<StoreApi<ChatState>>) 透過 typeof 從 create 推回，
// 但因為 generic create 在這裡是 inline 呼叫，匯出工廠的回傳型別需要顯式宣告以利消費端 import。
export type ChatStore = UseBoundStore<StoreApi<ChatState>>

export function createChatStore(opts: ChatStoreOptions): ChatStore {
  const { source } = opts

  return create<ChatState>((set, get) => ({
    source,

    loading: false,
    setLoading: (loading: boolean) => set({ loading }),

    isCondensing: false,
    _condenseLock: false,

    maybeCondense: () => {
      const state = get()

      if (state._condenseLock) {
        return
      }

      const currentVersion = ++_condenseVersion

      const { chats } = state

      const lastClearIndex = chats.findLastIndex(c => c.type === 'clear')
      const chatsAfterClear = lastClearIndex === -1 ? chats : chats.slice(lastClearIndex + 1)

      ;(async () => {
        const { shouldCondense, condenseChats } = await import('@/lib/ai/condense')

        if (currentVersion !== _condenseVersion) {
          return
        }

        if (!(await shouldCondense(chatsAfterClear))) {
          return
        }

        if (currentVersion !== _condenseVersion) {
          return
        }

        set({ _condenseLock: true, isCondensing: true })

        try {
          const condensedResults = await condenseChats(chatsAfterClear)

          if (currentVersion !== _condenseVersion) {
            return
          }

          for (const result of condensedResults) {
            if (result.summary) {
              await updateChatCondensedContent(result.chatId, result.summary)

              set({
                chats: get().chats.map(c =>
                  c.id === result.chatId
                    ? { ...c, condensedContent: result.summary || undefined, condensedAt: Date.now() }
                    : c
                )
              })
            }
          }
        } catch (error) {
          console.error(`[ChatStore:${source}] 压缩失败:`, error)
        } finally {
          set({ _condenseLock: false, isCondensing: false })
        }
      })()
    },

    agentState: {
      activeChatId: undefined,
      isRunning: false,
      isThinking: false,
      currentThought: '',
      thoughtHistory: [],
      completedSteps: [],
      currentAction: undefined,
      currentObservation: undefined,
      toolCalls: [],
      maxIterations: 15,
      currentIteration: 0,
      pendingConfirmation: undefined,
      confirmationHistory: [],
      loadedSkills: undefined,
      selectedSkills: undefined,
      currentStepStartTime: undefined,
      ragSources: undefined,
      ragSourceDetails: undefined,
    },

    setAgentState: (state: Partial<AgentState>) => {
      set({ agentState: { ...get().agentState, ...state } })
    },

    resetAgentState: () => {
      const currentState = get().agentState
      set({
        agentState: {
          activeChatId: undefined,
          isRunning: false,
          isThinking: false,
          currentThought: '',
          thoughtHistory: [],
          completedSteps: [],
          currentAction: '',
          currentObservation: '',
          toolCalls: [],
          maxIterations: 15,
          currentIteration: 0,
          pendingConfirmation: undefined,
          confirmationHistory: [],
          loadedSkills: undefined,
          selectedSkills: undefined,
          currentStepStartTime: undefined,
          ragSources: currentState.ragSources,
          ragSourceDetails: currentState.ragSourceDetails,
          isFinalAnswerMode: false,
          finalAnswerContent: undefined,
        }
      })
    },

    addAgentToolCall: (toolCall: ToolCall) => {
      const agentState = get().agentState
      set({
        agentState: {
          ...agentState,
          toolCalls: [...agentState.toolCalls, toolCall]
        }
      })
    },

    updateAgentToolCall: (id: string, updates: Partial<ToolCall>) => {
      const agentState = get().agentState
      set({
        agentState: {
          ...agentState,
          toolCalls: agentState.toolCalls.map(call =>
            call.id === id ? { ...call, ...updates } : call
          )
        }
      })
    },

    agentAutoApproveConversationId: null,
    setAgentAutoApproveConversationId: (conversationId: number | null) => {
      set({ agentAutoApproveConversationId: conversationId })
    },
    agentAutoApproveRuntimeSkillId: null,
    setAgentAutoApproveRuntimeSkillId: (skillId: string | null) => {
      set({ agentAutoApproveRuntimeSkillId: skillId })
    },

    isPlaceholderEnabled: true,
    setPlaceholderEnabled: (enabled: boolean) => {
      set({ isPlaceholderEnabled: enabled })
    },

    linkedResource: null,
    setLinkedResource: (resource: LinkedResource | null) => {
      set({ linkedResource: resource })
    },

    linkedResourcePreview: null,
    setLinkedResourcePreview: (preview: string | null) => {
      set({ linkedResourcePreview: preview })
    },

    pendingQuote: null,
    setPendingQuote: (pendingQuote: PendingQuote | null) => {
      set({ pendingQuote })
    },
    clearPendingQuote: () => {
      set({ pendingQuote: null })
    },

    currentPageContext: null,
    setCurrentPageContext: (currentPageContext: CurrentPageContext | null) => {
      set({ currentPageContext })
    },

    onboardingPromptDraft: null,
    setOnboardingPromptDraft: (prompt: string | null) => {
      set({ onboardingPromptDraft: prompt })
    },

    chats: [],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    init: async (_tagId: number) => {
      await initChatsDb()
      // 防呆：確保 conversations 表存在再查。React effect 順序是 child→parent，
      // 所以 chat-content 的 useEffect 會早於 core/layout 的 initAllDatabases，
      // 若 DB 是首次建立會撞到 "no such table: conversations"。
      const { initConversationsDb } = await import('@/db/conversations')
      await initConversationsDb()
      await get().initConversations()

      const { currentConversationId, conversations, skipAutoRestore } = get()

      if (!currentConversationId) {
        if (skipAutoRestore) {
          set({ skipAutoRestore: false })
        } else if (conversations.length > 0) {
          await get().switchConversation(conversations[0].id)
        }
      } else {
        const data = await getChatsByConversation(currentConversationId)
        set({ chats: data })
      }
    },
    insert: async (chat) => {
      const { currentConversationId } = get()

      let conversationId = chat.conversationId || currentConversationId
      if (!conversationId) {
        const { createConversation } = await import('@/db/conversations')
        conversationId = await createConversation('新对话', source)
        set({ currentConversationId: conversationId })
        await get().initConversations()
      }

      const res = await insertChat({ ...chat, conversationId })
      let data: Chat
      if (res.lastInsertId) {
        data = {
          id: res.lastInsertId,
          createdAt: Date.now(),
          ...chat,
          conversationId
        }
        const chats = get().chats
        const newChats = [...chats, data]
        set({ chats: newChats })

        if (conversationId) {
          const { updateConversationMessageCount, updateConversationTime, updateConversationTitle, getConversation } = await import('@/db/conversations')
          await updateConversationMessageCount(conversationId, 1)
          await updateConversationTime(conversationId)

          const currentConv = await getConversation(conversationId)
          if (currentConv && currentConv.messageCount === 1 && chat.role === 'user' && chat.content) {
            const title = chat.content
              .replace(/\n/g, ' ')
              .trim()
              .slice(0, 30)

            if (title && title !== currentConv.title) {
              await updateConversationTitle(conversationId, title)
            }
          }

          await get().initConversations()
        }

        return data
      }
      return null
    },
    updateChat: (chat) => {
      const chats = get().chats
      const newChats = chats.map(item => {
        if (item.id === chat.id) {
          const result = { ...item }
          for (const key in chat) {
            if ((chat as any)[key] !== undefined) {
              (result as any)[key] = (chat as any)[key]
            }
          }
          return result
        }
        return item
      })
      set({ chats: newChats })
    },
    saveChat: async (chat, isSave = false) => {
      get().updateChat(chat)
      if (isSave) {
        await updateChat(chat)
      }
    },
    deleteChat: async (id) => {
      const chats = get().chats
      const newChats = chats.filter(item => item.id !== id)
      set({ chats: newChats })
      await deleteChat(id)

      const { currentConversationId } = get()
      if (currentConversationId) {
        const { updateConversationMessageCount } = await import('@/db/conversations')
        await updateConversationMessageCount(currentConversationId, -1)
        await get().initConversations()
      }
    },

    locale: locales[0],
    getLocale: async () => {
      const store = await Store.load('store.json');
      const res = (await store.get<string>('note_locale')) || locales[0]
      set({ locale: res })
    },
    setLocale: async (locale) => {
      set({ locale })
      const store = await Store.load('store.json');
      await store.set('note_locale', locale)
    },

    clearChats: async (tagId) => {
      set({ chats: [] })
      get().resetAgentState()
      get().clearMcpToolCalls()
      get().clearPendingQuote()

      const { currentConversationId } = get()
      if (currentConversationId) {
        const { chats } = get()
        const count = chats.length

        const db = await import('@/db').then(m => m.getDb())
        await db.execute("delete from chats where conversationId = $1", [currentConversationId])

        const { updateConversationMessageCount } = await import('@/db/conversations')
        await updateConversationMessageCount(currentConversationId, -count)
        await get().initConversations()
      } else {
        await clearChatsByTagId(tagId)
      }
    },

    updateInsert: async (id) => {
      await updateChatsInsertedById(id)
      const chats = get().chats
      const newChats = chats.map(item => {
        if (item.id === id) {
          item.inserted = true
        }
        return item
      })
      set({ chats: newChats })
    },

    syncState: false,
    setSyncState: (syncState) => set({ syncState }),
    lastSyncTime: '',
    setLastSyncTime: (lastSyncTime) => set({ lastSyncTime }),

    uploadChats: async () => {
      set({ syncState: true })
      try {
        const path = '.data'
        const filename = 'chats.json'
        const chats = await getAllChats()
        const store = await Store.load('store.json');
        const jsonToBase64 = (data: Chat[]) => {
          return Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        }
        const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
        let result = false
        let files: any;
        let res;
        const fullPath = `${path}/${filename}`;
        switch (primaryBackupMethod) {
          case 'github':
            const githubRepo = await getSyncRepoName('github')
            files = await githubGetFiles({ path: fullPath, repo: githubRepo })
            res = await uploadGithubFile({
              file: jsonToBase64(chats),
              repo: githubRepo,
              path: fullPath,
              sha: files?.sha,
            })
            break;
          case 'gitee':
            const giteeRepo = await getSyncRepoName('gitee')
            files = await giteeGetFiles({ path: fullPath, repo: giteeRepo })
            res = await uploadGiteeFile({
              file: jsonToBase64(chats),
              repo: giteeRepo,
              path: fullPath,
              sha: files?.sha,
            })
            break;
          case 'gitlab':
            const gitlabRepo = await getSyncRepoName('gitlab')
            files = await gitlabGetFiles({ path, repo: gitlabRepo })
            const chatFile = Array.isArray(files)
              ? files.find(file => file.name === filename)
              : (files?.name === filename ? files : undefined)
            res = await uploadGitlabFile({
              file: jsonToBase64(chats),
              repo: gitlabRepo,
              path,
              filename,
              sha: chatFile?.sha || '',
            })
            break;
          case 'gitea':
            const giteaRepo = await getSyncRepoName('gitea')
            files = await giteaGetFiles({ path, repo: giteaRepo })
            const giteaChatFile = Array.isArray(files)
              ? files.find(file => file.name === filename)
              : (files?.name === filename ? files : undefined)
            res = await uploadGiteaFile({
              file: jsonToBase64(chats),
              repo: giteaRepo,
              path,
              filename,
              sha: giteaChatFile?.sha || '',
            })
            break;
          case 's3': {
            const s3Config = await store.get<S3Config>('s3SyncConfig')
            if (s3Config) {
              const s3Key = `${path}/${filename}`
              const existingFile = await s3HeadObject(s3Config, s3Key)
              if (existingFile) {
                await s3Delete(s3Config, s3Key)
              }
              res = await s3Upload(s3Config, s3Key, JSON.stringify(chats, null, 2))
            }
            break;
          }
          case 'webdav': {
            const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
            if (webdavConfig) {
              const webdavKey = `${path}/${filename}`
              const existingFile = await webdavHeadObject(webdavConfig, webdavKey)
              if (existingFile) {
                await webdavDelete(webdavConfig, webdavKey)
              }
              res = await webdavUpload(webdavConfig, webdavKey, JSON.stringify(chats, null, 2))
            }
            break;
          }
        }
        if (res) {
          result = true
        }
        return result
      } catch (error) {
        console.error(`[ChatStore:${source}] uploadChats failed:`, error)
        return false
      } finally {
        set({ syncState: false })
      }
    },

    mcpToolCalls: [],

    addMcpToolCall: (toolCall: McpToolCall) => {
      const mcpToolCalls = get().mcpToolCalls
      set({ mcpToolCalls: [...mcpToolCalls, toolCall] })
    },

    updateMcpToolCall: (id: string, updates: Partial<McpToolCall>) => {
      const mcpToolCalls = get().mcpToolCalls.map(call =>
        call.id === id ? { ...call, ...updates } : call
      )
      set({ mcpToolCalls })
    },

    getMcpToolCallsByChatId: (chatId: number) => {
      return get().mcpToolCalls.filter(call => call.chatId === chatId)
    },

    clearMcpToolCalls: () => {
      set({ mcpToolCalls: [] })
    },

    downloadChats: async () => {
      const path = '.data'
      const filename = 'chats.json'
      const store = await Store.load('store.json');
      const primaryBackupMethod = await store.get<string>('primaryBackupMethod') || 'github';
      let result = []
      let files;
      switch (primaryBackupMethod) {
        case 'github':
          const githubRepo2 = await getSyncRepoName('github')
          files = await githubGetFiles({ path: `${path}/${filename}`, repo: githubRepo2 })
          break;
        case 'gitee':
          const giteeRepo2 = await getSyncRepoName('gitee')
          files = await giteeGetFiles({ path: `${path}/${filename}`, repo: giteeRepo2 })
          break;
        case 'gitlab':
          const gitlabRepo2 = await getSyncRepoName('gitlab')
          files = await gitlabGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: gitlabRepo2 })
          break;
        case 'gitea':
          const giteaRepo2 = await getSyncRepoName('gitea')
          files = await giteaGetFileContent({ path: `${path}/${filename}`, ref: 'main', repo: giteaRepo2 })
          break;
        case 's3': {
          const s3Config = await store.get<S3Config>('s3SyncConfig')
          if (s3Config) {
            const s3Key = `${path}/${filename}`
            const s3Result = await s3Download(s3Config, s3Key)
            if (s3Result) {
              result = JSON.parse(s3Result.content)
            }
          }
          break;
        }
        case 'webdav': {
          const webdavConfig = await store.get<WebDAVConfig>('webdavSyncConfig')
          if (webdavConfig) {
            const webdavKey = `${path}/${filename}`
            const webdavResult = await webdavDownload(webdavConfig, webdavKey)
            if (webdavResult) {
              result = JSON.parse(webdavResult.content)
            }
          }
          break;
        }
      }
      if (files) {
        const configJson = decodeBase64ToString(getRemoteFileContent(files, `${path}/${filename}`))
        result = JSON.parse(configJson)
      }
      if (result.length > 0) {
        await deleteAllChats()
        await insertChats(result)
      }
      set({ syncState: false })
      return result
    },

    // === 会话管理 ===
    currentConversationId: null,
    conversations: [],
    skipAutoRestore: false,

    initConversations: async () => {
      const { getAllConversations } = await import('@/db/conversations')
      const conversations = await getAllConversations(source)
      set({ conversations })
    },

    createConversation: async (title = '新对话') => {
      const { createConversation: createConv } = await import('@/db/conversations')
      const id = await createConv(title, source)
      set({ currentConversationId: id })
      await get().initConversations()
      return id
    },

    switchConversation: async (id: number) => {
      const { syncConversationMessageCount } = await import('@/db/conversations')
      await syncConversationMessageCount(id)
      const { getChatsByConversation } = await import('@/db/chats')
      const data = await getChatsByConversation(id)
      set({ currentConversationId: id, chats: data, pendingQuote: null })
      await get().initConversations()
    },

    updateConversationTitle: async (id: number, title: string) => {
      const { updateConversationTitle: updateTitle } = await import('@/db/conversations')
      await updateTitle(id, title)
      await get().initConversations()
    },

    deleteConversation: async (id: number) => {
      const { deleteConversation: deleteConv } = await import('@/db/conversations')
      await deleteConv(id)

      const { currentConversationId, conversations, switchConversation } = get()

      if (id === currentConversationId) {
        const remainingConversations = conversations.filter(c => c.id !== id)
        if (remainingConversations.length > 0) {
          await switchConversation(remainingConversations[0].id)
        } else {
          set({
            currentConversationId: null,
            chats: [],
            pendingQuote: null,
            agentAutoApproveConversationId: null,
            agentAutoApproveRuntimeSkillId: null
          })
          get().resetAgentState()
          get().clearMcpToolCalls()
        }
      }

      await get().initConversations()
    },

    toggleConversationPin: async (id: number) => {
      const { toggleConversationPin: togglePin } = await import('@/db/conversations')
      const isPinned = await togglePin(id)
      await get().initConversations()
      return isPinned
    },

    startNewConversation: async () => {
      const { currentConversationId } = get()

      // 先立即清空 UI 状态，确保画面干净（同步操作）。
      // skipAutoRestore: true 是关键 —— 万一接下来 Chat 元件被 unmount/remount
      // （workspace mode 切换会触发），mount 后 init() 不会把 currentConversationId
      // 又自动 restore 到最近的对话。一次性 flag，init() 跑完会清回 false。
      set({
        currentConversationId: null,
        chats: [],
        pendingQuote: null,
        agentAutoApproveConversationId: null,
        agentAutoApproveRuntimeSkillId: null,
        skipAutoRestore: true
      })
      get().resetAgentState()
      get().clearMcpToolCalls()

      if (currentConversationId) {
        const { getConversation } = await import('@/db/conversations')
        const currentConv = await getConversation(currentConversationId)
        if (currentConv && currentConv.messageCount === 0) {
          const { deleteConversation: deleteConv } = await import('@/db/conversations')
          await deleteConv(currentConversationId)
        }
        await get().initConversations()
      }
    },
  }))
}
