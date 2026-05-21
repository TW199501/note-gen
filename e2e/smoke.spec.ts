import { test, expect } from '@playwright/test'

/**
 * Smoke tests against the standalone Next.js dev server.
 *
 * The app boots into a Tauri-detection redirect at /. Outside Tauri it shows
 * a fallback message. We assert the fallback renders to verify the build is
 * healthy: routing works, React mounts, NextIntlProvider hydrates without
 * crashing, no SSR errors leak through.
 */

test.describe('Next.js dev server smoke', () => {
  test('root URL renders without runtime error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    const response = await page.goto('/')
    expect(response?.status()).toBe(200)

    // Page contains the "run with pnpm tauri dev" fallback when not in Tauri.
    await expect(page.getByText(/pnpm tauri dev/i)).toBeVisible({ timeout: 10_000 })

    // No uncaught page errors. Console errors are tolerated for known noise
    // (next-intl missing default messages in dev, hydration mismatch from
    // theme on initial paint) — only fail on hard pageerrors.
    const hardErrors = errors.filter((e) =>
      // ignore known dev-mode noise
      !/Hydration|Warning|hot reload|MISSING_MESSAGE/i.test(e)
    )
    expect(hardErrors).toEqual([])
  })

  test('/core/main path 200s (will fall back without Tauri)', async ({ page }) => {
    const response = await page.goto('/core/main')
    // 200 because Next has the route compiled. The page may render blank or
    // show errors due to missing Tauri runtime, but the HTTP layer is fine.
    expect(response?.status()).toBe(200)
  })
})
