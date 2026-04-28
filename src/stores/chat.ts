// Compatibility re-export. M0 拆分後此檔變成 useNotesChatStore 的 alias。
//
// 為什麼還保留：
// - mobile chat (`src/app/mobile/chat/**`) 是 notes-only，繼續用 default import
// - editor (`tiptap-editor.tsx`) 寫 pendingQuote 一直走 notes store
// - sync-toggle UI 仍 import default
// - lib/ai/*、lib/agent/* 沒傳 chatStore 參數時 default 到 notes store
//
// 任何 **明確要區分 notes / browser 模式的程式碼**，都要直接 import
// `useNotesChatStore` / `useBrowserChatStore` 而不是這個檔。
//
// Type re-exports 讓 import { ChatState, PendingQuote } from '@/stores/chat' 仍然成立。
import useNotesChatStore from './notes-chat'

export type { ChatState, ChatStore, PendingQuote, McpToolCall, ChatStoreOptions } from './chat-factory'
export { createChatStore } from './chat-factory'

export default useNotesChatStore
