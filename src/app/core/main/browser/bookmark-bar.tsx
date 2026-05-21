'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getAllBookmarks, type Bookmark } from '@/db/bookmarks'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useBrowserStore from '@/stores/browser'

interface BookmarkBarProps {
  refreshTrigger?: number
}

export function BookmarkBar({ refreshTrigger }: BookmarkBarProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const { browserReady, setBrowserAutoOpen } = useBrowserStore()

  useEffect(() => {
    loadBookmarks()
  }, [refreshTrigger])

  async function loadBookmarks() {
    try {
      const data = await getAllBookmarks()
      setBookmarks(data)
    } catch {
      setBookmarks([])
    }
  }

  async function handleNavigate(url: string) {
    if (!browserReady) {
      // Lazy-mount browser, queue navigation by storing intent in homepage? Simpler:
      // just open browser, user clicks bookmark again. Or set browserUrl + auto-open.
      setBrowserAutoOpen(true)
      return
    }
    try {
      await invoke('browser_navigate', { url })
    } catch (e) {
      console.error('[Browser] bookmark navigate failed:', e)
    }
  }

  if (bookmarks.length === 0) return null

  return (
    <TooltipProvider>
      <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-background overflow-x-auto scrollbar-none relative z-10">
        {bookmarks.map((bookmark) => (
          <Tooltip key={bookmark.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs',
                  'hover:bg-accent hover:text-accent-foreground',
                  'whitespace-nowrap shrink-0 max-w-[160px] truncate'
                )}
                onClick={() => handleNavigate(bookmark.url)}
              >
                {bookmark.favicon ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- favicon 來自任意外部網域或 data URI */
                  <img src={bookmark.favicon} className="size-3 shrink-0" alt="" />
                ) : (
                  <Globe className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{bookmark.title}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="max-w-[300px] truncate">{bookmark.url}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
