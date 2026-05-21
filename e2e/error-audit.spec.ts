import { test } from '@playwright/test'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { installTauriMock } from './tauri-mock'

/**
 * Capture every console error + page error and write them to a file so we
 * can categorize "mock too thin" vs "real app bug".
 */
test('audit /core/main runtime errors', async ({ page }) => {
  await installTauriMock(page)

  const entries: Array<{ kind: string; text: string; stack?: string }> = []

  page.on('pageerror', (err) => {
    entries.push({ kind: 'pageerror', text: err.message, stack: err.stack })
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      entries.push({ kind: 'console.error', text: msg.text() })
    } else if (msg.type() === 'warning') {
      entries.push({ kind: 'console.warn', text: msg.text() })
    }
  })

  await page.goto('/core/main')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3000)

  // Also exercise switching to browser mode by clicking the Globe button in
  // the title bar — this is where the 1 remaining "issue" shows up in the
  // browser-panel screenshot run.
  const globeBtn = page.locator('button:has(svg.lucide-globe)').first()
  if (await globeBtn.count()) {
    await globeBtn.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1500)
  }

  // Write a deduped, grouped summary so it's readable.
  const grouped = new Map<string, { kind: string; text: string; count: number }>()
  for (const e of entries) {
    const key = `${e.kind}::${e.text.slice(0, 200)}`
    const prev = grouped.get(key)
    if (prev) prev.count++
    else grouped.set(key, { kind: e.kind, text: e.text, count: 1 })
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => b.count - a.count)
  const lines: string[] = [`# Runtime errors in /core/main (Tauri-mocked)`, '']
  lines.push(`Total raw entries: ${entries.length}`)
  lines.push(`Unique messages: ${sorted.length}`)
  lines.push('')
  for (const g of sorted) {
    lines.push(`## [×${g.count}] ${g.kind}`)
    lines.push('```')
    lines.push(g.text)
    lines.push('```')
    lines.push('')
  }

  writeFileSync(path.resolve('test-results/error-audit.md'), lines.join('\n'))
  console.log(`\n=== Wrote test-results/error-audit.md (${sorted.length} unique / ${entries.length} total) ===`)
})
