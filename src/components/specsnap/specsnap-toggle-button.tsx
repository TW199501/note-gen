'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ScanLine } from 'lucide-react'
import {
  SpecSnapInspector,
  type SpecSnapBundle,
  type SpecSnapInspectorHandle,
} from '@tw199501/specsnap-inspector-react'
import '@tw199501/specsnap-inspector-react/styles.css'
import { openPath } from '@tauri-apps/plugin-opener'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { ToastAction } from '@/components/ui/toast'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

import { isDevMode } from '@/lib/specsnap/is-dev'
import { saveSpecSnapBundle } from '@/lib/specsnap/save-bundle'

const DRAG_POSITION_STORAGE_KEY = 'specsnap-panel-position-v1'

export function SpecSnapToggleButton(): React.ReactElement | null {
  const inspectorRef = useRef<SpecSnapInspectorHandle>(null)
  const [open, setOpen] = useState(false)
  // Guard against SSR: createInspector() touches document.body during render,
  // which crashes on the server pass that Next dev does even for 'use client'
  // components. Only mount the inspector after we are on the client.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // The inspector library only supports four fixed corners — we override its
  // CSS by making the header a drag handle. The panel mounts via React Portal
  // into document.body, so we attach listeners imperatively after `open`
  // flips true. Listeners are torn down when the panel closes/unmounts.
  useEffect(() => {
    if (!open) return

    // The Portal renders synchronously after onOpen fires, but the DOM commit
    // happens on the next frame. Wait one rAF before querying.
    let cleanup: (() => void) | null = null
    const raf = requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>(
        '.specsnap-inspector-panel',
      )
      const header = panel?.querySelector<HTMLElement>(
        '.specsnap-inspector-panel__header',
      )
      if (!panel || !header) return

      // Restore last-saved position if any
      try {
        const saved = localStorage.getItem(DRAG_POSITION_STORAGE_KEY)
        if (saved) {
          const { left, top } = JSON.parse(saved) as { left: number; top: number }
          if (Number.isFinite(left) && Number.isFinite(top)) {
            panel.style.left = `${left}px`
            panel.style.top = `${top}px`
            panel.style.right = 'auto'
            panel.style.bottom = 'auto'
          }
        }
      } catch {
        /* ignore corrupt JSON */
      }

      header.style.cursor = 'move'
      header.style.userSelect = 'none'

      let dragging = false
      let startX = 0
      let startY = 0
      let panelStartLeft = 0
      let panelStartTop = 0

      const onMouseDown = (e: MouseEvent) => {
        // Don't hijack clicks on header buttons (e.g. the × close button)
        if ((e.target as HTMLElement).closest('button')) return
        const rect = panel.getBoundingClientRect()
        panelStartLeft = rect.left
        panelStartTop = rect.top
        startX = e.clientX
        startY = e.clientY
        panel.style.left = `${rect.left}px`
        panel.style.top = `${rect.top}px`
        panel.style.right = 'auto'
        panel.style.bottom = 'auto'
        dragging = true
        e.preventDefault()
      }

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging) return
        const nextLeft = panelStartLeft + (e.clientX - startX)
        const nextTop = panelStartTop + (e.clientY - startY)
        // Keep at least 24px of header on-screen so user can grab it back
        const maxLeft = window.innerWidth - 24
        const maxTop = window.innerHeight - 24
        const clampedLeft = Math.max(-(panel.offsetWidth - 24), Math.min(nextLeft, maxLeft))
        const clampedTop = Math.max(0, Math.min(nextTop, maxTop))
        panel.style.left = `${clampedLeft}px`
        panel.style.top = `${clampedTop}px`
      }

      const onMouseUp = () => {
        if (!dragging) return
        dragging = false
        try {
          localStorage.setItem(
            DRAG_POSITION_STORAGE_KEY,
            JSON.stringify({
              left: parseFloat(panel.style.left),
              top: parseFloat(panel.style.top),
            }),
          )
        } catch {
          /* storage quota or disabled — silently skip */
        }
      }

      header.addEventListener('mousedown', onMouseDown)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)

      cleanup = () => {
        header.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
    })

    return () => {
      cancelAnimationFrame(raf)
      cleanup?.()
    }
  }, [open])

  const handleSave = useCallback(async (bundle: SpecSnapBundle) => {
    try {
      const { dirPath, captureId } = await saveSpecSnapBundle(bundle)
      toast({
        title: 'SpecSnap',
        description: `已儲存 ${captureId}`,
        action: (
          <ToastAction
            altText="打開資料夾"
            onClick={() => {
              void openPath(dirPath)
            }}
          >
            打開資料夾
          </ToastAction>
        ),
      })
    } catch (err) {
      console.error('[SpecSnap] save failed:', err)
      toast({
        title: 'SpecSnap',
        description: `儲存失敗：${err instanceof Error ? err.message : String(err)}`,
      })
      throw err
    }
  }, [])

  const onButtonClick = () => {
    inspectorRef.current?.toggle()
  }

  // Hooks above are always called; gate *rendering* on dev mode so rules-of-hooks
  // is satisfied. `process.env.NODE_ENV` is statically replaced by Next.js — in
  // production builds this always returns null and the JSX below is unreachable.
  if (!isDevMode()) return null

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              open && 'bg-primary/10 text-primary hover:bg-primary/20',
            )}
            onClick={onButtonClick}
            data-testid="specsnap-toggle"
          >
            <ScanLine className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>SpecSnap (dev)</p>
        </TooltipContent>
      </Tooltip>
      {mounted && (
        <SpecSnapInspector
          ref={inspectorRef}
          trigger={false}
          position="bottom-right"
          panelTitle="SpecSnap Inspector"
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          onSave={handleSave}
        />
      )}
    </>
  )
}
