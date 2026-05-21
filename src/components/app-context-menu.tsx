'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { invoke } from '@tauri-apps/api/core'
import { checkIsTauri } from '@/lib/check'
import emitter from '@/lib/emitter'
import { Scissors, Copy, ClipboardPaste, Printer, Wrench, Crop } from 'lucide-react'

type MenuState = {
  x: number
  y: number
  hasSelection: boolean
  editable: boolean
}

/**
 * Global right-click menu for the main Tauri webview (everything outside the
 * child `browser-webview` — i.e. title bar, browser chrome, chat panel,
 * settings, etc.). Mirrors a normal desktop browser's context menu so users
 * get cut/copy/paste/print/devtools/region-screenshot without falling back
 * to platform-default (English) menus.
 *
 * The browser child webview (label=browser-webview / browser-tab-*) has its
 * own injected menu via browser_inject_context_menu; this one lives entirely
 * in React land for the host webview.
 */
export function AppContextMenu() {
  const t = useTranslations('appContextMenu')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!checkIsTauri()) return

    function handleContextMenu(e: MouseEvent) {
      e.preventDefault()
      const target = e.target as HTMLElement | null
      const editable =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      const hasSelection = !!window.getSelection()?.toString()
      setMenu({ x: e.clientX, y: e.clientY, hasSelection, editable })
    }

    function dismiss(e: MouseEvent | KeyboardEvent) {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return
      setMenu(null)
    }

    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('mousedown', dismiss, true)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setMenu(null)
    })

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('mousedown', dismiss, true)
    }
  }, [])

  // Clamp the menu box inside the viewport once it has rendered so it never
  // overflows when the user right-clicks near the bottom/right edge.
  useEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const next: Partial<MenuState> = {}
    if (r.right > window.innerWidth) next.x = window.innerWidth - r.width - 4
    if (r.bottom > window.innerHeight) next.y = window.innerHeight - r.height - 4
    if (next.x !== undefined || next.y !== undefined) {
      setMenu((m) => (m ? { ...m, ...next } : m))
    }
  }, [menu?.x, menu?.y])

  if (!menu) return null

  const run = async (fn: () => void | Promise<unknown>) => {
    setMenu(null)
    try {
      await fn()
    } catch (e) {
      console.error('[AppContextMenu] action failed:', e)
    }
  }

  const showCut = menu.hasSelection && menu.editable
  const showCopy = menu.hasSelection
  const showPaste = menu.editable

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[10000] bg-popover text-popover-foreground border border-border rounded-md py-1 shadow-lg min-w-[200px] text-sm select-none"
      style={{ left: menu.x, top: menu.y }}
    >
      {showCut && (
        <MenuItem icon={<Scissors className="size-3.5" />} onClick={() => run(() => document.execCommand('cut'))}>
          {t('cut')}
        </MenuItem>
      )}
      {showCopy && (
        <MenuItem icon={<Copy className="size-3.5" />} onClick={() => run(() => document.execCommand('copy'))}>
          {t('copy')}
        </MenuItem>
      )}
      {showPaste && (
        <MenuItem icon={<ClipboardPaste className="size-3.5" />} onClick={() => run(() => document.execCommand('paste'))}>
          {t('paste')}
        </MenuItem>
      )}
      {(showCut || showCopy || showPaste) && <Separator />}

      <MenuItem
        icon={<Crop className="size-3.5" />}
        onClick={() =>
          run(async () => {
            try {
              const path = await invoke<string | null>('app_region_screenshot')
              if (path) {
                emitter.emit('browser-screenshot' as any, { path })
              }
            } catch (e) {
              console.error('[AppContextMenu] region screenshot failed:', e)
            }
          })
        }
      >
        {t('screenshotRegion')}
      </MenuItem>

      <MenuItem icon={<Printer className="size-3.5" />} onClick={() => run(() => window.print())}>
        {t('print')}
      </MenuItem>

      <Separator />

      <MenuItem
        icon={<Wrench className="size-3.5" />}
        onClick={() => run(() => invoke('app_toggle_devtools'))}
      >
        {t('devTools')}
      </MenuItem>
    </div>
  )
}

function MenuItem({
  icon,
  children,
  onClick,
}: {
  icon?: React.ReactNode
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <div
      role="menuitem"
      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent hover:text-accent-foreground"
      onClick={onClick}
    >
      <span className="opacity-70 shrink-0">{icon}</span>
      <span className="flex-1">{children}</span>
    </div>
  )
}

function Separator() {
  return <div className="h-px bg-border my-1 mx-1" />
}
