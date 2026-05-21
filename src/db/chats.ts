import { getDb } from "./index"
import { insertActivityEvent } from './activity'
import { truncateActivityText } from '@/lib/activity/events'

export type Role = 'system' | 'user'
export type ChatType = 'chat' | 'note' | 'clipboard' | 'clear' | 'condensed'

export interface Chat {
  id: number
  tagId?: number // 可選，用於相容過渡期
  conversationId?: number // 關聯的會話 ID
  content?: string
  role: Role
  type: ChatType
  image?: string
  images?: string // 多張圖片，JSON字串陣列
  inserted: boolean // 是否插入到 mark 中
  createdAt: number
  ragSources?: string // RAG引用的檔名，JSON字串陣列
  ragSourceDetails?: string // RAG引用的詳細資訊，JSON字串陣列（包含檔案路徑和文字片段）
  agentHistory?: string // Agent執行歷史，JSON字串
  thinking?: string // AI 思考過程
  quoteData?: string // 引用資訊，JSON字串
  // 壓縮相關欄位
  condensedContent?: string    // 壓縮後的摘要內容（儲存在本條訊息上）
  condensedAt?: number         // 壓縮時間戳
}

// 建立 chats 表
export async function initChatsDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists chats (
      id integer primary key autoincrement,
      tagId integer not null,
      content text default null,
      role text not null,
      type text not null,
      image text default null,
      images text default null,
      inserted boolean default false,
      createdAt integer not null,
      ragSources text default null,
      agentHistory text default null,
      thinking text default null,
      quoteData text default null
    )
  `)

  // 遷移：為現有表新增 ragSources 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSources text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
    // SQLite 會丟擲 "duplicate column name" 錯誤
  }

  // 遷移：為現有表新增 agentHistory 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column agentHistory text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 images 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column images text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 thinking 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column thinking text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 quoteData 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column quoteData text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 ragSourceDetails 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column ragSourceDetails text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 condensedFrom 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedFrom text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 originalTokenCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalTokenCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 originalMessageCount 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column originalMessageCount integer default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 condensedAt 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedAt integer default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 condensedContent 列（如果不存在）
  try {
    await db.execute(`
      alter table chats add column condensedContent text default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 遷移：為現有表新增 conversationId 列（如果不存在）
  // 注意：這個遷移已移到 conversations.ts 的 initConversationsDb 中執行
  // 這裡保留是為了向後相容，如果 conversations 初始化失敗，這裡會確保列存在
  try {
    await db.execute(`
      alter table chats add column conversationId integer default null
    `)
  } catch {
    // 如果列已存在，忽略錯誤
  }

  // 效能索引
  await db.execute(`
    create index if not exists idx_chats_conversation_created
    on chats(conversationId, createdAt)
  `)
  await db.execute(`
    create index if not exists idx_chats_tag_created
    on chats(tagId, createdAt)
  `)
}

// 插入一條 chat
export async function insertChat(chat: Omit<Chat, 'id' | 'createdAt'>) {
  const db = await getDb()
  const createdAt = Date.now();
  const result = await db.execute(
    "insert into chats (tagId, conversationId, content, role, type, image, images, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.inserted ? 1 : 0, createdAt, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt]
  )

  if (chat.role === 'user' && chat.content?.trim()) {
    await insertActivityEvent({
      source: 'chat',
      title: truncateActivityText(chat.content, 64),
      description: truncateActivityText(chat.content, 140),
      tagId: chat.tagId ?? null,
      dedupeKey: result.lastInsertId ? `chat:${result.lastInsertId}` : `chat:${createdAt}`,
      createdAt,
    })
  }

  return result
}

// 獲取所有 chats
export async function getChats(tagId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where tagId = $1 order by createdAt",
    [tagId]
  )
  return result
}

// 根據會話 ID 獲取聊天記錄（新方式）
export async function getChatsByConversation(conversationId: number) {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats where conversationId = $1 order by createdAt",
    [conversationId]
  )
  return result
}

// 獲取所有 chats（用於同步）
export async function getAllChats() {
  const db = await getDb()
  const result = await db.select<Chat[]>(
    "select * from chats order by createdAt",
    []
  )
  return result
}

// 插入多條 chat（用於同步）
export async function insertChats(chats: Chat[]) {
  const db = await getDb()

  await db.execute('BEGIN TRANSACTION')
  try {
    for (const chat of chats) {
      await db.execute(
        "insert into chats (tagId, conversationId, content, role, type, image, images, inserted, createdAt, ragSources, ragSourceDetails, agentHistory, thinking, quoteData, condensedContent, condensedAt) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
        [chat.tagId, chat.conversationId ?? null, chat.content, chat.role, chat.type, chat.image, chat.images, chat.inserted ? 1 : 0, chat.createdAt, chat.ragSources, chat.ragSourceDetails ?? null, chat.agentHistory ?? null, chat.thinking ?? null, chat.quoteData ?? null, chat.condensedContent ?? null, chat.condensedAt ?? null]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    throw error
  }
}

// 刪除所有 chats（用於同步）
export async function deleteAllChats() {
  const db = await getDb()
  return await db.execute(
    "delete from chats",
    []
  )
}

// 更新一條 chat
export async function updateChat(chat: Chat) {
  const db = await getDb()
  return await db.execute(
    "update chats set tagId = $1, conversationId = $2, content = $3, role = $4, type = $5, image = $6, images = $7, inserted = $8, ragSources = $9, ragSourceDetails = $10, agentHistory = $11, thinking = $12, quoteData = $13, condensedContent = $14, condensedAt = $15 where id = $16",
    [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.inserted ? 1 : 0, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt, chat.id])
}

// 清空 tagId 下的所有 chats
export async function clearChatsByTagId(tagId: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where tagId = $1",
    [tagId])
}

// 已插入
export async function updateChatsInsertedById(id: number) {
  const db = await getDb()
  return await db.execute(
    "update chats set inserted = $1 where id = $2",
    [true, id])
}

// 刪除一條 chat
export async function deleteChat(id: number) {
  const db = await getDb()
  return await db.execute(
    "delete from chats where id = $1",
    [id])
}

export async function updateChats(chats: Chat[]) {
  if (chats.length === 0) return
  const db = await getDb()
  await db.execute('BEGIN TRANSACTION')
  try {
    for (const chat of chats) {
      await db.execute(
        "update chats set tagId = $1, conversationId = $2, content = $3, role = $4, type = $5, image = $6, images = $7, inserted = $8, ragSources = $9, ragSourceDetails = $10, agentHistory = $11, thinking = $12, quoteData = $13, condensedContent = $14, condensedAt = $15 where id = $16",
        [chat.tagId, chat.conversationId, chat.content, chat.role, chat.type, chat.image, chat.images, chat.inserted ? 1 : 0, chat.ragSources, chat.ragSourceDetails, chat.agentHistory, chat.thinking, chat.quoteData, chat.condensedContent, chat.condensedAt, chat.id]
      )
    }
    await db.execute('COMMIT')
  } catch (error) {
    await db.execute('ROLLBACK')
    console.error('Error updating chats:', error);
    throw error;
  }
}

export async function deleteChats(ids: number[]) {
  if (ids.length === 0) return
  const db = await getDb()
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  try {
    await db.execute(
      `delete from chats where id in (${placeholders})`,
      ids
    )
  } catch (error) {
    console.error('Error deleting chats:', error);
    throw error;
  }
}

/**
 * 更新訊息的壓縮摘要內容
 * @param chatId 訊息 ID
 * @param condensedContent 壓縮摘要內容
 */
export async function updateChatCondensedContent(chatId: number, condensedContent: string) {
  const db = await getDb()
  try {
    await db.execute(
      "update chats set condensedContent = $1, condensedAt = $2 where id = $3",
      [condensedContent, Date.now(), chatId]
    )
  } catch (error) {
    console.error('Error updating chat condensed content:', error);
    throw error;
  }
}
