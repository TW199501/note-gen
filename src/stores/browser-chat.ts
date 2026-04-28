import { createChatStore } from './chat-factory'

// Browser 模式的 chat store。
// linkedResource / onboardingPromptDraft 在 interface 上有但 browser 不會用 — setter 還是 functional，
// 但 browser 模式下沒 UI 觸發；如果 M1 後真的要塞 browser-only 概念（CurrentPageContext），
// 應該開新 slot 而非 reuse linkedResource。
const useBrowserChatStore = createChatStore({ source: 'browser' })

export default useBrowserChatStore
