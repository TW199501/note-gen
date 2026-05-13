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

    // Attach errors to the test report so we can see what failed.
    if (errors.length > 0) {
      // Skip known noise.
      const filtered = errors.filter((e) =>
        !/Hydration|Warning|MISSING_MESSAGE|TAURI_INTERNALS|invoke/i.test(e),
      )
      console.log('=== /core/main runtime issues ===')
      console.log(errors.join('\n'))
      // Don't fail — the goal is observation, not assertion.
      expect.soft(filtered).toEqual([])
    }
  })
})
