'use client'

import { useCallback, useRef, useState } from 'react'
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

export function SpecSnapToggleButton(): React.ReactElement | null {
  const inspectorRef = useRef<SpecSnapInspectorHandle>(null)
  const [open, setOpen] = useState(false)

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
      <SpecSnapInspector
        ref={inspectorRef}
        trigger={false}
        position="bottom-right"
        panelTitle="SpecSnap Inspector"
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        onSave={handleSave}
      />
    </>
  )
}
