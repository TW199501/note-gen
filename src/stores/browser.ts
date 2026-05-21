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

  // R8: DevTools 開關狀態。Rust 端 toggle 後 emit `browser-devtools-state`；
  // 注意若使用者透過 DevTools 視窗本身關閉，本旗標會 drift。
  devtoolsOpen: boolean
  setDevtoolsOpen: (open: boolean) => void

  // R6: zoom 層級（1.0 = 100%）。WebView 內部 keyboard handler 直接改 DOM 並回報，
  // host 也可主動呼叫 browser_set_zoom 同步。Phase 1 為單分頁，存記憶體即可。
  zoomLevel: number
  setZoomLevel: (level: number) => void

  // R4: find-in-page。Ctrl/Cmd+F 在 WebView 內被攔截後 emit browser-find-requested，
  // host 顯示 FindBar 並 focus input；輸入查詢 → debounce → invoke browser_find_start。
  findOpen: boolean
  setFindOpen: (open: boolean) => void
  findQuery: string
  setFindQuery: (q: string) => void
  findCount: number
  findIndex: number  // -1 when no match
  setFindState: (count: number, index: number) => void

  // R2: 進行中下載計數，用於 status bar 徽章 / chat 提示。
  // 由 browser-download-started/finished 事件 listener 自增/自減。
  downloadInProgressCount: number
  incrementDownloadCount: () => void
  decrementDownloadCount: () => void
  resetDownloadCount: () => void

  // R1: 多分頁。tabs 是 ordered（左→右），activeTabId 指向目前 focused tab。
  // Rust 端是 source of truth，前端透過 browser-tabs-changed event 同步。
  // MVP：共用同一個 WebView，切換 tab 觸發 browser_navigate；後續會升級到 per-tab webview。
  tabs: BrowserTab[]
  activeTabId: string | null
  applyTabsChanged: (tabs: BrowserTab[], activeTabId: string | null) => void
}

export interface BrowserTab {
  id: string
  url: string
  title: string
  favicon: string
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

  devtoolsOpen: false,
  setDevtoolsOpen: (devtoolsOpen) => set({ devtoolsOpen }),

  zoomLevel: 1.0,
  setZoomLevel: (zoomLevel) => set({ zoomLevel }),

  findOpen: false,
  setFindOpen: (findOpen) => set({ findOpen }),
  findQuery: '',
  setFindQuery: (findQuery) => set({ findQuery }),
  findCount: 0,
  findIndex: -1,
  setFindState: (findCount, findIndex) => set({ findCount, findIndex }),

  downloadInProgressCount: 0,
  incrementDownloadCount: () =>
    set((state) => ({ downloadInProgressCount: state.downloadInProgressCount + 1 })),
  decrementDownloadCount: () =>
    set((state) => ({ downloadInProgressCount: Math.max(0, state.downloadInProgressCount - 1) })),
  resetDownloadCount: () => set({ downloadInProgressCount: 0 }),

  tabs: [],
  activeTabId: null,
  applyTabsChanged: (tabs, activeTabId) => set(() => {
    // Mirror the active tab's metadata into the shared browserUrl / browserTitle /
    // browserFavicon so the URL bar, bookmark-star, history entries, and any
    // other surface that reads those three fields stay in sync with whichever
    // tab is currently visible. Without this, switching tabs (or having Rust
    // change the active tab via browser_tabs_switch / browser_tabs_close /
    // target=_blank → new tab) leaves the nav bar stuck on the previously-
    // active tab's URL until the next browser-url-changed event fires.
    const active = activeTabId ? tabs.find((t) => t.id === activeTabId) : null
    if (active) {
      return {
        tabs,
        activeTabId,
        browserUrl: active.url,
        browserTitle: active.title,
        browserFavicon: active.favicon,
      }
    }
    // No active tab (e.g. user closed the last tab). Clear shared metadata
    // so the URL bar, page title, favicon, and any consumer of these fields
    // reflect the empty state instead of the previously-active tab.
    return {
      tabs,
      activeTabId,
      browserUrl: '',
      browserTitle: '',
      browserFavicon: '',
    }
  }),
}))

export default useBrowserStore
