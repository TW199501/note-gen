'use client'

import { useState } from 'react'
import { BrowserNavBar } from './browser-nav-bar'
import { BrowserStatusBar } from './browser-status-bar'
import { BrowserWebView } from './browser-webview'
import { BookmarkDrawer } from './bookmark-drawer'
import { BookmarkBar } from './bookmark-bar'
import { HistoryDrawer } from './history-drawer'

export function BrowserPanel() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [bookmarkRefresh, setBookmarkRefresh] = useState(0)

  return (
    <div className="flex flex-col h-full">
      <BrowserNavBar
        onBookmarkToggle={() => setBookmarkRefresh((n) => n + 1)}
        onMenuClick={() => setDrawerOpen(true)}
        onHistoryClick={() => setHistoryOpen(true)}
      />
      <BookmarkBar refreshTrigger={bookmarkRefresh} />
      <BrowserWebView />
      <BrowserStatusBar />
      <BookmarkDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        refreshTrigger={bookmarkRefresh}
      />
      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  )
}
