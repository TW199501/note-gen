import type { SpecSnapBundle } from '@tw199501/specsnap-inspector-react'
import { mkdir, writeFile } from '@tauri-apps/plugin-fs'
import { join, resolve } from '@tauri-apps/api/path'

export interface SaveBundleResult {
  dirPath: string
  captureId: string
}

const BASE_DIR_REL = '.specsnap'

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
