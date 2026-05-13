'use client'

import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import { Plus, X, Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useBrowserStore, { type BrowserTab } from '@/stores/browser'
import useSettingStore from '@/stores/setting'

/** R1 (multi-tab) MVP tab strip — Rust BrowserState owns tab list, frontend
 *  mirrors via browser-tabs-changed event. Click tab → switch via
 *  browser_tabs_switch; "+" → browser_tabs_new with the configured homepage;
 *  hover-X → browser_tabs_close. Underlying WebView is shared in this MVP. */
export function TabStrip() {
  const t = useTranslations('browser')
  const { tabs, activeTabId, applyTabsChanged, setBrowserAutoOpen } = useBrowserStore()
  const { browserHomepage } = useSettingStore()

  useEffect(() => {
    let cancelled = false
    const window = getCurrentWindow()

    // Hydrate from Rust on mount.
    invoke<{ tabs: BrowserTab[]; active_tab_id: string | null }>('browser_tabs_list')
      .then((payload) => {
        if (!cancelled) applyTabsChanged(payload.tabs, payload.active_tab_id)
      })
      .catch((e) => console.error('[Tabs] list failed:', e))

    // Subscribe to mutations.
    const off = window.listen<{ tabs: BrowserTab[]; active_tab_id: string | null }>(
      'browser-tabs-changed',
      (event) => {
        applyTabsChanged(event.payload.tabs, event.payload.active_tab_id)
      },
    )

    return () => {
      cancelled = true
      off.then((u) => u()).catch(() => {})
    }
  }, [applyTabsChanged])

  async function handleNewTab() {
    setBrowserAutoOpen(true)
    try {
      await invoke('browser_tabs_new', { url: browserHomepage })
    } catch (e) {
      console.error('[Tabs] new failed:', e)
    }
  }

  async function handleSwitch(tabId: string) {
    if (tabId === activeTabId) return
    try {
      await invoke('browser_tabs_switch', { tabId })
    } catch (e) {
      console.error('[Tabs] switch failed:', e)
    }
  }

  async function handleClose(e: React.MouseEvent, tabId: string) {
    e.stopPropagation()
    try {
      await invoke('browser_tabs_close', { tabId })
    } catch (err) {
      console.error('[Tabs] close failed:', err)
    }
  }

  // Hide the strip entirely until the first tab exists — keeps the chrome
  // minimal for users who never use multi-tab.
  if (tabs.length === 0) return null

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 px-1 py-1 border-b bg-background overflow-x-auto scrollbar-none">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => handleSwitch(tab.id)}
              className={cn(
                'group flex items-center gap-1 px-2 h-7 rounded cursor-pointer text-xs shrink-0 max-w-[180px]',
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/60 text-muted-foreground',
              )}
              title={tab.title || tab.url}
            >
              {tab.favicon ? (
                /* eslint-disable-next-line @next/next/no-img-element -- favicon may be data URI or arbitrary external */
                <img src={tab.favicon} className="size-3.5 shrink-0" alt="" />
              ) : (
                <Globe className="size-3.5 shrink-0" />
              )}
              <span className="truncate flex-1 min-w-0">{tab.title || tab.url || t('newTab')}</span>
              <button
                type="button"
                onClick={(e) => handleClose(e, tab.id)}
                aria-label={t('closeTab')}
                className={cn(
                  'shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100',
                  isActive && 'opacity-60',
                  'hover:bg-foreground/10',
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          )
        })}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleNewTab}
              aria-label={t('newTab')}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('newTab')}</p></TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
