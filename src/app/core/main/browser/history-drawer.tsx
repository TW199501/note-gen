'use client'

import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Globe, History, Search, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  getHistory,
  searchHistory,
  clearHistory,
  type BrowserHistoryEntry,
} from '@/db/browser-history'
import useBrowserStore from '@/stores/browser'

dayjs.extend(relativeTime)

interface HistoryDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

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
    if (entry.visitedAt >= todayStart) {
      groups.today.push(entry)
    } else if (entry.visitedAt >= yesterdayStart) {
      groups.yesterday.push(entry)
    } else {
      groups.earlier.push(entry)
    }
  }

  return groups
}

export function HistoryDrawer({ open, onOpenChange }: HistoryDrawerProps) {
  const t = useTranslations('browser.history')
  const tCommon = useTranslations('common')
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const { pushOverlay, popOverlay } = useBrowserStore()

  useEffect(() => {
    if (open) pushOverlay()
    else popOverlay()
  }, [open, pushOverlay, popOverlay])

  useEffect(() => {
    if (open) {
      setQuery('')
      setConfirmClear(false)
      loadHistory()
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (query.trim()) {
        searchHistory(query.trim()).then(setEntries)
      } else {
        loadHistory()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, open])

  async function loadHistory() {
    const data = await getHistory()
    setEntries(data)
  }

  async function handleNavigate(url: string) {
    await invoke('browser_navigate', { url })
    onOpenChange(false)
  }

  async function handleClearHistory() {
    await clearHistory()
    setEntries([])
    setConfirmClear(false)
  }

  const grouped = useMemo(() => groupByDate(entries), [entries])

  function renderGroup(label: string, items: BrowserHistoryEntry[]) {
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
              /* eslint-disable-next-line @next/next/no-img-element -- favicon from arbitrary external domains */
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
      <SheetContent side="left" className="flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            {t('title')}
          </SheetTitle>
        </SheetHeader>

        <div className="relative mt-4">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto mt-2 space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{t('empty')}</p>
          ) : (
            <>
              {renderGroup(t('today'), grouped.today)}
              {renderGroup(t('yesterday'), grouped.yesterday)}
              {renderGroup(t('earlier'), grouped.earlier)}
            </>
          )}
        </div>

        {entries.length > 0 && (
          <div className="pt-4 border-t">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground flex-1">{t('clearConfirm')}</span>
                <Button variant="destructive" size="sm" onClick={handleClearHistory}>
                  {t('clear')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                  {tCommon('cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('clear')}
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
