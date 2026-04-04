'use client'

import { useState, useEffect } from 'react'
import { BrowserNavBar } from './browser-nav-bar'
import { BrowserWebView } from './browser-webview'
import { BrowserDrawer, type BrowserDrawerTab } from './browser-drawer'
import { BookmarkBar } from './bookmark-bar'
import { addBookmark, isBookmarked } from '@/db/bookmarks'
import emitter from '@/lib/emitter'

export function BrowserPanel() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerTab, setDrawerTab] = useState<BrowserDrawerTab>('history')
  const [bookmarkRefresh, setBookmarkRefresh] = useState(0)

  function openDrawer(tab: BrowserDrawerTab) {
    setDrawerTab(tab)
    setDrawerOpen(true)
  }

  // Listen for context menu bookmark action
  useEffect(() => {
    const handleAddBookmark = async (data: unknown) => {
      const { url, title } = data as { url: string; title: string }
      if (!url) return
      const already = await isBookmarked(url)
      if (!already) {
        await addBookmark(title || url, url)
        setBookmarkRefresh((n) => n + 1)
      }
    }
    emitter.on('browser-add-bookmark' as any, handleAddBookmark)
    return () => {
      emitter.off('browser-add-bookmark' as any, handleAddBookmark)
    }
  }, [])

  return (
    <div className="flex flex-col h-full">
      <BrowserNavBar
        onBookmarkToggle={() => setBookmarkRefresh((n) => n + 1)}
        onMenuClick={() => openDrawer('bookmarks')}
        onHistoryClick={() => openDrawer('history')}
      />
      <BookmarkBar refreshTrigger={bookmarkRefresh} />
      <BrowserWebView />
      <BrowserDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        defaultTab={drawerTab}
        bookmarkRefreshTrigger={bookmarkRefresh}
      />
    </div>
  )
}
