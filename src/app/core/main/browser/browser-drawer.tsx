'use client'

import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Globe, History, Search, Trash2, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getAllBookmarks, removeBookmark, type Bookmark } from '@/db/bookmarks'
import {
  getHistory,
  searchHistory,
  clearHistory,
  type BrowserHistoryEntry,
} from '@/db/browser-history'
import useBrowserStore from '@/stores/browser'

dayjs.extend(relativeTime)

export type BrowserDrawerTab = 'history' | 'bookmarks'

interface BrowserDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: BrowserDrawerTab
  bookmarkRefreshTrigger?: number
}

// --- History helpers ---

interface GroupedHistory {
  today: BrowserHistoryEntry[]
  yesterday: BrowserHistoryEntry[]
  earlier: BrowserHistoryEntry[]
}

function groupByDate(entries: BrowserHistoryEntry[]): GroupedHistory {
  const now = dayjs()
  const todayStart = now.startOf('day').valueOf()
  const yesterdayStart = now.subtract(1, 'day').startOf('day').valueOf()

  const groups: GroupedHistory = { today: [], yesterday: [], earlier: [] }
  for (const entry of entries) {
    if (entry.visitedAt >= todayStart) groups.today.push(entry)
    else if (entry.visitedAt >= yesterdayStart) groups.yesterday.push(entry)
    else groups.earlier.push(entry)
  }
  return groups
}

// --- Component ---

export function BrowserDrawer({ open, onOpenChange, defaultTab = 'history', bookmarkRefreshTrigger }: BrowserDrawerProps) {
  const tHistory = useTranslations('browser.history')
  const tBookmark = useTranslations('browser.bookmark')
  const tCommon = useTranslations('common')
  const { pushOverlay, popOverlay, browserReady, setBrowserAutoOpen } = useBrowserStore()

  const [activeTab, setActiveTab] = useState<BrowserDrawerTab>(defaultTab)

  // History state
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  // Bookmark state
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])

  // Overlay management
  useEffect(() => {
    if (open) pushOverlay()
    else popOverlay()
  }, [open, pushOverlay, popOverlay])

  // Sync defaultTab when opened
  useEffect(() => {
    if (open) setActiveTab(defaultTab)
  }, [open, defaultTab])

  // Load history when tab is active
  useEffect(() => {
    if (open && activeTab === 'history') {
      setQuery('')
      setConfirmClear(false)
      loadHistory()
    }
  }, [open, activeTab])

  // History search with debounce
  useEffect(() => {
    if (!open || activeTab !== 'history') return
    const timer = setTimeout(() => {
      if (query.trim()) {
        searchHistory(query.trim()).then(setEntries)
      } else {
        loadHistory()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, open, activeTab])

  // Load bookmarks when tab is active
  useEffect(() => {
    if (open && activeTab === 'bookmarks') {
      loadBookmarks()
    }
  }, [open, activeTab, bookmarkRefreshTrigger])

  async function loadHistory() {
    const data = await getHistory()
    setEntries(data)
  }

  async function loadBookmarks() {
    const data = await getAllBookmarks()
    setBookmarks(data)
  }

  async function handleNavigate(url: string) {
    if (!browserReady) {
      setBrowserAutoOpen(true)
      onOpenChange(false)
      return
    }
    try {
      await invoke('browser_navigate', { url })
    } catch (e) {
      console.error('[Browser] drawer navigate failed:', e)
    }
    onOpenChange(false)
  }

  async function handleClearHistory() {
    await clearHistory()
    setEntries([])
    setConfirmClear(false)
  }

  async function handleDeleteBookmark(id: number) {
    await removeBookmark(id)
    await loadBookmarks()
  }

  const grouped = useMemo(() => groupByDate(entries), [entries])

  function renderHistoryGroup(label: string, items: BrowserHistoryEntry[]) {
    if (items.length === 0) return null
    return (
      <div key={label}>
        <p className="text-xs font-semibold text-muted-foreground px-2 py-1">{label}</p>
        {items.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer"
            onClick={() => handleNavigate(entry.url)}
          >
            {entry.favicon ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={entry.favicon} className="size-4 shrink-0 rounded" alt="" />
            ) : (
              <Globe className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{entry.title}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground truncate flex-1">{entry.url}</p>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {dayjs(entry.visitedAt).fromNow()}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-0">
          <SheetTitle className="sr-only">Browser</SheetTitle>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as BrowserDrawerTab)} className="flex flex-col flex-1 min-h-0">
          <TabsList className="mx-4 mt-2">
            <TabsTrigger value="history" className="flex-1 gap-1.5">
              <History className="h-3.5 w-3.5" />
              {tHistory('title')}
            </TabsTrigger>
            <TabsTrigger value="bookmarks" className="flex-1 gap-1.5">
              <Star className="h-3.5 w-3.5" />
              {tBookmark('title')}
            </TabsTrigger>
          </TabsList>

          {/* History Tab */}
          <TabsContent value="history" className="flex flex-col flex-1 min-h-0 px-4 mt-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={tHistory('search')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="flex-1 overflow-y-auto mt-2 space-y-2">
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{tHistory('empty')}</p>
              ) : (
                <>
                  {renderHistoryGroup(tHistory('today'), grouped.today)}
                  {renderHistoryGroup(tHistory('yesterday'), grouped.yesterday)}
                  {renderHistoryGroup(tHistory('earlier'), grouped.earlier)}
                </>
              )}
            </div>

            {entries.length > 0 && (
              <div className="pt-4 pb-4 border-t">
                {confirmClear ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground flex-1">{tHistory('clearConfirm')}</span>
                    <Button variant="destructive" size="sm" onClick={handleClearHistory}>
                      {tHistory('clear')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                      {tCommon('cancel')}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" className="w-full" onClick={() => setConfirmClear(true)}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    {tHistory('clear')}
                  </Button>
                )}
              </div>
            )}
          </TabsContent>

          {/* Bookmarks Tab */}
          <TabsContent value="bookmarks" className="flex flex-col flex-1 min-h-0 px-4 mt-2">
            <div className="flex-1 overflow-y-auto space-y-1">
              {bookmarks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">{tBookmark('empty')}</p>
              ) : (
                bookmarks.map((bookmark) => (
                  <div
                    key={bookmark.id}
                    className="flex items-center gap-2 p-2 rounded-md hover:bg-accent cursor-pointer group"
                    onClick={() => handleNavigate(bookmark.url)}
                  >
                    {bookmark.favicon ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
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
                        handleDeleteBookmark(bookmark.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
