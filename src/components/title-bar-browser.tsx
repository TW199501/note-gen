'use client'

import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { FileText, Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import useSettingStore from '@/stores/setting'
import emitter from '@/lib/emitter'

export function BrowserToolbar() {
  const t = useTranslations('browser')
  const { imageMethodModel } = useSettingStore()
  const hasVlm = !!imageMethodModel

  async function handleExtractText() {
    try {
      await invoke('browser_extract_text')
    } catch (error) {
      console.error('[Browser] Failed to extract text:', error)
    }
  }

  async function handleScreenshot() {
    try {
      const path = await invoke<string>('browser_capture')
      emitter.emit('browser-screenshot' as any, { path })
    } catch (error) {
      console.error('[Browser] Failed to capture screenshot:', error)
    }
  }

  return (
    <>
      <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleExtractText}>
              <FileText className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{t('extractText')}</p></TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleScreenshot} disabled={!hasVlm}>
                <Camera className="h-4 w-4" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{hasVlm ? t('screenshot') : t('vlmRequired')}</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="flex-1" data-tauri-drag-region />
    </>
  )
}
