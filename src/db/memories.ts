import { getDb } from './index'
import { fetchEmbedding } from '@/lib/ai/embedding'

export type MemoryCategory = 'preference' | 'memory'

export interface Memory {
  id: string
  content: string
  embedding: string // JSON string of vector
  category: MemoryCategory
  replacedId?: string
  accessCount: number
  lastAccessedAt: number
  createdAt: number
  updatedAt: number
}

// 偏好類記憶的關鍵詞
const PREFERENCE_KEYWORDS = [
  '中文', '英文', '清單體', '段落', '簡潔', '詳細', 'TL;DR',
  '格式', '風格', '語言', '回答', '輸出', '回覆'
]

/**
 * 自動分類記憶
 */
function categorizeMemory(content: string): MemoryCategory {
  const lowerContent = content.toLowerCase()
  const hasPreferenceKeyword = PREFERENCE_KEYWORDS.some(keyword =>
    lowerContent.includes(keyword.toLowerCase())
  )
  return hasPreferenceKeyword ? 'preference' : 'memory'
}

/**
 * 計算餘弦相似度
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) return 0

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 生成 UUID
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 記憶向量快取（避免每次操作都讀全表 + JSON.parse）
interface CachedMemoryVector {
  id: string
  category: MemoryCategory
  embedding: number[]
}

class MemoryVectorCache {
  private cache: Map<string, CachedMemoryVector> = new Map()
  private dirty = true

  async ensureLoaded() {
    if (!this.dirty) return
    const db = await getDb()
    const rows = await db.select<{ id: string; category: MemoryCategory; embedding: string }[]>(
      "select id, category, embedding from memories where embedding is not null"
    )
    this.cache.clear()
    for (const row of rows) {
      try {
        this.cache.set(row.id, {
          id: row.id,
          category: row.category,
          embedding: JSON.parse(row.embedding),
        })
      } catch { /* skip malformed */ }
    }
    this.dirty = false
  }

  getAll(): CachedMemoryVector[] {
    return Array.from(this.cache.values())
  }

  set(id: string, category: MemoryCategory, embedding: number[]) {
    this.cache.set(id, { id, category, embedding })
  }

  delete(id: string) {
    this.cache.delete(id)
  }

  invalidate() {
    this.dirty = true
    this.cache.clear()
  }
}

const memoryVectorCache = new MemoryVectorCache()

/**
 * 初始化記憶表
 */
export async function initMemoriesDb() {
  const db = await getDb()
  await db.execute(`
    create table if not exists memories (
      id text primary key,
      content text not null,
      embedding text,
      category text not null check(category IN ('preference', 'memory')),
      replaced_id text,
      access_count integer default 0,
      last_accessed_at integer,
      created_at integer not null,
      updated_at integer not null
    )
  `)

  // 建立索引
  await db.execute(`
    create index if not exists idx_memories_category on memories(category)
  `)

  await db.execute(`
    create index if not exists idx_memories_access_count on memories(access_count)
  `)
}

/**
 * 插入或更新記憶（帶去重功能）
 */
export async function upsertMemory(
  memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'accessCount' | 'lastAccessedAt' | 'category'> & { category?: MemoryCategory }
): Promise<{ id: string; replaced: boolean; replacedId?: string }> {
  const db = await getDb()

  // 自動分類（如果未指定）
  const category = memory.category || categorizeMemory(memory.content)

  // 計算向量嵌入
  let embedding: number[] | null = null
  if (memory.embedding) {
    try {
      embedding = JSON.parse(memory.embedding) as number[]
    } catch {
      // 如果解析失敗，重新計算
    }
  }

  if (!embedding) {
    embedding = await fetchEmbedding(memory.content)
  }

  if (!embedding) {
    throw new Error('無法計算向量嵌入，請檢查嵌入模型配置')
  }

  const embeddingStr = JSON.stringify(embedding)

  // 檢查是否存在相似記憶（去重）— 使用快取避免全表讀取 + 重複 JSON.parse
  await memoryVectorCache.ensureLoaded()
  const cachedVectors = memoryVectorCache.getAll()
  const SIMILARITY_THRESHOLD = 0.85

  let similarMemoryId: string | null = null
  let maxSimilarity = 0

  for (const cached of cachedVectors) {
    if (cached.category !== category) continue

    const similarity = cosineSimilarity(embedding, cached.embedding)
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      similarMemoryId = cached.id
    }
  }

  const now = Date.now()
  let replaced = false
  let replacedId: string | undefined
  let newId: string

  if (similarMemoryId && maxSimilarity >= SIMILARITY_THRESHOLD) {
    newId = similarMemoryId
    replacedId = similarMemoryId
    replaced = true

    await db.execute(
      `update memories set content = $1, embedding = $2, category = $3,
       replaced_id = $4, updated_at = $5 where id = $6`,
      [memory.content, embeddingStr, category, similarMemoryId, now, newId]
    )
  } else {
    newId = generateUUID()

    await db.execute(
      `insert into memories (id, content, embedding, category, replaced_id,
       access_count, last_accessed_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [newId, memory.content, embeddingStr, category, null, 0, now, now, now]
    )
  }

  // 同步更新快取
  memoryVectorCache.set(newId, category, embedding)

  return { id: newId, replaced, replacedId }
}

/**
 * 獲取所有記憶
 */
export async function getAllMemories(): Promise<Memory[]> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories order by updated_at desc`
  )
  return result
}

/**
 * 根據類別獲取記憶
 */
export async function getMemoriesByCategory(category: MemoryCategory): Promise<Memory[]> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories where category = $1 order by updated_at desc`,
    [category]
  )
  return result
}

/**
 * 獲取相似記憶（用於去重）— 使用快取做向量匹配，僅對命中的 ID 讀取完整記錄
 */
export async function getSimilarMemories(
  embedding: number[],
  threshold: number = 0.85
): Promise<Array<{ memory: Memory; similarity: number }>> {
  await memoryVectorCache.ensureLoaded()
  const cachedVectors = memoryVectorCache.getAll()

  const hits: Array<{ id: string; similarity: number }> = []

  for (const cached of cachedVectors) {
    const similarity = cosineSimilarity(embedding, cached.embedding)
    if (similarity >= threshold) {
      hits.push({ id: cached.id, similarity })
    }
  }

  hits.sort((a, b) => b.similarity - a.similarity)

  if (hits.length === 0) return []

  const db = await getDb()
  const results: Array<{ memory: Memory; similarity: number }> = []

  for (const hit of hits) {
    const rows = await db.select<Memory[]>(
      `select id, content, embedding, category, replaced_id as replacedId,
         access_count as accessCount, last_accessed_at as lastAccessedAt,
         created_at as createdAt, updated_at as updatedAt
         from memories where id = $1`,
      [hit.id]
    )
    if (rows[0]) {
      results.push({ memory: rows[0], similarity: hit.similarity })
    }
  }

  return results
}

/**
 * 根據 ID 獲取記憶
 */
export async function getMemoryById(id: string): Promise<Memory | null> {
  const db = await getDb()
  const result = await db.select<Memory[]>(
    `select id, content, embedding, category, replaced_id as replacedId,
       access_count as accessCount, last_accessed_at as lastAccessedAt,
       created_at as createdAt, updated_at as updatedAt
       from memories where id = $1`,
    [id]
  )
  return result[0] || null
}

/**
 * 更新記憶訪問統計
 */
export async function updateMemoryAccess(id: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    "update memories set access_count = access_count + 1, last_accessed_at = $1 where id = $2",
    [Date.now(), id]
  )
}

/**
 * 更新記憶內容
 */
export async function updateMemory(
  id: string,
  updates: Partial<Pick<Memory, 'content' | 'category' | 'embedding'>>
): Promise<void> {
  const db = await getDb()

  // 如果更新內容，需要重新計算嵌入和分類
  let newEmbedding = updates.embedding
  let newCategory = updates.category

  if (updates.content && !updates.embedding) {
    newEmbedding = JSON.stringify(await fetchEmbedding(updates.content) || [])
  }

  if (updates.content && !updates.category) {
    newCategory = categorizeMemory(updates.content)
  }

  await db.execute(
    `update memories set
     content = coalesce($1, content),
     embedding = coalesce($2, embedding),
     category = coalesce($3, category),
     updated_at = $4
     where id = $5`,
    [updates.content, newEmbedding, newCategory, Date.now(), id]
  )
}

/**
 * 刪除記憶
 */
export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb()
  await db.execute(
    "delete from memories where id = $1",
    [id]
  )
  memoryVectorCache.delete(id)
}

/**
 * 清空所有記憶
 */
export async function clearAllMemories(): Promise<void> {
  const db = await getDb()
  await db.execute(
    "delete from memories"
  )
  memoryVectorCache.invalidate()
}

/**
 * 獲取記憶統計資訊 — 直接用 SQL 聚合，不讀全表
 */
export async function getMemoryStats(): Promise<{
  total: number
  preferences: number
  memories: number
  totalAccessCount: number
}> {
  const db = await getDb()
  const rows = await db.select<{ category: string; cnt: number; acc: number }[]>(
    "select category, count(*) as cnt, coalesce(sum(access_count), 0) as acc from memories group by category"
  )

  let total = 0, preferences = 0, memories = 0, totalAccessCount = 0
  for (const row of rows) {
    total += row.cnt
    totalAccessCount += row.acc
    if (row.category === 'preference') preferences = row.cnt
    else if (row.category === 'memory') memories = row.cnt
  }

  return { total, preferences, memories, totalAccessCount }
}
