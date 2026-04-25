'use client'

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { LeftSidebar } from "./left-sidebar"
import { EditorLayout } from './editor/editor-layout'
import Chat from './chat'
import dynamic from 'next/dynamic'
import { useSidebarStore } from "@/stores/sidebar"
import useBrowserStore from "@/stores/browser"
import useChatStore from "@/stores/chat"
import { BrowserPanel } from "./browser"
import { useEffect, useState, useRef } from 'react'
import { Store } from '@tauri-apps/plugin-store'
import { ImperativePanelHandle } from 'react-resizable-panels'
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import emitter from '@/lib/emitter'
import { useRouter } from 'next/navigation'

// Bump this prefix whenever default layouts change so existing users pick
// up the new defaults instead of staying on their stale localStorage value.
const LAYOUT_STORAGE_PREFIX = 'react-resizable-panels:main-layout-v3'

function getDefaultLayout(layoutKey: string) {
  const storageKey = `${LAYOUT_STORAGE_PREFIX}:${layoutKey}`
  const layout = localStorage.getItem(storageKey);
  
  if (layout) {
    try {
      const parsed = JSON.parse(layout);
      // 验证总和是否为 100
      const sum = parsed.reduce((a: number, b: number) => a + b, 0);
      if (Math.abs(sum - 100) < 0.1) {
        return parsed;
      }
      // 如果总和不是 100，清除这个无效的值
      console.warn(`Invalid layout sum ${sum} for ${layoutKey}, using defaults`);
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error('Failed to parse layout:', e);
    }
  }
  
  // 左侧目标约 350px（常见视窗 ~1700px 下约 20%）
  switch (layoutKey) {
    case 'left-center-right':
      return [20, 50, 30]
    case 'left-center':
      return [20, 80, 0] // 右侧折叠
    case 'center-right':
      return [0, 60, 40] // 左侧折叠
    case 'left-right':
      return [20, 0, 80] // 中间折叠
    case 'left':
      return [100, 0, 0] // 只有左侧
    case 'center':
      return [0, 100, 0] // 只有中间
    case 'right':
      return [0, 0, 100] // 只有右侧
    default:
      return [20, 50, 30]
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

  // 切换模式时控制 WebView 显示/隐藏，并在进入浏览器模式时开启新对话
  useEffect(() => {
    if (workspaceMode === 'notes') {
      invoke('browser_hide').catch(() => {})
    } else {
      invoke('browser_show').catch(() => {})
      // 进入浏览器模式时，开启新对话以避免引用之前的笔记上下文
      useChatStore.getState().startNewConversation()
    }
  }, [workspaceMode])

  const leftPanelRef = useRef<ImperativePanelHandle>(null)
  const centerPanelRef = useRef<ImperativePanelHandle>(null)
  const rightPanelRef = useRef<ImperativePanelHandle>(null)
  
  const MIN_SIDEBAR_WIDTH_PX = 280
  const MIN_EDITOR_WIDTH_PX = 400
  const [minSidebarSize, setMinSidebarSize] = useState(20)
  const [minEditorSize, setMinEditorSize] = useState(30)
  
  // 使用稳定的 layoutKey 用于存储，但不作为 React key
  const visiblePanels = [
    leftSidebarVisible && 'left',
    centerPanelVisible && 'center',
    rightSidebarVisible && 'right'
  ].filter(Boolean)
  const layoutKey = visiblePanels.join('-')
  
  const calculateMinSizes = () => {
    const windowWidth = window.innerWidth
    const minSidebarPercent = Math.max(15, (MIN_SIDEBAR_WIDTH_PX / windowWidth) * 100)
    const minEditorPercent = Math.max(25, (MIN_EDITOR_WIDTH_PX / windowWidth) * 100)
    setMinSidebarSize(Math.min(minSidebarPercent, 40))
    setMinEditorSize(Math.min(minEditorPercent, 50))
  }

  // 初始化侧边栏状态
  useEffect(() => {
    initSidebarState()
    calculateMinSizes()
    
    window.addEventListener('resize', calculateMinSizes)
    return () => window.removeEventListener('resize', calculateMinSizes)
  }, [])

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
    return [20, 50, 30] // 左侧 ~350px（20%）、中间 50%、右侧 30%
  }
  
  const actualLayout = getActualLayout()
  
  const onLayout = (sizes: number[]) => {
    // 保存当前面板布局
    const storageKey = `${LAYOUT_STORAGE_PREFIX}:${layoutKey}`
    localStorage.setItem(storageKey, JSON.stringify(sizes));
  };

  // 根据可见面板数量动态构建布局
  const renderLayout = () => {
    const panels = []
    let index = 0

    // 左侧面板
    panels.push(
      <ResizablePanel
        key="left"
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
      />
    )

    // 中间面板
    panels.push(
      <ResizablePanel
        key="center"
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
      />
    )

    // 右侧面板
    panels.push(
      <ResizablePanel
        key="right"
        ref={rightPanelRef}
        defaultSize={actualLayout[index++]}
        minSize={minSidebarSize}
        collapsible={true}
        collapsedSize={0}
      >
        <Chat />
      </ResizablePanel>
    )

    return panels
  }

  // Browser mode: simpler 2-panel layout with BrowserPanel + Chat
  if (workspaceMode === 'browser') {
    return (
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={70} minSize={40} maxSize={80}>
          <BrowserPanel />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={30} minSize={20}>
          <Chat />
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  // Notes mode: existing 3-panel layout
  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={onLayout}
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
