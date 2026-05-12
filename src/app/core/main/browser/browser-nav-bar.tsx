'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, RotateCw, Home, Star, Settings2, Lock, History, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import useBrowserStore from '@/stores/browser'
import useSettingStore from '@/stores/setting'
import { isBookmarked, addBookmark, removeBookmarkByUrl } from '@/db/bookmarks'
import { addHistoryEntry } from '@/db/browser-history'

interface BrowserNavBarProps {
  onBookmarkToggle?: () => void
  onMenuClick?: () => void
  onHistoryClick?: () => void
}

export function BrowserNavBar({ onBookmarkToggle, onMenuClick, onHistoryClick }: BrowserNavBarProps) {
  const t = useTranslations('browser')
  const tCommon = useTranslations('common')
  const { browserUrl, browserTitle, browserLoading, browserFavicon, browserReady, canGoBack, canGoForward, devtoolsOpen, setBrowserReady, setBrowserUrl, setBrowserTitle, setBrowserFavicon, setBrowserAutoOpen, resetNavState, setDevtoolsOpen, setZoomLevel, setFindOpen, setFindQuery, setFindState } = useBrowserStore()
  const { browserHomepage } = useSettingStore()
  const [inputUrl, setInputUrl] = useState(browserUrl)
  const [bookmarked, setBookmarked] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  async function handleClearData() {
    try {
      await invoke('browser_clear_data')
      setBrowserReady(false)
      setBrowserUrl(browserHomepage)
      setBrowserTitle('')
      setBrowserFavicon('')
      resetNavState()
      setDevtoolsOpen(false)
      setZoomLevel(1.0)
      setFindOpen(false)
      setFindQuery('')
      setFindState(0, -1)
      setConfirmClear(false)
      setSettingsOpen(false)
    } catch (error) {
      console.error('[Browser] Failed to clear data:', error)
    }
  }

  async function handleToggleDevtools() {
    if (!browserReady) return
    try {
      // Rust 端 toggle 後會回傳新狀態並 emit browser-devtools-state event；
      // listener 會更新 store。這裡也直接設一次，避免 event 抵達前 UI 落後。
      const newState = await invoke<boolean>('browser_toggle_devtools')
      setDevtoolsOpen(newState)
    } catch (e) {
      console.error('[Browser] DevTools toggle failed:', e)
    }
  }

  useEffect(() => {
    setInputUrl(browserUrl)
    checkBookmark(browserUrl)
    // 自动记录浏览历史
    if (browserUrl && browserUrl !== 'about:blank') {
      addHistoryEntry(browserTitle || browserUrl, browserUrl, browserFavicon || undefined).catch(() => {})
    }
  }, [browserUrl])

  async function checkBookmark(url: string) {
    try {
      const result = await isBookmarked(url)
      setBookmarked(result)
    } catch {
      setBookmarked(false)
    }
  }

  async function handleNavigate() {
    let url = inputUrl.trim()
    if (!url) return
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url
    }
    // 若使用者在 browser 還沒被 create 之前就在 URL 列按 Enter，
    // 自動 lazy-mount：BrowserWebView 會在下個 tick 觀察到 browserAutoOpen=true 後 spawn webview。
    // 但 browser_navigate 必須在 webview 存在後才呼叫，否則 Rust 端噴 "Browser not created"。
    if (!browserReady) {
      setBrowserAutoOpen(true)
      return
    }
    try {
      await invoke('browser_navigate', { url })
    } catch (e) {
      console.error('[Browser] navigate failed:', e)
    }
  }

  async function handleToggleBookmark() {
    if (bookmarked) {
      await removeBookmarkByUrl(browserUrl)
      setBookmarked(false)
    } else {
      await addBookmark(browserTitle || browserUrl, browserUrl, browserFavicon || undefined)
      setBookmarked(true)
    }
    onBookmarkToggle?.()
  }

  const isHttps = browserUrl.startsWith('https://')

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-background">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoBack}
              aria-label={t('back')}
              onClick={() => { void invoke('browser_go_back').catch((e) => console.error('[Browser] go_back failed:', e)) }}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('back')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!canGoForward}
              aria-label={t('forward')}
              onClick={() => { void invoke('browser_go_forward').catch((e) => console.error('[Browser] go_forward failed:', e)) }}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('forward')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={!browserReady}
              aria-label={t('reload')}
              onClick={() => { void invoke('browser_reload').catch((e) => console.error('[Browser] reload failed:', e)) }}
            >
              <RotateCw className={`h-4 w-4 ${browserLoading ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('reload')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={t('home')}
              onClick={() => {
                if (!browserReady) {
                  setBrowserAutoOpen(true)
                  return
                }
                void invoke('browser_navigate', { url: browserHomepage })
                  .catch((e) => console.error('[Browser] home navigate failed:', e))
              }}
            >
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('home')}</p></TooltipContent>
        </Tooltip>

        <div className="flex-1 flex items-center gap-1 mx-1">
          {isHttps && <Lock className="h-3 w-3 text-green-500 shrink-0" />}
          <Input
            className="h-7 text-sm"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleNavigate()}
            placeholder={t('urlPlaceholder')}
          />
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleBookmark}>
              <Star className={`h-4 w-4 ${bookmarked ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{bookmarked ? t('bookmark.remove') : t('bookmark.add')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onHistoryClick}>
              <History className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('history.title')}</p></TooltipContent>
        </Tooltip>

        <Popover open={settingsOpen} onOpenChange={(open) => { setSettingsOpen(open); if (!open) setConfirmClear(false) }}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Settings2 className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent><p>{t('settings')}</p></TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-56 p-2">
            <div className="space-y-1">
              <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" onClick={onMenuClick}>
                <Star className="h-3.5 w-3.5" />
                {t('bookmark.title')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-xs gap-2"
                onClick={handleToggleDevtools}
                disabled={!browserReady}
              >
                <Wrench className={`h-3.5 w-3.5 ${devtoolsOpen ? 'text-primary' : ''}`} />
                <span className={devtoolsOpen ? 'text-primary' : ''}>
                  {t(devtoolsOpen ? 'contextMenu.devToolsClose' : 'contextMenu.devTools')}
                </span>
              </Button>
              {confirmClear ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <span className="text-xs text-muted-foreground flex-1">{t('clearDataConfirm')}</span>
                  <Button variant="destructive" size="sm" className="h-6 text-xs" onClick={handleClearData}>
                    {t('clearData')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setConfirmClear(false)}>
                    {tCommon('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="w-full justify-start text-xs gap-2" onClick={() => setConfirmClear(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('clearData')}
                </Button>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  )
}
