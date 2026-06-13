import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
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

  it('non-windows platform: no IPC calls at all', async () => {
    platformMock.mockReturnValue('macos')
    render(<BrowserPanel />)
    await flush()
    expect(invokeMock).toHaveBeenCalledTimes(0)
  })

  it('chromium-status exited triggers exactly one auto-retry', async () => {
    render(<BrowserPanel />)
    await flush()
    // 此時應有 1 次 chromium_show(初始 mount → first rect)
    const showsAfterInit = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show').length
    expect(showsAfterInit).toBe(1)
    // emit exited 三次,觀察只有一次自動重啟
    await act(async () => {
      statusListener?.({ payload: { state: 'exited', message: '' } })
      statusListener?.({ payload: { state: 'exited', message: '' } })
      statusListener?.({ payload: { state: 'exited', message: '' } })
      await Promise.resolve()
    })
    const showsAfterExits = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show').length
    // 預期 = 1(init) + 1(auto-retry once) = 2
    expect(showsAfterExits).toBe(2)
  })

  it('ready event resets auto-retry counter so subsequent exited retries again', async () => {
    render(<BrowserPanel />)
    await flush()
    await act(async () => {
      statusListener?.({ payload: { state: 'exited', message: '' } })
      await Promise.resolve()
    })
    // 1 init + 1 auto-retry
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show')).toHaveLength(2)
    await act(async () => {
      statusListener?.({ payload: { state: 'ready', message: '' } })
      statusListener?.({ payload: { state: 'exited', message: '' } })
      await Promise.resolve()
    })
    // ready 後又 exited → 應再自動重啟一次
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show')).toHaveLength(3)
  })

  it('error state shows failure message and retry button', async () => {
    render(<BrowserPanel />)
    await flush()
    await act(async () => {
      statusListener?.({ payload: { state: 'error', message: 'chrome.exe not found' } })
      await Promise.resolve()
    })
    expect(screen.getByText(/chrome\.exe not found/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重試' })).toBeInTheDocument()
  })

  it('manual retry button click invokes chromium_show + clears failure UI', async () => {
    render(<BrowserPanel />)
    await flush()
    await act(async () => {
      statusListener?.({ payload: { state: 'error', message: 'spawn failed' } })
      await Promise.resolve()
    })
    const before = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show').length
    const btn = screen.getByRole('button', { name: '重試' })
    await act(async () => {
      fireEvent.click(btn)
      await Promise.resolve()
    })
    const after = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show').length
    expect(after).toBe(before + 1)
    expect(screen.queryByRole('button', { name: '重試' })).not.toBeInTheDocument()
  })
})
