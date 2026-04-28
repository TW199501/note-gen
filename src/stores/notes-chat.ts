import { createChatStore } from './chat-factory'

// Notes 模式的 chat store。
// 持有 linkedResource (file/folder linkage)、onboardingPromptDraft 等 notes-only 概念。
// uploadChats / downloadChats 在這裡實作（factory 共用，但 sync 語義屬於 notes 對話）。
const useNotesChatStore = createChatStore({ source: 'notes' })

export default useNotesChatStore
