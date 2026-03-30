import { getDb } from "./index"

export interface BrowserHistoryEntry {
  id: number
  title: string
  url: string
  favicon: string | null
  visitedAt: number
}

// 创建 browser_history 表
export async function initBrowserHistoryDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists browser_history (
      id integer primary key autoincrement,
      title text not null,
      url text not null,
      favicon text default null,
      visitedAt integer not null
    )
  `)

  // 性能索引
  await db.execute(`
    create index if not exists idx_browser_history_visited
    on browser_history(visitedAt desc)
  `)

  await db.execute(`
    create index if not exists idx_browser_history_url
    on browser_history(url)
  `)
}

export async function addHistoryEntry(title: string, url: string, favicon?: string) {
  const db = await getDb()
  const visitedAt = Date.now()
  return await db.execute(
    "insert into browser_history (title, url, favicon, visitedAt) values ($1, $2, $3, $4)",
    [title, url, favicon || null, visitedAt]
  )
}

export async function getHistory(limit: number = 100) {
  const db = await getDb()
  return await db.select<BrowserHistoryEntry[]>(
    "select * from browser_history order by visitedAt desc limit $1",
    [limit]
  )
}

export async function searchHistory(query: string) {
  const db = await getDb()
  const pattern = `%${query}%`
  return await db.select<BrowserHistoryEntry[]>(
    "select * from browser_history where title like $1 or url like $2 order by visitedAt desc limit 50",
    [pattern, pattern]
  )
}

export async function clearHistory() {
  const db = await getDb()
  return await db.execute("delete from browser_history")
}

export async function removeHistoryEntry(id: number) {
  const db = await getDb()
  return await db.execute("delete from browser_history where id = $1", [id])
}
