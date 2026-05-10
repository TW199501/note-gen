import { create } from 'zustand'
import { initialNavState, reduceNavState, canGoBack, canGoForward, type NavEventKind, type NavState } from '@/lib/browser/nav-state'

export type WorkspaceMode = 'notes' | 'browser'

interface BrowserStore {
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void

  browserUrl: string
  setBrowserUrl: (url: string) => void

  browserTitle: string
  setBrowserTitle: (title: string) => void

  browserLoading: boolean
  setBrowserLoading: (loading: boolean) => void

  browserFavicon: string
  setBrowserFavicon: (favicon: string) => void

  browserReady: boolean
  setBrowserReady: (ready: boolean) => void

  // 開關：是否在 BrowserPanel 掛載時自動 spawn child WebView。
  // 預設 false，避免啟動就出現 about:blank 子視窗（v1.0.7 行為）。
  browserAutoOpen: boolean
  setBrowserAutoOpen: (open: boolean) => void

  // Track overlay count to hide WebView when popups/dialogs are open
  // Native child WebView always renders above HTML elements
  overlayCount: number
  pushOverlay: () => void
  popOverlay: () => void

  // R5: 上下頁狀態。Rust 端每次 page-load Finished 會 emit `browser-nav-event`
  // 帶 kind，前端透過 reducer 推進 navState，UI 用 canGoBack/canGoForward 控制按鈕。
  navState: NavState
  canGoBack: boolean
  canGoForward: boolean
  applyNavEvent: (kind: NavEventKind) => void
  resetNavState: () => void
}

const useBrowserStore = create<BrowserStore>((set) => ({
  workspaceMode: 'notes',
  setWorkspaceMode: (mode) => set({ workspaceMode: mode }),

  browserUrl: 'https://www.google.com',
  setBrowserUrl: (browserUrl) => set({ browserUrl }),

  browserTitle: '',
  setBrowserTitle: (browserTitle) => set({ browserTitle }),

  browserLoading: false,
  setBrowserLoading: (browserLoading) => set({ browserLoading }),

  browserFavicon: '',
  setBrowserFavicon: (browserFavicon) => set({ browserFavicon }),

  browserReady: false,
  setBrowserReady: (browserReady) => set({ browserReady }),

  browserAutoOpen: false,
  setBrowserAutoOpen: (browserAutoOpen) => set({ browserAutoOpen }),

  overlayCount: 0,
  pushOverlay: () => set((state) => ({ overlayCount: state.overlayCount + 1 })),
  popOverlay: () => set((state) => ({ overlayCount: Math.max(0, state.overlayCount - 1) })),

  navState: initialNavState,
  canGoBack: false,
  canGoForward: false,
  applyNavEvent: (kind) =>
    set((state) => {
      const next = reduceNavState(state.navState, kind)
      return {
        navState: next,
        canGoBack: canGoBack(next),
        canGoForward: canGoForward(next),
      }
    }),
  resetNavState: () =>
    set({ navState: initialNavState, canGoBack: false, canGoForward: false }),
}))

export default useBrowserStore
