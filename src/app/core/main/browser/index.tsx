'use client'

import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { Button } from '@/components/ui/button'

// 內建瀏覽器 = 打包的完整 Chromium(ungoogled-chromium),由
// src-tauri/src/browser_chromium.rs 以子程序啟動,並以原生 owned overlay
// 視窗貼在本面板上方。本元件不擁有任何瀏覽器像素:它上報自己的螢幕矩形
// 讓原生視窗貼齊,並在原生視窗還沒起來時顯示啟動/錯誤狀態。
//
// 座標轉換:getBoundingClientRect() 是相對 webview 的 CSS px;overlay 活在
// 桌面螢幕空間實體 px → 加上視窗 outer position、乘以 DPI scale factor。
// NoteGen 是 frameless(set_decorations(false)),outerPosition == innerPosition。
//
// show 由本元件 mount 後第一個有效 rect 觸發;hide 由 page.tsx 依
// workspaceMode 觸發(放在本元件 unmount cleanup 會跟 React 卸載競態)。

type ChromiumStatus = {
  state: 'launching' | 'ready' | 'exited' | 'error'
  message: string
}

export function BrowserPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<ChromiumStatus | null>(null)
  const autoRetriedRef = useRef(false)

  useEffect(() => {
    if (platform() !== 'windows') return
    const win = getCurrentWindow()
    let raf = 0
    let cancelled = false
    let shown = false

    const push = async () => {
      if (cancelled || !ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
      const x = Math.round(pos.x + rect.left * scale)
      const y = Math.round(pos.y + rect.top * scale)
      const w = Math.round(rect.width * scale)
      const h = Math.round(rect.height * scale)
      if (w < 50 || h < 50) return // 跳過 layout 前的零矩形
      if (cancelled) return
      await invoke('chromium_set_panel_rect', { x, y, width: w, height: h })
      if (!shown && !cancelled) {
        shown = true
        await invoke('chromium_show')
      }
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { void push() })
    }

    schedule()
    const ro = new ResizeObserver(schedule)
    if (ref.current) ro.observe(ref.current)

    const unlistenPromise = Promise.all([
      win.listen('tauri://move', schedule),
      win.listen('tauri://resize', schedule),
      win.listen('tauri://scale-change', schedule),
      listen<ChromiumStatus>('chromium-status', (e) => {
        setStatus(e.payload)
        // 意外結束 → 自動重啟一次;再失敗就交給重試 UI。
        if (e.payload.state === 'exited' && !autoRetriedRef.current) {
          autoRetriedRef.current = true
          void invoke('chromium_show')
        }
        if (e.payload.state === 'ready') autoRetriedRef.current = false
      }),
    ])

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      void unlistenPromise.then((fns) => fns.forEach((f) => f()))
    }
  }, [])

  const retry = () => {
    setStatus(null)
    void invoke('chromium_show')
  }

  const failed = status?.state === 'error' || status?.state === 'exited'

  return (
    <div
      ref={ref}
      data-chromium-panel
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-900 text-neutral-500"
    >
      {failed ? (
        <>
          <span className="text-sm">
            {status?.state === 'error' ? `Chromium 啟動失敗:${status.message}` : 'Chromium 已結束'}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>重試</Button>
        </>
      ) : (
        <span className="text-sm">
          {status?.state === 'launching' ? 'Chromium 啟動中…' : 'Chromium — bundled native browser'}
        </span>
      )}
    </div>
  )
}
