import type { SpecSnapBundle } from '@tw199501/specsnap-inspector-react'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { join, resolve } from '@tauri-apps/api/path'

export interface SaveBundleResult {
  dirPath: string
  captureId: string
}

// Tauri's `resolve(relPath)` resolves against the Rust process CWD. During
// `pnpm tauri dev`, that CWD is `src-tauri/`, not the project root — so a bare
// '.specsnap' would create captures inside src-tauri/, where the developer
// won't think to look. Going up one level lands them next to package.json,
// which matches the convention in pure-web projects (no Tauri layer).
// SpecSnap is gated by isDevMode(), so this path is never used in production.
const BASE_DIR_REL = '../.specsnap'

export async function saveSpecSnapBundle(
  bundle: SpecSnapBundle,
): Promise<SaveBundleResult> {
  const rootDir = await resolve(BASE_DIR_REL)
  const captureDir = await join(rootDir, bundle.dirName)
  await mkdir(captureDir, { recursive: true })

  await writeFile(
    await join(captureDir, bundle.markdownFilename),
    new TextEncoder().encode(bundle.markdownContent),
  )

  for (const img of bundle.images) {
    const buf = new Uint8Array(await img.blob.arrayBuffer())
    await writeFile(await join(captureDir, img.filename), buf)
  }

  return { dirPath: captureDir, captureId: bundle.captureId }
}
