import { getDb } from "./index"

export interface Bookmark {
  id: number
  title: string
  url: string
  favicon: string | null
  createdAt: number
}

// 创建 bookmarks 表
export async function initBookmarksDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists bookmarks (
      id integer primary key autoincrement,
      title text not null,
      url text not null,
      favicon text default null,
      createdAt integer not null
    )
  `)

  // 性能索引
  await db.execute(`
    create index if not exists idx_bookmarks_created
    on bookmarks(createdAt desc)
  `)

  await db.execute(`
    create index if not exists idx_bookmarks_url
    on bookmarks(url)
  `)
}

export async function addBookmark(title: string, url: string, favicon?: string) {
  const db = await getDb()
  const createdAt = Date.now()
  return await db.execute(
    "insert into bookmarks (title, url, favicon, createdAt) values ($1, $2, $3, $4)",
    [title, url, favicon || null, createdAt]
  )
}

export async function removeBookmark(id: number) {
  const db = await getDb()
  return await db.execute("delete from bookmarks where id = $1", [id])
}

export async function removeBookmarkByUrl(url: string) {
  const db = await getDb()
  return await db.execute("delete from bookmarks where url = $1", [url])
}

export async function getAllBookmarks() {
  const db = await getDb()
  return await db.select<Bookmark[]>("select * from bookmarks order by createdAt desc")
}

export async function isBookmarked(url: string): Promise<boolean> {
  const db = await getDb()
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from bookmarks where url = $1",
    [url]
  )
  return result[0]?.count > 0
}
