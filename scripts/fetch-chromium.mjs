#!/usr/bin/env node
// 下載固定版本的 ungoogled-chromium 到 src-tauri/chromium/(gitignored)。
// BSD 授權、可自由再散布 — 這是發行版能直接打包的法律前提。
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const VERSION = '149.0.7827.53-1.1'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'src-tauri', 'chromium')
const versionFile = join(destDir, '.version')

if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === VERSION
    && existsSync(join(destDir, 'chrome.exe'))) {
  console.log(`chromium ${VERSION} already present at ${destDir}`)
  process.exit(0)
}

const asset = `ungoogled-chromium_${VERSION}_windows_x64.zip`
const url = `https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/download/${VERSION}/${asset}`

rmSync(destDir, { recursive: true, force: true })
mkdirSync(destDir, { recursive: true })
const zipPath = join(destDir, asset)

console.log(`downloading ${url} ...`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`download failed: HTTP ${res.status}`)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))

console.log('extracting ...')
// Windows 10 1803+ 內建 bsdtar(tar.exe),原生支援 zip。
execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' })
rmSync(zipPath)

// zip 內容包在單一頂層資料夾 — 攤平,讓 chrome.exe 位於 src-tauri/chromium/chrome.exe。
const entries = readdirSync(destDir).filter((n) => n !== '.version')
if (!existsSync(join(destDir, 'chrome.exe')) && entries.length === 1) {
  const inner = join(destDir, entries[0])
  for (const name of readdirSync(inner)) renameSync(join(inner, name), join(destDir, name))
  rmSync(inner, { recursive: true, force: true })
}

if (!existsSync(join(destDir, 'chrome.exe'))) {
  console.error('chrome.exe not found after extraction — zip layout changed?')
  process.exit(1)
}
writeFileSync(versionFile, `${VERSION}\n`)
console.log(`chromium ${VERSION} ready at ${destDir}`)
