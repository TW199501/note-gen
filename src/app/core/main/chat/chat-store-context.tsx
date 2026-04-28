'use client'

import { createContext, useContext, ReactNode } from 'react'
import { useStore } from 'zustand'
import type { ChatState, ChatStore } from '@/stores/chat-factory'

// 把目前 Chat 子樹要用的 store handle 透過 React Context 傳下去。
// 兩種 layout (notes 3-panel / browser 2-panel) 各自包一層 Provider，
// 同一個 <Chat /> 元件被兩個不同 Provider 包出來就是兩個獨立的 store 實例。
const ChatStoreContext = createContext<ChatStore | null>(null)

export function ChatStoreProvider({
  store,
  children,
}: {
  store: ChatStore
  children: ReactNode
}) {
  return (
    <ChatStoreContext.Provider value={store}>
      {children}
    </ChatStoreContext.Provider>
  )
}

// 取整個 ChatState（等同舊代碼的 `const store = useChatStore()`）
export function useChatStoreFromContext(): ChatState
// 帶 selector 取一部分（推薦，避免不必要的 re-render）
export function useChatStoreFromContext<T>(selector: (state: ChatState) => T): T
export function useChatStoreFromContext<T>(selector?: (state: ChatState) => T): T | ChatState {
  const store = useContext(ChatStoreContext)
  if (!store) {
    throw new Error('useChatStoreFromContext must be used inside <ChatStoreProvider>')
  }
  // selector 沒帶就回整個 state（zustand useStore 在沒 selector 時行為不一致，
  // 用 identity selector 強制 return full state）
  return useStore(store, selector ?? ((s) => s as unknown as T))
}

// 取 store handle 本身（不訂閱，給 .getState() / 傳給 AI runtime / AgentHandler 用）
export function useChatStoreApiFromContext(): ChatStore {
  const store = useContext(ChatStoreContext)
  if (!store) {
    throw new Error('useChatStoreApiFromContext must be used inside <ChatStoreProvider>')
  }
  return store
}
