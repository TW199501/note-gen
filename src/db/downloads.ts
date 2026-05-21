import { getDb } from './index'

export type DownloadStatus = 'started' | 'finished' | 'failed'

export interface DownloadEntry {
  id: number
  url: string
  filename: string
  path: string | null
  status: DownloadStatus
  startedAt: number
  finishedAt: number | null
}

// R2: track WebView-initiated downloads. WebView's native download path writes
// the file; we mirror metadata here so the user can see history + click to
// reveal in Finder/Explorer.
export async function initDownloadsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists downloads (
      id integer primary key autoincrement,
      url text not null,
      filename text not null,
      path text default null,
      status text not null default 'started',
      startedAt integer not null,
      finishedAt integer default null
    )
  `)
  await db.execute(`
    create index if not exists idx_downloads_started
    on downloads(startedAt desc)
  `)
  await db.execute(`
    create index if not exists idx_downloads_status
    on downloads(status)
  `)
}

export async function insertDownloadStarted(
  url: string,
  filename: string,
  destination: string,
): Promise<number> {
  const db = await getDb()
  const startedAt = Date.now()
  const result = await db.execute(
    'insert into downloads (url, filename, path, status, startedAt) values ($1, $2, $3, $4, $5)',
    [url, filename, destination, 'started', startedAt],
  )
  return result.lastInsertId as number
}

export async function markDownloadFinished(
  url: string,
  path: string | null,
  success: boolean,
): Promise<void> {
  const db = await getDb()
  const finishedAt = Date.now()
  const status: DownloadStatus = success ? 'finished' : 'failed'
  // Match the latest started row by URL — webview can't give us a stable
  // request id, so this is the best-effort correlation. Multiple parallel
  // downloads of the same URL would collide, but that's extremely rare.
  await db.execute(
    `update downloads
     set status = $1, finishedAt = $2, path = coalesce($3, path)
     where id = (
       select id from downloads
       where url = $4 and status = 'started'
       order by startedAt desc limit 1
     )`,
    [status, finishedAt, path, url],
  )
}

export async function getDownloads(limit = 100): Promise<DownloadEntry[]> {
  const db = await getDb()
  return await db.select<DownloadEntry[]>(
    'select * from downloads order by startedAt desc limit $1',
    [limit],
  )
}

export async function getInProgressDownloadCount(): Promise<number> {
  const db = await getDb()
  const rows = await db.select<{ count: number }[]>(
    "select count(*) as count from downloads where status = 'started'",
    [],
  )
  return rows[0]?.count ?? 0
}

export async function clearDownloads(): Promise<void> {
  const db = await getDb()
  await db.execute('delete from downloads', [])
}

export async function removeDownload(id: number): Promise<void> {
  const db = await getDb()
  await db.execute('delete from downloads where id = $1', [id])
}
