'use client'

import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, RotateCw, Home, Star, Menu, Lock, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  const { browserUrl, browserTitle, browserLoading, browserFavicon } = useBrowserStore()
  const { browserHomepage } = useSettingStore()
  const [inputUrl, setInputUrl] = useState(browserUrl)
  const [bookmarked, setBookmarked] = useState(false)

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
    await invoke('browser_navigate', { url })
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
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => invoke('browser_go_back')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('back')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => invoke('browser_go_forward')}>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('forward')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => invoke('browser_reload')}>
              <RotateCw className={`h-4 w-4 ${browserLoading ? 'animate-spin' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('reload')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => invoke('browser_navigate', { url: browserHomepage })}>
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onMenuClick}>
              <Menu className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent><p>{t('bookmark.title')}</p></TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  )
}
