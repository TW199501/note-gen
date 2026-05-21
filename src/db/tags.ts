import { getDb } from "./index"
import { Store } from '@tauri-apps/plugin-store';

export interface Tag {
  id: number
  name: string
  isLocked?: boolean
  isPin?: boolean
  sortOrder?: number
  total?: number
}

// 创建 tags 表
export async function initTagsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists tags (
      id integer primary key autoincrement,
      name text not null,
      isLocked boolean DEFAULT false,
      isPin boolean DEFAULT false,
      sortOrder integer DEFAULT 0
    )
  `)
  
  // 检查 sortOrder 列是否存在，如果不存在则添加
  try {
    await db.execute("select sortOrder from tags limit 1")
  } catch {
    // sortOrder 列不存在，添加该列
    await db.execute("alter table tags add column sortOrder integer DEFAULT 0")
    
    // 为现有标签设置初始排序值
    const existingTags = await db.select<Tag[]>("select id from tags order by id asc")
    for (let i = 0; i < existingTags.length; i++) {
      await db.execute("update tags set sortOrder = $1 where id = $2", [i, existingTags[i].id])
    }
  }
  
  const hasDefaultTag = (await db.select<Tag[]>("select * from tags")).length === 0
  if (hasDefaultTag) {
    // 用 execute 的 lastInsertId 而非二次 SELECT 取回 id：
    // (1) 避免「插了立刻查回」遇到交易未提交 / SELECT 抓空導致 (undefined).id 噴錯，
    // (2) 一次 round-trip 取代兩次，啟動快 ~3ms。
    const result = await db.execute(
      "insert into tags (name, isLocked, isPin) values ($1, $2, $3)",
      ['Idea', true, true]
    )
    const tagId = result.lastInsertId as number
    if (tagId) {
      const store = await Store.load('store.json');
      await store.set('currentTagId', tagId)
      await store.save()
    }
  }
}

export async function getTags() {
  const db = await getDb();
  const tags = await db.select<Tag[]>("select * from tags order by sortOrder asc, id asc")

  // 一次查询获取所有 tag 的 marks 数量，避免 N+1
  const counts = await db.select<{ tagId: number; total: number }[]>(
    "select tagId, count(*) as total from marks where deleted = 0 group by tagId"
  )
  const countMap = new Map(counts.map(c => [c.tagId, c.total]))

  for (const tag of tags) {
    tag.total = countMap.get(tag.id) ?? 0
  }

  return tags
}

export async function insertTag(tag: Partial<Tag>) {
  const db = await getDb();
  return await db.execute(
    "insert into tags (name) values ($1)",
    [tag.name]
  )
}

export async function updateTag(tag: Tag) {
  const db = await getDb();
  return await db.execute(
    "update tags set name = $1, isLocked = $2, isPin = $3, sortOrder = $4 where id = $5",
    [tag.name, tag.isLocked, tag.isPin, tag.sortOrder, tag.id]
  )
}

export async function delTag(id: number) {
  const db = await getDb();
  return await db.execute("delete from tags where id = $1", [id])
}

export async function deleteAllTags() {
  const db = await getDb();
  return await db.execute("delete from tags where isLocked = false")
}

export async function insertTags(tags: Tag[]) {
  const db = await getDb();
  await db.execute('BEGIN TRANSACTION')
  try {
    for (const tag of tags) {
      if (tag.isLocked) continue;
      await db.execute(
        `insert into tags (id, name, isLocked, isPin, sortOrder) values ($1, $2, $3, $4, $5)
         on conflict(id) do update set name = excluded.name, isLocked = excluded.isLocked, isPin = excluded.isPin, sortOrder = excluded.sortOrder`,
        [tag.id, tag.name, tag.isLocked, tag.isPin, tag.sortOrder]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error;
  }
  return true;
}

export async function updateTagsOrder(tags: { id: number; sortOrder: number }[]) {
  if (tags.length === 0) return true;
  const db = await getDb();
  await db.execute('BEGIN TRANSACTION')
  try {
    for (const tag of tags) {
      await db.execute(
        "update tags set sortOrder = $1 where id = $2",
        [tag.sortOrder, tag.id]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error;
  }
  return true;
}