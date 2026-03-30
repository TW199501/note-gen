'use client'

import { useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import useBrowserStore from '@/stores/browser'
import useSettingStore from '@/stores/setting'
import emitter from '@/lib/emitter'

export function BrowserWebView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const { browserReady, setBrowserReady, setBrowserUrl, setBrowserTitle, setBrowserLoading, setBrowserFavicon, workspaceMode, overlayCount } = useBrowserStore()
  const { browserHomepage } = useSettingStore()
  const t = useTranslations('browser.contextMenu')

  const injectContextMenu = useCallback(async () => {
    try {
      await invoke('browser_inject_context_menu', {
        labels: {
          quote: t('quoteToChat'),
          translate: t('translate'),
          screenshot: t('screenshotToAI'),
          bookmark: t('addBookmark'),
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
      }),
      window.listen<{ title: string }>('browser-title-changed', (event) => {
        setBrowserTitle(event.payload.title)
      }),
      window.listen<{ loading: boolean }>('browser-loading', (event) => {
        setBrowserLoading(event.payload.loading)
      }),
      window.listen<{ favicon: string }>('browser-favicon-changed', (event) => {
        setBrowserFavicon(event.payload.favicon)
      }),
      // Handle extracted text from browser_extract_text command
      window.listen<{ text: string; title: string; url: string }>('browser-content-extracted', (event) => {
        const { text, title, url } = event.payload
        if (text) {
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
        }
      }),
    ]

    return () => {
      listeners.forEach(async (listener) => {
        const unlisten = await listener
        unlisten()
      })
    }
  }, [])

  // Sync size on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      syncSize()
    })
    if (containerRef.current) {
      observer.observe(containerRef.current)
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
