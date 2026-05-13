import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright e2e for NoteGen's Next.js frontend.
 *
 * IMPORTANT: This config runs Playwright against the standalone Next.js dev
 * server (pnpm dev on :31415), NOT inside the Tauri shell. The pages have
 * Tauri runtime guards (checkIsTauri) so the root URL returns a fallback
 * message instead of redirecting into the desktop UI. We use this for build
 * health smoke tests and any UI logic that does not depend on invoke().
 *
 * Real Tauri e2e (testing back/forward state, Cmd+F find, zoom, devtools)
 * requires `tauri-driver` and is tracked separately.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:31415',
    trace: 'on',
    // Always record video so failures + visual review can be replayed.
    video: 'on',
    // Save screenshots on every test (overwritten each run).
    screenshot: 'only-on-failure',
    // Headed mode by default so you can see what the test is doing.
    // Override via PLAYWRIGHT_HEADLESS=1 for CI or background runs.
    headless: process.env.PLAYWRIGHT_HEADLESS === '1',
    launchOptions: {
      slowMo: process.env.PLAYWRIGHT_HEADLESS === '1' ? 0 : 250,
    },
    viewport: { width: 1360, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:31415',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
