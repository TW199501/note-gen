'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getAllBookmarks, type Bookmark } from '@/db/bookmarks'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/utils'

interface BookmarkBarProps {
  refreshTrigger?: number
}

export function BookmarkBar({ refreshTrigger }: BookmarkBarProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

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
    await invoke('browser_navigate', { url })
  }

  if (bookmarks.length === 0) return null

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b bg-background overflow-x-auto scrollbar-none">
      {bookmarks.map((bookmark) => (
        <button
          key={bookmark.id}
          className={cn(
            'flex items-center gap-1.5 px-2 py-0.5 rounded text-xs',
            'hover:bg-accent hover:text-accent-foreground',
            'whitespace-nowrap shrink-0 max-w-[160px] truncate'
          )}
          onClick={() => handleNavigate(bookmark.url)}
          title={bookmark.url}
        >
          {bookmark.favicon ? (
            /* eslint-disable-next-line @next/next/no-img-element -- favicon 來自任意外部網域或 data URI，next/image 對 12px icon 無優化意義 */
            <img src={bookmark.favicon} className="size-3 shrink-0" alt="" />
          ) : (
            <Globe className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{bookmark.title}</span>
        </button>
      ))}
    </div>
  )
}
