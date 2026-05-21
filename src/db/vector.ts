import { getDb } from './index';

// 向量資料庫表結構定義
export interface VectorDocument {
  id: number;
  filename: string;   // 檔名
  chunk_id: number;   // 分塊ID
  content: string;    // 分塊內容
  embedding: string;  // 儲存為JSON字串的向量
  updated_at: number; // 時間戳
}

// 向量快取項
interface CachedVector {
  id: number;
  filename: string;
  content: string;
  embedding: number[];  // 解析後的向量
  updated_at: number;
}

// 向量快取管理
class VectorCache {
  private cache: Map<number, CachedVector> = new Map();
  private vectorsByFilename: Map<string, number[]> = new Map(); // 檔名到向量ID列表的對映
  private lastUpdate: number = 0;
  private cacheVersion: number = 0;

  // 獲取快取版本號，用於判斷快取是否過期
  getVersion(): number {
    return this.cacheVersion;
  }

  // 從快取獲取所有向量
  getAll(): CachedVector[] {
    return Array.from(this.cache.values());
  }

  // 按檔名獲取向量
  getByFilename(filename: string): CachedVector[] {
    const ids = this.vectorsByFilename.get(filename) || [];
    return ids.map(id => this.cache.get(id)).filter(Boolean) as CachedVector[];
  }

  // 更新快取
  async update() {
    const db = await getDb();
    const docs = await db.select<VectorDocument[]>(`
      select id, filename, content, embedding, updated_at from vector_documents
    `);

    // 清空舊快取
    this.cache.clear();
    this.vectorsByFilename.clear();

    // 構建新快取
    for (const doc of docs) {
      try {
        const embedding = JSON.parse(doc.embedding) as number[];
        const cached: CachedVector = {
          id: doc.id,
          filename: doc.filename,
          content: doc.content,
          embedding,
          updated_at: doc.updated_at
        };
        this.cache.set(doc.id, cached);

        // 按檔名索引
        if (!this.vectorsByFilename.has(doc.filename)) {
          this.vectorsByFilename.set(doc.filename, []);
        }
        this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      } catch (error) {
        console.error(`Failed to parse embedding for doc ${doc.id}:`, error);
      }
    }

    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  // 新增單個向量到快取
  add(doc: VectorDocument) {
    try {
      const embedding = JSON.parse(doc.embedding) as number[];
      const cached: CachedVector = {
        id: doc.id,
        filename: doc.filename,
        content: doc.content,
        embedding,
        updated_at: doc.updated_at
      };
      this.cache.set(doc.id, cached);

      if (!this.vectorsByFilename.has(doc.filename)) {
        this.vectorsByFilename.set(doc.filename, []);
      }
      this.vectorsByFilename.get(doc.filename)!.push(doc.id);
      this.cacheVersion++;
    } catch (error) {
      console.error(`Failed to add vector to cache for doc ${doc.id}:`, error);
    }
  }

  // 刪除檔案的所有向量
  deleteByFilename(filename: string) {
    const ids = this.vectorsByFilename.get(filename) || [];
    for (const id of ids) {
      this.cache.delete(id);
    }
    this.vectorsByFilename.delete(filename);
    this.cacheVersion++;
  }

  // 清空快取
  clear() {
    this.cache.clear();
    this.vectorsByFilename.clear();
    this.lastUpdate = Date.now();
    this.cacheVersion++;
  }

  // 檢查是否需要更新快取（5分鐘過期）
  needsUpdate(): boolean {
    return Date.now() - this.lastUpdate > 5 * 60 * 1000 || this.cache.size === 0;
  }
}

// 全域性向量快取例項
const vectorCache = new VectorCache();

// 初始化向量資料庫表
export async function initVectorDb() {
  const db = await getDb();
  await db.execute(`
    create table if not exists vector_documents (
      id integer primary key autoincrement,
      filename text not null,
      chunk_id integer not null,
      content text not null,
      embedding text not null,
      updated_at integer not null,
      unique(filename, chunk_id)
    )
  `);

  // 建立用於快速查詢檔案的索引
  await db.execute(`
    create index if not exists idx_vector_documents_filename
    on vector_documents(filename)
  `);

  await vectorCache.update();
}

// 插入或更新向量文件
export async function upsertVectorDocument(doc: Omit<VectorDocument, 'id'>) {
  const db = await getDb();
  await db.execute(
    "insert into vector_documents (filename, chunk_id, content, embedding, updated_at) values ($1, $2, $3, $4, $5) on conflict(filename, chunk_id) do update set content = excluded.content, embedding = excluded.embedding, updated_at = excluded.updated_at",
    [doc.filename, doc.chunk_id, doc.content, doc.embedding, doc.updated_at]);

  const inserted = await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 and chunk_id = $2",
    [doc.filename, doc.chunk_id]
  );

  if (inserted.length > 0) {
    vectorCache.add(inserted[0]);
  }
}

// 獲取指定檔名的所有向量文件
export async function getVectorDocumentsByFilename(filename: string) {
  const db = await getDb();
  return await db.select<VectorDocument[]>(
    "select * from vector_documents where filename = $1 order by chunk_id",
    [filename]);
}

// 透過檔名刪除向量文件
export async function deleteVectorDocumentsByFilename(filename: string) {
  const db = await getDb();
  await db.execute(
    "delete from vector_documents where filename = $1",
    [filename]);

  // 從快取中刪除
  vectorCache.deleteByFilename(filename);
}

// 檢查檔案是否已存在於向量資料庫中
export async function checkVectorDocumentExists(filename: string) {
  const db = await getDb();
  const result = await db.select<{ count: number }[]>(
    "select count(*) as count from vector_documents where filename = $1",
    [filename]);

  return result[0]?.count > 0;
}

// 獲取最相似的文件片段（最佳化版本：使用快取）
export async function getSimilarDocuments(
  queryEmbedding: number[],
  limit: number = 5,
  threshold: number = 0.7
): Promise<{id: number, filename: string, content: string, similarity: number}[]> {
  // 檢查是否需要更新快取
  if (vectorCache.needsUpdate()) {
    await vectorCache.update();
  }

  // 從快取獲取所有向量（已解析，避免重複 JSON.parse）
  const cachedVectors = vectorCache.getAll();

  if (!cachedVectors.length) return [];

  // 計算餘弦相似度並排序
  const allSimilarities = cachedVectors.map(doc => {
    const similarity = cosineSimilarity(queryEmbedding, doc.embedding);

    return {
      id: doc.id,
      filename: doc.filename,
      content: doc.content,
      similarity
    };
  });

  const results = allSimilarities
  .filter(doc => doc.similarity >= threshold)
  .sort((a, b) => b.similarity - a.similarity)
  .slice(0, limit);

  return results;
}

// 餘弦相似度計算
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('向量維度不匹配');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 清空向量資料庫
export async function clearVectorDb() {
  const db = await getDb();
  await db.execute(`
    delete from vector_documents
  `);

  // 直接清空快取，無需重新讀取空表
  vectorCache.clear();
}

// 獲取所有向量文件的檔名列表
export async function getAllVectorDocumentFilenames() {
  const db = await getDb();
  return await db.select<{filename: string}[]>(`
    select distinct filename from vector_documents
  `);
}

// 手動重新整理向量快取
export async function refreshVectorCache() {
  await vectorCache.update();
}
