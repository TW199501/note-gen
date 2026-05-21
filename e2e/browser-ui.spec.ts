import { test, expect } from '@playwright/test'
import path from 'node:path'
import { installTauriMock } from './tauri-mock'

/**
 * Visual verification of the real browser-panel UI by stubbing the Tauri
 * runtime so the page can boot in the standalone Next.js dev server.
 * The stub returns canned values for every invoke() — UI renders, but
 * none of the actual Rust logic runs. Good enough to confirm components
 * mount, layout looks right, and no JS errors fire.
 */

test.describe('Browser panel UI (Tauri mocked)', () => {
  test.beforeEach(async ({ page }) => {
    await installTauriMock(page)
  })

  test('boot /core/main without uncaught errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(`PAGE: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`)
    })

    await page.goto('/core/main')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    await page.screenshot({
      path: path.resolve('test-results/ui-core-main.png'),
      fullPage: true,
    })

    // Allow known-noisy errors (intl missing keys, hydration mismatches, mock
    // command "not implemented" warnings). Hard fail only on totally unrelated
    // ReferenceError / TypeError.
    const hard = errors.filter((e) =>
      !/Hydration|Warning|MISSING_MESSAGE|hot reload|transformCallback|Browser not created|preview only|invoke key/i.test(e)
    )
    console.log('--- /core/main errors ---')
    console.log(errors.join('\n') || '(none)')
    // Soft assertion — collect but don't necessarily fail.
    expect.soft(hard.slice(0, 3)).toEqual([])
  })

  test('switch into browser workspace and screenshot panel', async ({ page }) => {
    await page.goto('/core/main')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Find the Globe icon inside title-bar mode toggle. Tailwind/lucide
    // emits class "lucide-globe" on the SVG. The button is icon-sized.
    const globeBtn = page.locator('button:has(svg.lucide-globe)').first()
    const count = await globeBtn.count()
    if (count > 0) {
      await globeBtn.scrollIntoViewIfNeeded()
      await globeBtn.click({ force: true })
      await page.waitForTimeout(1500)
    } else {
      // Dump HTML so we can debug what's actually rendered.
      const buttons = await page.locator('button').evaluateAll((els) =>
        els.slice(0, 30).map((b) => ({
          html: b.outerHTML.slice(0, 200),
          ariaLabel: b.getAttribute('aria-label'),
        }))
      )
      console.log('--- first 30 buttons ---')
      console.log(JSON.stringify(buttons, null, 2))
    }

    await page.screenshot({
      path: path.resolve('test-results/ui-browser-panel.png'),
      fullPage: true,
    })
  })

  // Regression: title-bar should host the tab strip in browser mode, and
  // page-content actions (extract text, screenshot) should live on the
  // nav-bar row below — NOT in the title bar. This was the layout the user
  // explicitly asked for ("跟一般瀏覽器一樣"); if someone later moves icons
  // back into BrowserToolbar this test catches it.
  test('browser mode: title-bar hosts tabs, nav-bar hosts extract/screenshot', async ({ page }) => {
    await page.goto('/core/main')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const globeBtn = page.locator('button:has(svg.lucide-globe)').first()
    await globeBtn.scrollIntoViewIfNeeded()
    await globeBtn.click({ force: true })
    await page.waitForTimeout(1500)

    // Locate the fixed 36px title bar. Selecting by the combination of
    // tailwind utility classes that title-bar.tsx emits — `fixed top-0`
    // is unique to this element on the page.
    const titleBar = page.locator('div.fixed.top-0').first()
    await expect(titleBar).toBeVisible()

    // Mock seeds two tabs via browser_tabs_list; TabStrip should render
    // both inside the title bar.
    const tabsInTitleBar = titleBar.locator('[role="tab"]')
    await expect(tabsInTitleBar).toHaveCount(2)

    // "+" new-tab button must also live inside the title bar.
    const plusInTitleBar = titleBar.locator('button:has(svg.lucide-plus)')
    await expect(plusInTitleBar.first()).toBeVisible()

    // Page-content actions must NOT be in the title bar.
    const extractInTitleBar = titleBar.locator('button:has(svg.lucide-file-text)')
    await expect(extractInTitleBar).toHaveCount(0)
    const cameraInTitleBar = titleBar.locator('button:has(svg.lucide-camera)')
    await expect(cameraInTitleBar).toHaveCount(0)

    // …but they MUST be present somewhere on the page (in the nav bar).
    await expect(page.locator('button:has(svg.lucide-file-text)').first()).toBeVisible()
    await expect(page.locator('button:has(svg.lucide-camera)').first()).toBeVisible()
  })

  // Regression: URL bar must mirror the currently-active tab's URL.
  //
  // The bug: TabStrip moved into the title bar and tab switches happened
  // through browser-tabs-changed events, but the URL input was bound to
  // a separate global `browserUrl` state that ONLY updated on
  // `browser-url-changed` (page-load Finished). Switching tabs in Rust
  // changed activeTabId but left the URL bar stuck on the previous tab's
  // address — visible as e.g. tab labelled "Google" while URL input still
  // shows "https://tw.yahoo.com/". Fix mirrors active tab's url/title/
  // favicon into the shared store inside applyTabsChanged.
  //
  // The mock's browser_tabs_list returns mock-tab-1 (example.com) as active.
  // After the sync fix runs, the URL bar should show example.com — not the
  // initial store default 'https://www.google.com'.
  test('browser mode: URL bar mirrors the active tab URL (no desync)', async ({ page }) => {
    await page.goto('/core/main')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    const globeBtn = page.locator('button:has(svg.lucide-globe)').first()
    await globeBtn.scrollIntoViewIfNeeded()
    await globeBtn.click({ force: true })
    // Give the TabStrip useEffect time to hydrate from browser_tabs_list and
    // applyTabsChanged to fire.
    await page.waitForTimeout(2000)

    // Scan every input on the page for one whose value looks like an http(s)
    // URL — that's the URL bar. The chat input, search inputs, etc don't
    // hold URLs, so this selector is robust without depending on i18n
    // placeholder strings.
    const urlBarValue = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
      for (const inp of inputs) {
        const v = (inp as HTMLInputElement).value
        if (v && /^https?:\/\//.test(v)) return v
      }
      return null
    })

    expect(urlBarValue, 'no URL bar found with an http(s) value').not.toBeNull()
    expect(urlBarValue).toContain('example.com')
    expect(urlBarValue).not.toContain('google.com')
  })

  // Regression: the StrictMode double-init / duplicate-tab bug.
  //
  // Old code in browser-webview.tsx called `browser_tabs_new` from the
  // useEffect right after `browser_create`, to seed the first tab. Under
  // React 18 StrictMode the effect fires twice → two browser_tabs_new
  // calls → two tabs + two WebViews racing the same homepage → Google
  // reCAPTCHA. The fix moved seeding into Rust's browser_create (atomic,
  // mutex-guarded) and removed the frontend seed call.
  //
  // This test guards both ends: the auto-mount flow must NOT call
  // browser_tabs_new, AND the useRef lock must prevent browser_create
  // from firing more than once even if React tries.
  test('browser mode: init does not auto-call browser_tabs_new (Rust seeds atomically)', async ({ page }) => {
    await page.goto('/core/main')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Clear the call log BEFORE switching to browser mode so we only
    // measure invokes triggered by mode entry, not earlier app boot.
    await page.evaluate(() => {
      ;(window as any).__mockInvokeCalls = []
    })

    const globeBtn = page.locator('button:has(svg.lucide-globe)').first()
    await globeBtn.scrollIntoViewIfNeeded()
    await globeBtn.click({ force: true })
    // Give React a generous window — StrictMode double-mount would happen
    // very early but we wait long enough that any delayed effects also run.
    await page.waitForTimeout(2500)

    const calls = await page.evaluate(() => {
      const log = (window as any).__mockInvokeCalls as Array<{ cmd: string }>
      return {
        tabsNewCount: log.filter((c) => c.cmd === 'browser_tabs_new').length,
        createCount: log.filter((c) => c.cmd === 'browser_create').length,
      }
    })

    // The whole point of moving seed into Rust: frontend init must not
    // touch browser_tabs_new. Only an explicit user "+" click should.
    expect(calls.tabsNewCount).toBe(0)
    // useRef lock must collapse StrictMode's double-effect into a single
    // browser_create call.
    expect(calls.createCount).toBeLessThanOrEqual(1)
  })
})
