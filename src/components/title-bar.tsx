'use client'

import { useEffect, useState } from 'react'
import { platform } from '@tauri-apps/plugin-os'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isMobileDevice } from '@/lib/check'
import { Settings, Minus, Square, X, Cog, CalendarDays, Globe, NotebookPen } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import useBrowserStore from '@/stores/browser'
import useUpdateStore from '@/stores/update'
import { PinToggle } from './pin-toggle'
import { SyncToggle } from './title-bar-toolbars/sync-toggle'
import AppStatus from './app-status'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { NotesToolbar } from './title-bar-notes'
import { BrowserToolbar } from './title-bar-browser'
import { SpecSnapToggleButton } from './specsnap/specsnap-toggle-button'

type Platform = 'macos' | 'windows' | 'linux' | 'unknown'

interface TitleBarProps {
  onSearchClick?: () => void
  onActivityClick?: () => void
  activityOpen?: boolean
}

export function TitleBar({ onSearchClick, onActivityClick, activityOpen = false }: TitleBarProps) {
  const [currentPlatform, setCurrentPlatform] = useState<Platform>('unknown')
  const [isMobile, setIsMobile] = useState(true)
  const pathname = usePathname()
  const router = useRouter()
  const { workspaceMode, setWorkspaceMode } = useBrowserStore()
  const { hasUpdate } = useUpdateStore()
  const t = useTranslations()

  useEffect(() => {
    setIsMobile(isMobileDevice())
    try {
      const p = platform()
      if (p === 'macos') {
        setCurrentPlatform('macos')
      } else if (p === 'windows') {
        setCurrentPlatform('windows')
      } else if (p === 'linux') {
        setCurrentPlatform('linux')
      }
    } catch (error) {
      console.error('Error detecting platform:', error)
    }
  }, [])

  const handleMinimize = async () => {
    try {
      const window = getCurrentWindow()
      await window.minimize()
    } catch (error) {
      console.error('Error minimizing window:', error)
    }
  }

  const handleMaximize = async () => {
    try {
      const window = getCurrentWindow()
      await window.toggleMaximize()
    } catch (error) {
      console.error('Error maximizing window:', error)
    }
  }

  const handleClose = async () => {
    try {
      const window = getCurrentWindow()
      await window.close()
    } catch (error) {
      console.error('Error closing window:', error)
    }
  }

  if (isMobile) return null
  if (currentPlatform === 'unknown') return null

  const isMacOS = currentPlatform === 'macos'

  return (
    <TooltipProvider>
      <div
        className="h-[36px] w-full flex flex-nowrap items-center select-none shrink-0 fixed top-0 left-0 right-0 z-[9999] border-b bg-background"
        style={{ paddingLeft: isMacOS ? '70px' : '0' }}
        data-tauri-drag-region
      >
        {/* 左側+中間：根據模式切換不同工具列 */}
        {workspaceMode === 'notes' ? (
          <NotesToolbar onSearchClick={onSearchClick} />
        ) : (
          <BrowserToolbar />
        )}

        {/* 右側共用按鈕 */}
        <div className="flex items-center gap-0.5 px-2 shrink-0" data-tauri-drag-region="false">
          {/* SpecSnap inspector toggle — only in browser mode (notes mode has
              it in the record toolbar instead). Placed before the Mode
              toggle so it appears as the leftmost utility icon. */}
          {pathname === '/core/main' && workspaceMode === 'browser' && (
            <SpecSnapToggleButton />
          )}

          {/* Mode toggle - only on main page */}
          {pathname === '/core/main' && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8',
                      workspaceMode === 'notes'
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setWorkspaceMode('notes')}
                  >
                    <NotebookPen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t('navigation.notesMode')}</p>
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'h-8 w-8',
                      workspaceMode === 'browser'
                        ? 'bg-primary/10 text-primary hover:bg-primary/20'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    onClick={() => setWorkspaceMode('browser')}
                  >
                    <Globe className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>{t('navigation.browserMode')}</p>
                </TooltipContent>
              </Tooltip>

              <div className="w-px h-4 bg-border mx-1" />
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 ${activityOpen ? 'bg-primary/10 text-primary hover:bg-primary/15' : ''}`}
                onClick={onActivityClick}
              >
                <CalendarDays className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{t('navigation.activity')}</p>
            </TooltipContent>
          </Tooltip>

          <SyncToggle />

          <PinToggle />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 relative ${pathname.includes('/core/setting') ? 'bg-primary/50 hover:bg-primary/60' : ''}`}
                onClick={() => {
                  if (pathname.includes('/core/setting')) {
                    router.push('/core/main')
                  } else {
                    router.push('/core/setting')
                  }
                }}
              >
                {pathname.includes('/core/setting') ? (
                  <Cog className="h-4 w-4" />
                ) : (
                  <Settings className="h-4 w-4" />
                )}
                {hasUpdate && !pathname.includes('/core/setting') && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-red-500" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>{pathname.includes('/core/setting') ? t('common.back') : t('common.settings')}</p>
            </TooltipContent>
          </Tooltip>

          <AppStatus />
        </div>

        {/* Windows/Linux 控制按钮 */}
        {!isMacOS && (
          <div className="flex items-center shrink-0 relative z-10">
            <Button variant="ghost" size="icon" className="h-9 w-12 rounded-none hover:bg-accent" onClick={handleMinimize}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-12 rounded-none hover:bg-accent" onClick={handleMaximize}>
              <Square className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-12 rounded-none hover:bg-destructive hover:text-destructive-foreground" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
