'use client'

import { useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import useBrowserStore from '@/stores/browser'
import useSettingStore from '@/stores/setting'
import useBrowserChatStore from '@/stores/browser-chat'
import emitter from '@/lib/emitter'

export function BrowserWebView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { browserReady, setBrowserReady, setBrowserUrl, setBrowserTitle, setBrowserLoading, setBrowserFavicon, workspaceMode, overlayCount, browserAutoOpen, applyNavEvent } = useBrowserStore()
  const { browserHomepage } = useSettingStore()
  const t = useTranslations('browser.contextMenu')
  // M1: 區分 auto-extract（page load 觸發，寫進 currentPageContext）和 manual extract
  // （user 按按鈕，當 quote 進 chat-input）。設為 true 時，下次 browser-content-extracted
  // event 走 auto path 並 reset；false 時走原本的 quote emitter。
  const pendingAutoExtractRef = useRef(false)
  // M1: debounce 用，避免頁面 loading=false 後 SPA 再渲染又重抓
  const autoExtractTimerRef = useRef<NodeJS.Timeout | null>(null)

  const injectContextMenu = useCallback(async () => {
    try {
      await invoke('browser_inject_context_menu', {
        labels: {
          back: t('back'),
          forward: t('forward'),
          reload: t('reload'),
          copy: t('copy'),
          paste: t('paste'),
          selectAll: t('selectAll'),
          quote: t('quoteToChat'),
          translate: t('translate'),
          screenshot: t('screenshotToAI'),
          bookmark: t('addBookmark'),
          print: t('print'),
          devTools: t('devTools'),
        }
      })
    } catch {
      // WebView may not be ready yet
    }
  }, [t])

  const syncSize = useCallback(async () => {
    if (!containerRef.current || !browserReady) return
    const rect = containerRef.current.getBoundingClientRect()
    await invoke('browser_resize', {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    })
  }, [browserReady])

  useEffect(() => {
    async function init() {
      if (!containerRef.current) return
      // Lazy-mount gate：browserAutoOpen=false 時不自動 spawn 子 WebView，
      // 避免啟動就出現 about:blank#blocked 的空白視窗（v1.0.7 行為）。
      // 使用者可呼叫 useBrowserStore.getState().setBrowserAutoOpen(true) 啟用。
      if (!browserAutoOpen) return
      const rect = containerRef.current.getBoundingClientRect()

      try {
        await invoke('browser_create', {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          url: browserHomepage,
        })
        setBrowserReady(true)
        // Inject context menu after WebView is created
        await injectContextMenu()
      } catch (error) {
        console.error('[Browser] Failed to create WebView:', error)
      }
    }

    init()

    // Listen for browser events
    const window = getCurrentWindow()
    const listeners = [
      window.listen<{ url: string }>('browser-url-changed', (event) => {
        setBrowserUrl(event.payload.url)
        // M1: URL 變了，舊頁的 extracted context 不再 valid — 立刻清，等 loading=false 後重新 extract
        useBrowserChatStore.getState().setCurrentPageContext(null)
      }),
      window.listen<{ title: string }>('browser-title-changed', (event) => {
        setBrowserTitle(event.payload.title)
      }),
      window.listen<{ loading: boolean }>('browser-loading', (event) => {
        console.debug('[Browser] browser-loading event', event.payload)
        setBrowserLoading(event.payload.loading)
        // M1: 頁面載入完成後 1.5s（讓 SPA 後續渲染穩定）→ 自動抽 text 寫進 currentPageContext
        if (!event.payload.loading) {
          if (autoExtractTimerRef.current) clearTimeout(autoExtractTimerRef.current)
          autoExtractTimerRef.current = setTimeout(() => {
            console.debug('[Browser] auto-extract: invoking browser_extract_text')
            pendingAutoExtractRef.current = true
            invoke('browser_extract_text').catch((err) => {
              console.warn('[Browser] auto-extract failed:', err)
              pendingAutoExtractRef.current = false
            })
          }, 1500)
        }
      }),
      window.listen<{ favicon: string }>('browser-favicon-changed', (event) => {
        setBrowserFavicon(event.payload.favicon)
      }),
      // R5: 上下頁狀態。每個 page-load Finished Rust 端會 emit 此 event。
      window.listen<{ kind: 'navigate' | 'back' | 'forward' | 'reload' }>('browser-nav-event', (event) => {
        applyNavEvent(event.payload.kind)
      }),
      // Handle extracted text from browser_extract_text command
      window.listen<{ text: string; title: string; url: string }>('browser-content-extracted', (event) => {
        const { text, title, url } = event.payload
        console.debug('[Browser] browser-content-extracted event', {
          textLen: text?.length ?? 0, title, url,
          autoMode: pendingAutoExtractRef.current,
        })
        if (!text) return
        // M1: auto-extract 走 currentPageContext (寫進 BrowserChatStore，不污染 chat-input)；
        // manual extract（user 按按鈕）走原本的 quote 流程 (text 進 chat-input pendingQuote)
        if (pendingAutoExtractRef.current) {
          pendingAutoExtractRef.current = false
          // 從 store 讀 url/title（avoid stale closure value）
          const browserState = useBrowserStore.getState()
          useBrowserChatStore.getState().setCurrentPageContext({
            url: url || browserState.browserUrl,
            title: title || browserState.browserTitle || url || browserState.browserUrl,
            content: text,
          })
        } else {
          emitter.emit('browser-quote-text' as any, { text, url, title })
        }
      }),
      // Handle context menu actions from the WebView
      window.listen<{ action: string; text: string; url: string; title: string }>('browser-context-action', (event) => {
        const { action, text, url, title } = event.payload
        switch (action) {
          case 'quote':
            emitter.emit('browser-quote-text' as any, { text, url, title })
            break
          case 'screenshot':
            invoke<string>('browser_capture').then((path) => {
              emitter.emit('browser-screenshot' as any, { path })
            }).catch((err) => console.error('[Browser] Screenshot failed:', err))
            break
          case 'bookmark':
            emitter.emit('browser-add-bookmark' as any, { url, title })
            break
          case 'translate':
            emitter.emit('browser-translate-text' as any, { text })
            break
          case 'devtools':
            invoke('browser_open_devtools').catch((err: unknown) => console.error('[Browser] DevTools failed:', err))
            break
        }
      }),
    ]

    return () => {
      listeners.forEach(async (listener) => {
        const unlisten = await listener
        unlisten()
      })
    }
  }, [browserAutoOpen])

  // Sync size on resize — observe both container and parent to catch sibling changes (e.g. BookmarkBar appearing)
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      syncSize()
    })
    if (containerRef.current) {
      observer.observe(containerRef.current)
      // Also observe parent so BookmarkBar show/hide triggers resync
      if (containerRef.current.parentElement) {
        observer.observe(containerRef.current.parentElement)
      }
    }
    return () => observer.disconnect()
  }, [syncSize])

  // Show/hide WebView based on workspace mode and overlay state
  useEffect(() => {
    if (!browserReady) return
    if (workspaceMode === 'browser' && overlayCount === 0) {
      invoke('browser_show')
      syncSize()
    } else {
      invoke('browser_hide')
    }
  }, [workspaceMode, browserReady, syncSize, overlayCount])

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full"
    />
  )
}
