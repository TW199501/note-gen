import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { BrowserPanel } from './index'

const invokeMock = vi.fn(async () => undefined)
const platformMock = vi.fn(() => 'windows')
// 抓 chromium-status 的 callback,讓測試端可手動 emit
let statusListener: ((e: { payload: { state: string; message: string } }) => void) | null = null
// 抓 tauri:// 視窗事件的 callbacks(resize/move/scale-change),讓測試手動觸發 schedule
const winEventListeners: Map<string, () => void> = new Map()
const winListenStub = vi.fn(async (evt: string, cb: () => void) => {
  winEventListeners.set(evt, cb)
  return () => winEventListeners.delete(evt)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_evt: string, cb: (e: { payload: { state: string; message: string } }) => void) => {
    statusListener = cb
    return () => { statusListener = null }
  }),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    outerPosition: async () => ({ x: 100, y: 50 }),
    scaleFactor: async () => 2,
    listen: winListenStub,
  }),
}))

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: () => platformMock(),
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// 強制 getBoundingClientRect 回測試用矩形(jsdom 預設都是 0)
function mockRect(rect: { left: number; top: number; width: number; height: number }) {
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  })) as unknown as Element['getBoundingClientRect']
}

// 推進 requestAnimationFrame 與 microtasks 讓 push() 完成
async function flush() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  invokeMock.mockClear()
  platformMock.mockReturnValue('windows')
  statusListener = null
  winEventListeners.clear()
  winListenStub.mockClear()
  mockRect({ left: 10, top: 20, width: 800, height: 600 })
})

describe('BrowserPanel', () => {
  it('pushes rect with screen-space physical px math', async () => {
    render(<BrowserPanel />)
    await flush()
    const setRectCall = invokeMock.mock.calls.find((c) => c[0] === 'chromium_set_panel_rect')
    expect(setRectCall).toBeDefined()
    // outerPos.x(100) + rect.left(10) * scale(2) = 120
    // outerPos.y(50) + rect.top(20) * scale(2) = 90
    // rect.width(800) * scale(2) = 1600
    // rect.height(600) * scale(2) = 1200
    expect(setRectCall![1]).toEqual({ x: 120, y: 90, width: 1600, height: 1200 })
  })

  it('skips rect smaller than 50x50 in physical px (after DPI scaling)', async () => {
    // 物理 px = CSS px * scale(2);要 < 50 物理 px 需 CSS px < 25
    mockRect({ left: 0, top: 0, width: 24, height: 600 })
    render(<BrowserPanel />)
    await flush()
    const setRectCalls = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_set_panel_rect')
    expect(setRectCalls).toHaveLength(0)
  })

  it('fires chromium_show on first valid rect, not subsequent', async () => {
    render(<BrowserPanel />)
    await flush()
    // 模擬使用者拉動視窗:tauri://resize 觸發第二次 schedule + push
    await act(async () => {
      winEventListeners.get('tauri://resize')?.()
    })
    await flush()
    const showCalls = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show')
    expect(showCalls).toHaveLength(1)
    // 順便驗證第二次 rect push 確實有發生(否則測試強度仍嫌不夠)
    const rectCalls = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_set_panel_rect')
    expect(rectCalls.length).toBeGreaterThanOrEqual(2)
  })
})
