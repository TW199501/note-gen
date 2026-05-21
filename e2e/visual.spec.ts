import { test, expect } from '@playwright/test'
import path from 'node:path'

/**
 * Visual verification tests — take screenshots of key pages so changes can be
 * eyeballed. Playwright runs against the standalone Next.js dev server so we
 * only see the Tauri-detection fallback for / and whatever /core/main renders
 * without a Tauri runtime. Real Tauri shell verification needs tauri-driver.
 */

test.describe('Visual smoke', () => {
  test('capture root URL', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    await page.screenshot({
      path: path.resolve('test-results/visual-root.png'),
      fullPage: true,
    })
    // Assert fallback message exists — this is the expected page outside Tauri.
    await expect(page.getByText(/pnpm tauri dev/i)).toBeVisible()
  })

  test('capture /core/main', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(`PAGE: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`CONSOLE: ${msg.text()}`)
    })

    await page.goto('/core/main')
    // Give it a moment to settle (page may render partially without Tauri).
    await page.waitForTimeout(2000)
    await page.screenshot({
      path: path.resolve('test-results/visual-core-main.png'),
      fullPage: true,
    })

    // Observation only — without Tauri runtime this route can't render. Real
    // assertions live in e2e/browser-ui.spec.ts which mocks Tauri first.
    if (errors.length > 0) {
      console.log('=== /core/main raw errors (expected without mock) ===')
      console.log(errors.slice(0, 5).join('\n'))
    }
  })
})
