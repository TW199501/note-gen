'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { Download, FolderOpen, Trash2, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  getDownloads,
  clearDownloads,
  removeDownload,
  type DownloadEntry,
} from '@/db/downloads'
import useBrowserStore from '@/stores/browser'

dayjs.extend(relativeTime)

interface DownloadsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Bumped externally when new download events fire so the drawer can refresh
   * while open. Same pattern as bookmark-drawer's refreshTrigger.
   */
  refreshTrigger?: number
}

export function DownloadsDrawer({ open, onOpenChange, refreshTrigger }: DownloadsDrawerProps) {
  const t = useTranslations('browser.downloads')
  const tCommon = useTranslations('common')
  const [entries, setEntries] = useState<DownloadEntry[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const { pushOverlay, popOverlay } = useBrowserStore()

  useEffect(() => {
    if (open) pushOverlay()
    else popOverlay()
  }, [open, pushOverlay, popOverlay])

  useEffect(() => {
    if (open) {
      setConfirmClear(false)
      void loadEntries()
    }
  }, [open, refreshTrigger])

  async function loadEntries() {
    try {
      const data = await getDownloads(200)
      setEntries(data)
    } catch (e) {
      console.error('[Downloads] load failed:', e)
      setEntries([])
    }
  }

  async function handleOpenFile(entry: DownloadEntry) {
    if (!entry.path || entry.status !== 'finished') return
    try {
      await openPath(entry.path)
    } catch (e) {
      console.error('[Downloads] open file failed:', e)
    }
  }

  async function handleRevealInFolder(entry: DownloadEntry) {
    if (!entry.path) return
    try {
      await revealItemInDir(entry.path)
    } catch (e) {
      console.error('[Downloads] reveal in folder failed:', e)
    }
  }

  async function handleRemove(id: number) {
    try {
      await removeDownload(id)
      await loadEntries()
    } catch (e) {
      console.error('[Downloads] remove failed:', e)
    }
  }

  async function handleClearAll() {
    try {
      await clearDownloads()
      setEntries([])
      setConfirmClear(false)
    } catch (e) {
      console.error('[Downloads] clear all failed:', e)
    }
  }

  function statusIcon(status: DownloadEntry['status']) {
    switch (status) {
      case 'finished':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />
      case 'started':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              {t('title')}
            </span>
            {entries.length > 0 && (
              confirmClear ? (
                <div className="flex items-center gap-1">
                  <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={handleClearAll}>
                    {t('clearAll')}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfirmClear(false)}>
                    {tCommon('cancel')}
                  </Button>
                </div>
              ) : (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setConfirmClear(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('clearAll')}
                </Button>
              )
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-1">
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">{t('empty')}</p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="group flex items-start gap-2 p-2 rounded hover:bg-accent text-sm"
            >
              <div className="mt-0.5 shrink-0">{statusIcon(entry.status)}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate" title={entry.filename}>{entry.filename}</div>
                <div className="text-xs text-muted-foreground truncate" title={entry.url}>
                  {entry.url}
                </div>
                <div className="text-xs text-muted-foreground">
                  {dayjs(entry.startedAt).fromNow()}
                  {entry.status === 'failed' && ` · ${t('failed')}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {entry.status === 'finished' && entry.path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleOpenFile(entry)}
                    aria-label={t('open')}
                    title={t('open')}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                )}
                {entry.path && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleRevealInFolder(entry)}
                    aria-label={t('revealInFolder')}
                    title={t('revealInFolder')}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={t('remove')}
                  title={t('remove')}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
