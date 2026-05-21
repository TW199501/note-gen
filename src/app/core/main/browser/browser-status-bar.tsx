'use client'

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { FileText, Camera, Loader2, Trash2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useBrowserStore from '@/stores/browser'
import useSettingStore from '@/stores/setting'
import emitter from '@/lib/emitter'
import { zoomIn, zoomOut, zoomReset, formatZoomPercent } from '@/lib/browser/zoom'

export function BrowserStatusBar() {
  const t = useTranslations('browser')
  const tCommon = useTranslations('common')
  const { browserLoading, browserReady, zoomLevel, setBrowserReady, setBrowserUrl, setBrowserTitle, setBrowserFavicon, setZoomLevel } = useBrowserStore()
  const { imageMethodModel, browserHomepage } = useSettingStore()
  const hasVlm = !!imageMethodModel
  const [confirmClear, setConfirmClear] = useState(false)

  async function handleExtractText() {
    try {
      // Triggers JS injection in WebView; result arrives via browser-content-extracted event
      await invoke('browser_extract_text')
    } catch (error) {
      console.error('[Browser] Failed to extract text:', error)
    }
  }

  async function handleScreenshot() {
    try {
      const path = await invoke<string>('browser_capture')
      // Emit event to chat with screenshot
      emitter.emit('browser-screenshot' as any, { path })
    } catch (error) {
      console.error('[Browser] Failed to capture screenshot:', error)
    }
  }

  async function applyZoom(level: number) {
    if (!browserReady) return
    try {
      const actual = await invoke<number>('browser_set_zoom', { level })
      setZoomLevel(actual)
    } catch (e) {
      console.error('[Browser] zoom failed:', e)
    }
  }

  async function handleClearData() {
    try {
      await invoke('browser_clear_data')
      // Reset browser state so WebView can be recreated
      setBrowserReady(false)
      setBrowserUrl(browserHomepage)
      setBrowserTitle('')
      setBrowserFavicon('')
      setConfirmClear(false)
    } catch (error) {
      console.error('[Browser] Failed to clear data:', error)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-between px-2 py-1 border-t bg-background text-xs">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={handleExtractText}>
            <FileText className="h-3 w-3" />
            {t('extractText')}
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs gap-1"
                  onClick={handleScreenshot}
                  disabled={!hasVlm}
                >
                  <Camera className="h-3 w-3" />
                  {t('screenshot')}
                </Button>
              </span>
            </TooltipTrigger>
            {!hasVlm && (
              <TooltipContent><p>{t('vlmRequired')}</p></TooltipContent>
            )}
          </Tooltip>

          {confirmClear ? (
            <div className="flex items-center gap-1 ml-2">
              <span className="text-muted-foreground">{t('clearDataConfirm')}</span>
              <Button variant="destructive" size="sm" className="h-6 text-xs" onClick={handleClearData}>
                {t('clearData')}
              </Button>
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setConfirmClear(false)}>
                {tCommon('cancel')}
              </Button>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setConfirmClear(true)}>
                  <Trash2 className="h-3 w-3" />
                  {t('clearData')}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('clearDataConfirm')}</p></TooltipContent>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-1 text-muted-foreground">
          {browserLoading && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>{t('loading')}</span>
            </>
          )}
          {/* R6 zoom controls */}
          <div className="flex items-center gap-0.5 ml-2 border-l pl-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => applyZoom(zoomOut(zoomLevel))}
                  disabled={!browserReady}
                  aria-label={t('zoomOut')}
                >
                  <Minus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('zoomOut')}</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs font-mono min-w-[3.5rem]"
                  onClick={() => applyZoom(zoomReset())}
                  disabled={!browserReady}
                  aria-label={t('zoomReset')}
                >
                  {formatZoomPercent(zoomLevel)}
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('zoomReset')}</p></TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5"
                  onClick={() => applyZoom(zoomIn(zoomLevel))}
                  disabled={!browserReady}
                  aria-label={t('zoomIn')}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent><p>{t('zoomIn')}</p></TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </TooltipProvider>
  )
}
