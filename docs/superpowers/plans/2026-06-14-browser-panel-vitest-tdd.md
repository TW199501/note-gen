# BrowserPanel Vitest TDD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 unit tests covering the testable pure-frontend logic in `src/app/core/main/browser/index.tsx` (rect-pixel math, `<50×50` skip rule, `chromium_show` once-only firing, non-Windows short-circuit, auto-retry state machine, error UI, manual retry button).

**Architecture:** Single vitest+RTL+jsdom test file under `src/app/core/main/browser/`. Mocks four Tauri SDK modules (`api/core`, `api/event`, `api/window`, `plugin-os`) — each is environment, not collaborator. Each test follows TDD discipline: write → run → (if passes immediately because code is already correct) mutation-check by intentionally breaking implementation, re-run to see it fail, revert; this provides the "watched the test fail" guarantee TDD requires.

**Tech Stack:** vitest 4.x (jsdom), @testing-library/react 16.x, @testing-library/jest-dom 6.x, `vi.mock()` for module mocking.

**Spec source:** Conversation 2026-06-14 — Plan + Spec proposed under `/superpowers:test-driven-development`, option A approved.

---

## File Structure

```
新增:
  src/app/core/main/browser/index.test.tsx       ← 8 tests + mock setup
```

No production code changes (this is pure test coverage gap-fill).

---

## Mock Strategy (rationale)

Module mocks via `vi.mock()` at file top:
- `@tauri-apps/api/core` → `invoke: vi.fn()` — counts IPC calls + returns Promise<undefined>
- `@tauri-apps/api/event` → `listen: vi.fn()` — captures the chromium-status callback so tests can emit manually
- `@tauri-apps/api/window` → `getCurrentWindow()` returns stub with `outerPosition()` / `scaleFactor()` / `listen()` for `tauri://move|resize|scale-change`
- `@tauri-apps/plugin-os` → `platform: vi.fn(() => 'windows')` — default; tests can override per case

Real component (`BrowserPanel`) is rendered with @testing-library/react. ResizeObserver is stubbed (jsdom doesn't ship it). Each test gets `beforeEach` to reset mocks.

---

### Task 1: Scaffolding + Mock Setup

**Files:**
- Create: `src/app/core/main/browser/index.test.tsx`

- [ ] **Step 1.1: Create the test file with imports + mocks**

Create `src/app/core/main/browser/index.test.tsx` with this content (mock skeleton, no tests yet):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { BrowserPanel } from './index'

const invokeMock = vi.fn(async () => undefined)
const platformMock = vi.fn(() => 'windows')
// 抓 chromium-status 的 callback,讓測試端可手動 emit
let statusListener: ((e: { payload: { state: string; message: string } }) => void) | null = null
const winListenStub = vi.fn(async () => () => {})

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
  winListenStub.mockClear()
  mockRect({ left: 10, top: 20, width: 800, height: 600 })
})

describe('BrowserPanel', () => {
  // 測試將在後續 task 加入
})
```

- [ ] **Step 1.2: Run the empty file to confirm tooling works**

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -10
```

Expected: `Tests  0 passed (0)` or similar — empty describe block, no failures. If vitest errors on imports/mocks, fix here before adding cases.

- [ ] **Step 1.3: LF check (no commit yet — keep scaffolding + tests 1-3 in one commit)**

```bash
file src/app/core/main/browser/index.test.tsx | grep -i CRLF || echo "LF OK"
```

---

### Task 2: Rect Math Tests (cases 1–3)

**Files:**
- Modify: `src/app/core/main/browser/index.test.tsx` (add 3 it-blocks inside the existing `describe`)
- Modify (temporarily, then revert): `src/app/core/main/browser/index.tsx` for mutation checks

- [ ] **Step 2.1: Add test case 1 — rect math**

Inside the `describe('BrowserPanel', () => { ... })` block, add:

```tsx
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
```

- [ ] **Step 2.2: Run and confirm it passes (existing code already correct)**

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -8
```

Expected: 1 pass. (If fail, fix the test mock — likely `flush()` didn't drain enough microtasks.)

- [ ] **Step 2.3: Mutation check — break the impl, see test fail, revert**

Temporarily edit `src/app/core/main/browser/index.tsx`:

```tsx
// 找這段:
const x = Math.round(pos.x + rect.left * scale)
// 改成(去掉 * scale 模擬 DPI bug):
const x = Math.round(pos.x + rect.left)
```

Run:

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -10
```

Expected: 1 FAIL with `expected 120, got 110`(因 rect.left=10, scale 沒乘進去)。

Revert the change (the edit above to back to `* scale`). Re-run:

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -8
```

Expected: 1 pass again.

- [ ] **Step 2.4: Add test case 2 — skip rect smaller than 50×50**

Inside the same describe block, after case 1:

```tsx
  it('skips rect smaller than 50x50', async () => {
    mockRect({ left: 0, top: 0, width: 49, height: 600 })
    render(<BrowserPanel />)
    await flush()
    const setRectCalls = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_set_panel_rect')
    expect(setRectCalls).toHaveLength(0)
  })
```

- [ ] **Step 2.5: Run and confirm**

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -8
```

Expected: 2 passed.

- [ ] **Step 2.6: Mutation check for case 2 — break threshold, confirm fail, revert**

In `index.tsx`, change:

```tsx
if (w < 50 || h < 50) return
// to:
if (w < 5 || h < 5) return
```

Run test. Expected case 2 FAILS (`expected 0, got 1` — 49×600 now passes the 5×5 gate).

Revert to `< 50`. Re-run: 2 passed.

- [ ] **Step 2.7: Add test case 3 — first valid rect also fires chromium_show, only once**

```tsx
  it('fires chromium_show on first valid rect, not subsequent', async () => {
    render(<BrowserPanel />)
    await flush()
    // 模擬第二次 schedule(例如 ResizeObserver 又觸發一次)
    await flush()
    const showCalls = invokeMock.mock.calls.filter((c) => c[0] === 'chromium_show')
    expect(showCalls).toHaveLength(1)
  })
```

- [ ] **Step 2.8: Run and mutation-check**

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -8
```

Expected: 3 passed.

Mutation: in `index.tsx`, remove `if (!shown && !cancelled)` guard, making it `await invoke('chromium_show')` unconditionally. Re-run → case 3 FAIL (`expected 1, got 2+`). Revert.

- [ ] **Step 2.9: LF + commit tests 1-3**

```bash
file src/app/core/main/browser/index.test.tsx | grep -i CRLF || echo "LF OK"
git status --short
git add src/app/core/main/browser/index.test.tsx
git status --short
git commit -m "test(browser): cover BrowserPanel rect math + show-once semantics

Three vitest cases:
- screen-space physical px math (outerPos + rect*scale)
- skips rect smaller than 50x50 (pre-layout zero-rect guard)
- chromium_show fires exactly once on first valid rect

Each test verified via mutation: implementation was temporarily broken
to confirm the test catches the regression, then reverted."
```

---

### Task 3: Lifecycle Tests (cases 4–5)

**Files:**
- Modify: `src/app/core/main/browser/index.test.tsx`

- [ ] **Step 3.1: Add test case 4 — non-windows: zero IPC calls**

```tsx
  it('non-windows platform: no IPC calls at all', async () => {
    platformMock.mockReturnValue('macos')
    render(<BrowserPanel />)
    await flush()
    expect(invokeMock).toHaveBeenCalledTimes(0)
  })
```

- [ ] **Step 3.2: Run**

```bash
pnpm test:run -- src/app/core/main/browser/index.test.tsx 2>&1 | tail -8
```

Expected: 4 passed.

- [ ] **Step 3.3: Mutation check for case 4**

In `index.tsx`, remove the early return:

```tsx
// 原本:
if (platform() !== 'windows') return
// 改成註解掉:
// if (platform() !== 'windows') return
```

Re-run → case 4 FAIL (invoke 被呼叫 ≥1 次). Revert.

- [ ] **Step 3.4: Add test case 5 — exited triggers exactly one auto-retry**

```tsx
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
```

- [ ] **Step 3.5: Run**

Expected: 5 passed.

- [ ] **Step 3.6: Mutation check for case 5**

In `index.tsx`, remove the `autoRetriedRef` guard so every exited retries:

```tsx
// 原本:
if (e.payload.state === 'exited' && !autoRetriedRef.current) {
  autoRetriedRef.current = true
  void invoke('chromium_show')
}
// 改成:
if (e.payload.state === 'exited') {
  void invoke('chromium_show')
}
```

Re-run → case 5 FAIL (`expected 2, got 4`). Revert.

- [ ] **Step 3.7: Commit tests 4-5**

```bash
file src/app/core/main/browser/index.test.tsx | grep -i CRLF || echo "LF OK"
git add src/app/core/main/browser/index.test.tsx
git commit -m "test(browser): cover platform gate + auto-retry once-only

Two vitest cases:
- non-windows platforms make zero IPC calls (early-return guard)
- 'exited' status triggers at most one auto-retry; further failures
  show the manual retry UI (autoRetriedRef per-mount latch)

Mutation-verified: removing the platform check or the latch causes
the respective case to fail."
```

---

### Task 4: Error UI Tests (cases 6–8)

**Files:**
- Modify: `src/app/core/main/browser/index.test.tsx`

- [ ] **Step 4.1: Add test case 6 — ready resets retry counter**

```tsx
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
```

- [ ] **Step 4.2: Run**

Expected: 6 passed.

- [ ] **Step 4.3: Mutation check for case 6**

In `index.tsx`, remove the reset:

```tsx
// 原本:
if (e.payload.state === 'ready') autoRetriedRef.current = false
// 改成: 整行刪除
```

Re-run → case 6 FAIL(第二次 exited 沒 retry,計數停在 2). Revert.

- [ ] **Step 4.4: Add test case 7 — error state shows message + retry button**

```tsx
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
```

- [ ] **Step 4.5: Run**

Expected: 7 passed.

- [ ] **Step 4.6: Mutation check for case 7**

In `index.tsx`, change the failure condition so error state never shows the retry UI:

```tsx
// 原本:
const failed = status?.state === 'error' || status?.state === 'exited'
// 改成:
const failed = false
```

Re-run → case 7 FAIL (retry 按鈕找不到). Revert.

- [ ] **Step 4.7: Add test case 8 — manual retry click invokes chromium_show + clears status**

```tsx
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
```

- [ ] **Step 4.8: Run**

Expected: 8 passed.

- [ ] **Step 4.9: Mutation check for case 8**

In `index.tsx`, change `retry` to no-op:

```tsx
// 原本:
const retry = () => {
  setStatus(null)
  void invoke('chromium_show')
}
// 改成:
const retry = () => {}
```

Re-run → case 8 FAIL. Revert.

- [ ] **Step 4.10: Commit tests 6-8**

```bash
file src/app/core/main/browser/index.test.tsx | grep -i CRLF || echo "LF OK"
git add src/app/core/main/browser/index.test.tsx
git commit -m "test(browser): cover ready/error UI + manual retry

Three vitest cases:
- 'ready' resets the auto-retry latch so a later 'exited' can retry
- 'error' state renders the message text + 重試 button
- clicking 重試 invokes chromium_show and clears the failure UI

Mutation-verified against the production code paths."
```

---

### Task 5: Final Verification

**Files:** (no edits — verification only)

- [ ] **Step 5.1: Full test suite**

```bash
pnpm test:run 2>&1 | tail -8
```

Expected: `Test Files 6 passed (6)`, `Tests 69 passed (69)`. (61 baseline + 8 new.)

- [ ] **Step 5.2: Lint**

```bash
pnpm lint 2>&1 | tail -3
```

Expected: 0 errors.

- [ ] **Step 5.3: Working tree clean**

```bash
git status --short
```

Expected: empty.

- [ ] **Step 5.4: Branch state**

```bash
git log --oneline main..HEAD | head -15
```

Expected: 13 commits ahead (10 existing + 3 new test commits). No further commit needed.

---

## Self-Review

1. **Spec coverage:** All 8 cases from the conversation spec have a numbered task step (Task 2: cases 1-3, Task 3: cases 4-5, Task 4: cases 6-8). Scaffolding (Task 1) and final verify (Task 5) bookend them.
2. **Placeholder scan:** Every code block is complete; no TBD / TODO / "similar to above" — each test body is repeated verbatim per the writing-plans rule.
3. **Type consistency:** Mock identifiers (`invokeMock`, `platformMock`, `statusListener`, `winListenStub`, `flush`, `mockRect`) are introduced in Task 1 and referenced unchanged in Tasks 2-4. The component import is `{ BrowserPanel }` (named export) matching `index.tsx`. The chromium-status payload shape `{ state: string; message: string }` is consistent with the Rust `ChromiumStatus` struct.
4. **Mutation discipline:** Every test case has an explicit mutation step proving the test would catch a regression. This is the deliberate substitute for the strict RED-before-GREEN cycle that's not natural for tests-on-existing-code.
