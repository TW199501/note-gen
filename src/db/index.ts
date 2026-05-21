import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:note.db');
  }
  return _db;
}

// 初始化所有資料庫
export async function initAllDatabases() {
  // 引入各資料庫初始化函式
  const { initChatsDb } = await import('./chats');
  const { initMarksDb } = await import('./marks');
  const { initNotesDb } = await import('./notes');
  const { initTagsDb } = await import('./tags');
  const { initVectorDb } = await import('./vector');
  const { initConversationsDb } = await import('./conversations');
  const { initMemoriesDb } = await import('./memories');
  const { initActivityDb } = await import('./activity');
  const { initBookmarksDb } = await import('./bookmarks');
  const { initBrowserHistoryDb } = await import('./browser-history');
  const { initDownloadsDb } = await import('./downloads');

  // 執行初始化：先確保基礎表存在，再做 conversations 對 chats 的遷移/補列。
  await initChatsDb();
  await initConversationsDb();
  await initMarksDb();
  await initNotesDb();
  await initTagsDb();
  await initVectorDb();
  await initMemoriesDb();
  await initActivityDb();
  await initBookmarksDb();
  await initBrowserHistoryDb();
  await initDownloadsDb();
}
