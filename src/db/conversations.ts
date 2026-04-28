import { getDb } from "./index"

export type ConversationSource = 'notes' | 'browser'

export interface Conversation {
  id: number
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
  isPinned: boolean
  source: ConversationSource
}

// 创建 conversations 表
export async function initConversationsDb() {
  const db = await getDb()
  // M0: source 欄位定義為 nullable + DEFAULT。SQLite 透過 ALTER TABLE ADD COLUMN
  // 加上 NOT NULL DEFAULT 在某些 libsql/sqlx binding 上會失敗（詳見下方 ALTER），
  // 改用 nullable + 應用層保證非空（DEFAULT 子句 + UPDATE backfill）以求 portability。
  await db.execute(`
    create table if not exists conversations (
      id integer primary key autoincrement,
      title text not null,
      createdAt integer not null,
      updatedAt integer not null,
      messageCount integer default 0,
      isPinned integer default 0,
      source text default 'notes'
    )
  `)

  // 创建索引
  await db.execute(`
    create index if not exists idx_conversations_created on conversations(createdAt desc)
  `)
  await db.execute(`
    create index if not exists idx_conversations_updated on conversations(updatedAt desc)
  `)

  // 检查并添加 conversationId 列到 chats 表
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // 如果列已存在，忽略错误
  }

  // M0: 加 source 欄位 (區分 notes / browser 模式)。
  // 不加 NOT NULL —— 部分 SQLite binding 對 ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT
  // 處理不一致，會 silently 失敗導致後續查詢 "no such column"。改成單純加欄位 +
  // DEFAULT，配合下方 UPDATE 把所有舊資料補成 'notes'。
  let sourceColumnAdded = true
  try {
    await db.execute(`
      alter table conversations add column source text default 'notes'
    `)
  } catch (err) {
    // 列已存在 -> 預期錯誤；其他錯誤 -> 還是繼續但 log 以利診斷
    const msg = (err as Error)?.message ?? String(err)
    if (!/duplicate column|already exists/i.test(msg)) {
      console.warn('[conversations] alter add source column failed (will retry backfill):', msg)
      sourceColumnAdded = false
    }
  }

  // 防呆：明確 backfill 任何 NULL / 空字串的舊資料；只在欄位確實存在時才跑（避免無欄位再炸一次）
  if (sourceColumnAdded) {
    try {
      await db.execute(`
        update conversations set source = 'notes' where source is null or source = ''
      `)
    } catch (err) {
      console.warn('[conversations] backfill source failed:', (err as Error)?.message ?? err)
    }
  }

  // M0: 加 (source, isPinned, updatedAt) 複合索引給拆分後的 list query 用
  if (sourceColumnAdded) {
    try {
      await db.execute(`
        create index if not exists idx_conversations_source_updated
          on conversations(source, isPinned desc, updatedAt desc)
      `)
    } catch (err) {
      console.warn('[conversations] create idx_conversations_source_updated failed:', (err as Error)?.message ?? err)
    }
  }

  // 迁移现有数据到默认会话
  await migrateExistingChats()
}

// 迁移现有聊天记录到默认会话
async function migrateExistingChats() {
  const db = await getDb()

  // 获取所有现有聊天记录
  const allChats = await db.select<{ createdAt: number }[]>(
    "select createdAt from chats order by createdAt",
    []
  )

  // 如果没有聊天记录，不需要迁移
  if (allChats.length === 0) {
    return
  }

  // 检查是否有聊天记录没有 conversationId
  const chatsWithoutConversation = await db.select<{ id: number }[]>(
    "select id from chats where conversationId is null limit 1",
    []
  )

  // 如果所有聊天记录都已经有 conversationId，不需要迁移
  if (chatsWithoutConversation.length === 0) {
    return
  }

  // 检查是否已经有默认会话
  const existingConversations = await db.select<Conversation[]>(
    "select * from conversations where title = '历史对话' limit 1",
    []
  )

  let defaultConversationId: number

  if (existingConversations.length === 0) {
    // 创建历史会话 (legacy 資料一律標 source='notes')
    const firstChat = allChats[0]
    const lastChat = allChats[allChats.length - 1]
    const result = await db.execute(
      "insert into conversations (title, createdAt, updatedAt, messageCount, isPinned, source) values ($1, $2, $3, $4, $5, $6)",
      ['历史对话', firstChat.createdAt, lastChat.createdAt, allChats.length, 0, 'notes']
    )
    defaultConversationId = result.lastInsertId as number

    // 更新所有现有聊天记录的 conversationId
    await db.execute(
      "update chats set conversationId = $1 where conversationId is null",
      [defaultConversationId]
    )
  } else {
    defaultConversationId = existingConversations[0].id
    // 更新所有没有 conversationId 的聊天记录
    await db.execute(
      "update chats set conversationId = $1 where conversationId is null",
      [defaultConversationId]
    )
  }
}

// 创建新会话
export async function createConversation(title: string, source: ConversationSource): Promise<number> {
  const db = await getDb()
  const now = Date.now()
  const result = await db.execute(
    "insert into conversations (title, createdAt, updatedAt, messageCount, isPinned, source) values ($1, $2, $3, $4, $5, $6)",
    [title, now, now, 0, 0, source]
  )
  return result.lastInsertId as number
}

// 获取所有会话 — 必須帶 source 參數，依模式區分
export async function getAllConversations(source: ConversationSource): Promise<Conversation[]> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    "select * from conversations where source = $1 order by isPinned desc, updatedAt desc",
    [source]
  )
  return result
}

// 获取单个会话
export async function getConversation(id: number): Promise<Conversation | null> {
  const db = await getDb()
  const result = await db.select<Conversation[]>(
    "select * from conversations where id = $1",
    [id]
  )
  return result[0] || null
}

// 更新会话标题
export async function updateConversationTitle(id: number, title: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    "update conversations set title = $1, updatedAt = $2 where id = $3",
    [title, Date.now(), id]
  )
}

// 更新会话消息数量
export async function updateConversationMessageCount(id: number, delta: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    "update conversations set messageCount = messageCount + $1, updatedAt = $2 where id = $3",
    [delta, Date.now(), id]
  )
}

// 更新会话的最后更新时间
export async function updateConversationTime(id: number): Promise<void> {
  const db = await getDb()
  await db.execute(
    "update conversations set updatedAt = $1 where id = $2",
    [Date.now(), id]
  )
}

// 删除会话及其相关聊天记录
export async function deleteConversation(id: number): Promise<void> {
  const db = await getDb()
  // 先删除会话的所有聊天记录
  await db.execute(
    "delete from chats where conversationId = $1",
    [id]
  )
  // 再删除会话
  await db.execute(
    "delete from conversations where id = $1",
    [id]
  )
}

// 切换会话置顶状态
export async function toggleConversationPin(id: number): Promise<boolean> {
  const db = await getDb()
  const conv = await getConversation(id)
  if (!conv) return false

  const newPinState = conv.isPinned ? 0 : 1
  await db.execute(
    "update conversations set isPinned = $1 where id = $2",
    [newPinState, id]
  )
  return !conv.isPinned
}

// 同步会话的消息数量（从实际消息重新统计）
export async function syncConversationMessageCount(conversationId: number): Promise<void> {
  const db = await getDb()
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from chats where conversationId = $1",
    [conversationId]
  )
  const actualCount = result[0]?.count || 0

  await db.execute(
    "update conversations set messageCount = $1 where id = $2",
    [actualCount, conversationId]
  )
}
