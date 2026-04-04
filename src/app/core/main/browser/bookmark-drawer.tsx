'use client'

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { Globe, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { getAllBookmarks, removeBookmark, type Bookmark } from '@/db/bookmarks'
import useBrowserStore from '@/stores/browser'

interface BookmarkDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  refreshTrigger?: number
}

export function BookmarkDrawer({ open, onOpenChange, refreshTrigger }: BookmarkDrawerProps) {
  const t = useTranslations('browser.bookmark')
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const { pushOverlay, popOverlay } = useBrowserStore()

  useEffect(() => {
    if (open) pushOverlay()
    else popOverlay()
  }, [open, pushOverlay, popOverlay])

  useEffect(() => {
    if (open) {
      loadBookmarks()
    }
  }, [open, refreshTrigger])

  async function loadBookmarks() {
    const data = await getAllBookmarks()
    setBookmarks(data)
  }

  async function handleDelete(id: number) {
    await removeBookmark(id)
    await loadBookmarks()
  }

  async function handleNavigate(url: string) {
    await invoke('browser_navigate', { url })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-1">
          {bookmarks.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{t('empty')}</p>
          )}
          {bookmarks.map((bookmark) => (
            <div
              key={bookmark.id}
              className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer group"
              onClick={() => handleNavigate(bookmark.url)}
            >
              {bookmark.favicon ? (
                /* eslint-disable-next-line @next/next/no-img-element -- favicon from arbitrary external domains */
                <img src={bookmark.favicon} className="size-4 shrink-0 rounded" alt="" />
              ) : (
                <Globe className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{bookmark.title}</p>
                <p className="text-xs text-muted-foreground truncate">{bookmark.url}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(bookmark.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
