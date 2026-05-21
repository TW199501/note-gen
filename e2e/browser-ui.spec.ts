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
})
