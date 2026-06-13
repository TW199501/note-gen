'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import Chat from './chat'
import { ChatStoreProvider } from './chat/chat-store-context'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import useBrowserStore from "@/stores/browser"
import useNotesChatStore from "@/stores/notes-chat"
import useBrowserChatStore from "@/stores/browser-chat"
import { BrowserPanel } from "./browser"
import { useEffect, useRef } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelGroupHandle, ImperativePanelHandle } from 'react-resizable-panels'
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { platform } from '@tauri-apps/plugin-os'
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'

// Bump this prefix whenever default layouts change so existing users pick
// up the new defaults instead of staying on their stale localStorage value.
// v7: v6 accumulated stale values from past sessions where the old
// onLayout-saves-on-every-reflow pattern was active (e.g. clamped
// [23, 47, 30] from viewport-resize re-clamps). With v7 + Defense 1
// (drag-end-only persist) + Defense 4 (constraint scaling), v6 victims
// get fresh defaults and no new poisoning is possible going forward.
const LAYOUT_STORAGE_PREFIX = 'react-resizable-panels:main-layout-v7'
// One-time marker — when bumping LAYOUT_STORAGE_PREFIX, also bump this so we
// re-force panel visibility (left/center/right) to all-visible. Panel sizes
// and visibility are persisted separately, so a layout bump alone won't
// surface hidden panels from a prior session.
const LAYOUT_MIGRATION_MARKER = 'note-gen-layout-migration:v6'

async function runLayoutMigrationOnce(): Promise<boolean> {
  if (localStorage.getItem(LAYOUT_MIGRATION_MARKER) === 'done') return false

  // Reset visibility flags in both persistence layers so all three panels
  // come back even if the user previously toggled one off.
  localStorage.setItem('leftSidebarVisible', 'true')
  localStorage.setItem('centerPanelVisible', 'true')
  localStorage.setItem('rightSidebarVisible', 'true')
  try {
    const store = await Store.load('store.json')
    await store.set('leftSidebarVisible', true)
    await store.set('centerPanelVisible', true)
    await store.set('rightSidebarVisible', true)
    await store.save()
  } catch {
    /* Tauri store unavailable in pure web preview — localStorage is enough */
  }

  localStorage.setItem(LAYOUT_MIGRATION_MARKER, 'done')
  return true
}

// Reject layouts where any *visible* panel has near-zero size. Such values
// come from the library collapsing a collapsible panel to satisfy minSize
// during a viewport-resize reflow — they shouldn't have been persisted, but
// if they were, we drop them here so the user recovers on next reload
// without manual storage cleanup. Invisible panels are expected to be 0.
function isLayoutSane(layout: number[], layoutKey: string): boolean {
  if (!Array.isArray(layout) || layout.length !== 3) return false
  const sum = layout.reduce((a, b) => a + b, 0)
  if (Math.abs(sum - 100) >= 0.1) return false
  if (layoutKey.includes('left') && layout[0] < 5) return false
  if (layoutKey.includes('center') && layout[1] < 5) return false
  if (layoutKey.includes('right') && layout[2] < 5) return false
  return true
}

function getDefaultLayout(layoutKey: string) {
  const storageKey = `${LAYOUT_STORAGE_PREFIX}:${layoutKey}`
  const layout = localStorage.getItem(storageKey);

  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      if (isLayoutSane(parsed, layoutKey)) {
        return parsed;
      }
      console.warn(`Invalid layout ${JSON.stringify(parsed)} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }
  
  // 比例來自 user 在 1707×979 viewport 手動拖到順手的位置(SpecSnap
  // 2026-04-26 capture s-4nmv91): 笔记 318.9px / 編輯器 905.53px / 對話 480.91px
  // 換算成扣掉 divider 後的百分比 = [18.70, 53.10, 28.20] → 取整 [19, 53, 28]。
  switch (layoutKey) {
    case 'left-center-right':
      return [19, 53, 28]
    case 'left-center':
      return [20, 80, 0] // 右侧折叠
    case 'center-right':
      return [0, 70, 30] // 左侧折叠
    case 'left-right':
      return [20, 0, 80] // 中间折叠
    case 'left':
      return [100, 0, 0] // 只有左侧
    case 'center':
      return [0, 100, 0] // 只有中间
    case 'right':
      return [0, 0, 100] // 只有右侧
    default:
      return [19, 53, 28]
  }
}

function ResizableWrapper() {
  const {
    leftSidebarVisible,
    centerPanelVisible,
    rightSidebarVisible,
    initSidebarState
  } = useSidebarStore()
  const { workspaceMode } = useBrowserStore()

  // 進入瀏覽器模式時開啟新對話 + 把 Chromium overlay 從畫面外搬回 panel 區。
  // Chromium 是原生 top-level 視窗(不在 React 樹內),所以切回 notes mode 必須明確
  // 呼叫 chromium_hide 把它搬到 -32000,-32000;否則 Chromium 視窗會殘留蓋住
  // notes 工作區。show 不在這裡呼叫——BrowserPanel mount 時自己上報 rect + show,
  // 避免 page.tsx effect 先跑而 panel rect 還沒量到的競態。
  // ResizableWrapper 不會隨 mode 切換 unmount,所以這個 useEffect 真的會在 mode
  // 改變時觸發(不像 Chat 元件本身——它在 mode 切換時整個 unmount/remount,元件內
  // 的 ref-based transition 檢測會失效)。startNewConversation 內會設
  // skipAutoRestore=true,避免 Chat remount 後的 init() 又把 currentConversationId
  // restore 回最近的對話。
  useEffect(() => {
    if (workspaceMode === 'browser') {
      useBrowserChatStore.getState().startNewConversation()
      emitter.emit('chat-input-reset', undefined)
    } else if (platform() === 'windows') {
      invoke('chromium_hide').catch(() => { /* chromium not launched yet / non-windows */ })
    }
  }, [workspaceMode])

  const panelGroupRef = useRef<ImperativePanelGroupHandle>(null)
  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const centerPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)

  // Use a constant low minSize (5%). Any value lower than the design defaults
  // ([19, 53, 28]) is fine — what we need to GUARANTEE is `defaultSize ≥ minSize`
  // at all viewport widths, otherwise react-resizable-panels emits an "invalid
  // configuration" warning AND clamps the panel up to minSize, leaving the
  // panels stuck at clamped sizes even after the viewport enlarges.
  //
  // Previous attempts used a viewport-derived minSize (e.g. 280px / w * 100)
  // capped at 40-50%. At small viewports that produced minSize > defaultSize
  // → exactly the bug we're now fixing. The "minimum 280px sidebar" UX intent
  // isn't actually achievable below ~1500px viewport anyway, so dropping the
  // responsive minSize doesn't lose much in practice.
  const minSidebarSize = 5
  const minEditorSize = 5

  // 使用稳定的 layoutKey 用于存储，但不作为 React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')

  // 初始化侧边栏状态
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Apply the v4 migration BEFORE initSidebarState so when initSidebarState
      // reads the Tauri store it picks up the just-reset all-visible values.
      const migrated = await runLayoutMigrationOnce()
      if (cancelled) return
      if (migrated) {
        // Push the freshly reset values into the live zustand store so the
        // current render reflects them without needing a page reload.
        useSidebarStore.setState({
          leftSidebarVisible: true,
          centerPanelVisible: true,
          rightSidebarVisible: true,
        })
      }
      await initSidebarState()
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Defense 5: when layoutKey changes (visibility toggle), force-restore the
  // saved/default layout for the new key. setLayout is imperative (not a
  // drag), so it bypasses Defense 1's persist path. Skip on first render —
  // defaultSize props handle initial mount.
  const initialRenderRef = useRef(true)
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false
      return
    }
    if (panelGroupRef.current) {
      const target = getDefaultLayout(layoutKey)
      if (target.length === 3) {
        panelGroupRef.current.setLayout(target)
      }
    }
  }, [layoutKey])

  // 当面板可见性变化时，控制面板的折叠和展开
  useEffect(() => {
    const timer = setTimeout(() => {
      // 左侧面板
      if (leftPanelRef.current) {
        if (leftSidebarVisible) {
          leftPanelRef.current.expand()
        } else {
          leftPanelRef.current.collapse()
        }
      }
      
      // 中间面板
      if (centerPanelRef.current) {
        if (centerPanelVisible) {
          centerPanelRef.current.expand()
        } else {
          centerPanelRef.current.collapse()
        }
      }
      
      // 右侧面板
      if (rightPanelRef.current) {
        if (rightSidebarVisible) {
          rightPanelRef.current.expand()
        } else {
          rightPanelRef.current.collapse()
        }
      }
    }, 100)
    return () => clearTimeout(timer)
  }, [leftSidebarVisible, centerPanelVisible, rightSidebarVisible])

  // 根据面板可见性渲染布局
  // 注意：左侧面板始终渲染，所以 layoutKey 用于存储，但实际布局计算需要考虑左侧始终存在
  
  // 计算实际需要的默认尺寸（所有面板始终存在）
  const getActualLayout = () => {
    const savedLayout = getDefaultLayout(layoutKey)
    
    // 所有面板都始终渲染，直接返回保存的布局或默认布局
    if (savedLayout.length === 3) {
      return savedLayout
    }
    
    // 如果保存的布局不是3个值，使用默认布局
    return [19, 53, 28] // 笔记 19% / 编辑器 53% / 右侧聊天 28%
  }
  
  const actualLayout = getActualLayout()

  // Persist only on real drag-end transitions. onLayout was previously used
  // here, but it fires on every reflow (viewport resize, minSize recompute,
  // HMR transient render, programmatic collapse) — not just user drags — and
  // any of those can write a clamped/collapsed layout into localStorage,
  // permanently corrupting the saved value.
  const isDraggingRef = useRef(false)
  const handleDragging = (isDragging: boolean) => {
    if (!isDragging && isDraggingRef.current) {
      const sizes = panelGroupRef.current?.getLayout()
      if (sizes && isLayoutSane(sizes, layoutKey)) {
        const storageKey = `${LAYOUT_STORAGE_PREFIX}:${layoutKey}`
        localStorage.setItem(storageKey, JSON.stringify(sizes))
      }
    }
    isDraggingRef.current = isDragging
  }

  // 根据可见面板数量动态构建布局
  const renderLayout = () => {
    const panels = []
    let index = 0

    // 左侧面板
    panels.push(
      <ResizablePanel
        key="left"
        id="left"
        order={1}
        ref={leftPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minSidebarSize}
        maxSize={40}
        collapsible={true}
        collapsedSize={0}
      >
        <LeftSidebar />
      </ResizablePanel>
    )

    // 左侧和中间之间的分隔条
    // 当中间面板可见时显示；当中间面板不可见但左右都可见时也显示（作为左右分隔条）
    const shouldShowLeftHandle = leftSidebarVisible && (centerPanelVisible || rightSidebarVisible)
    panels.push(
      <ResizableHandle
        key="handle-left-center"
        className={`${!shouldShowLeftHandle ? 'hidden' : ''}`}
        onDragging={handleDragging}
      />
    )

    // 中间面板
    panels.push(
      <ResizablePanel
        key="center"
        id="center"
        order={2}
        ref={centerPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minEditorSize}
        collapsible={true}
        collapsedSize={0}
      >
        <EditorLayout />
      </ResizablePanel>
    )

    // 中间和右侧之间的分隔条
    // 只有当中间面板可见时才显示此分隔条
    panels.push(
      <ResizableHandle
        key="handle-center-right"
        className={`${!centerPanelVisible || !rightSidebarVisible ? 'hidden' : ''}`}
        onDragging={handleDragging}
      />
    )

    // 右侧面板
    panels.push(
      <ResizablePanel
        key="right"
        id="right"
        order={3}
        ref={rightPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minSidebarSize}
        collapsible={true}
        collapsedSize={0}
      >
        <ChatStoreProvider store={useNotesChatStore}>
          <Chat />
        </ChatStoreProvider>
      </ResizablePanel>
    )

    return panels
  }

  // Browser mode: simpler 2-panel layout with BrowserPanel + Chat
  if (workspaceMode === 'browser') {
    return (
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel id="browser-main" order={1} defaultSize={70} minSize={40} maxSize={80}>
          <BrowserPanel />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel id="browser-chat" order={2} defaultSize={30} minSize={20}>
          {/* pt-9: clear the title-bar control island that floats top-right over
              this panel (the browser panel on the left reaches the top instead). */}
          <div className="h-full pt-9">
            <ChatStoreProvider store={useBrowserChatStore}>
              <Chat />
            </ChatStoreProvider>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  // Notes mode: existing 3-panel layout
  return (
    <ResizablePanelGroup
      ref={panelGroupRef}
      direction="horizontal"
      className="h-full"
    >
      {renderLayout()}
    </ResizablePanelGroup>
  )
}

function Page() {
  const router = useRouter()

  useEffect(() => {
    // 保存当前页面路径
    async function saveCurrentPage() {
      const store = await Store.load('store.json')
      await store.set('currentPage', '/core/main')
      await store.save()
    }
    saveCurrentPage()

    // 监听托盘事件
    const window = getCurrentWindow()
    const unlistenTrayAction = window.listen<string>('tray-action', async (event) => {
      const action = event.payload
      switch (action) {
        case 'screenshot':
          await invoke('screenshot')
          emitter.emit('screenshot-shortcut-register', undefined)
          break
        case 'text':
          emitter.emit('text-shortcut-register', undefined)
          break
        case 'pin':
          emitter.emit('window-pin-register', undefined)
          break
        case 'link':
          emitter.emit('link-shortcut-register', undefined)
          break
      }
    })

    // 监听打开设置事件
    const unlistenOpenSettings = window.listen<void>('open-settings', () => {
      // 导航到设置页面
      router.push('/core/setting')
    })

    return () => {
      unlistenTrayAction.then(fn => fn())
      unlistenOpenSettings.then(fn => fn())
    }
  }, [router])

  return <ResizableWrapper />
}

export default dynamic(() => Promise.resolve(Page), { ssr: false })
