'use client'

// 暫時佔位:舊 WebView 瀏覽器 React 堆疊已刪除;打包 Chromium 的後端
// (browser_chromium.rs)在後續 task 落地後,本元件換成上報 rect 的正式版。
export function BrowserPanel() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-500">
      <span className="text-sm">Browser panel</span>
    </div>
  )
}
