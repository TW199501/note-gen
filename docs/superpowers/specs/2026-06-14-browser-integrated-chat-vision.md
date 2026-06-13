# v2: Browser-Integrated Chat Sidepanel — Design Vision

**Status:** Vision document. NOT a plan. Next session's brainstorm starts here.
**Captured:** 2026-06-14, after v1 (bundled-Chromium child process) shipped.
**Supersedes:** the "side-by-side panel" mental model that v1 implicitly assumed.

## Why v1's layout has a fundamental ceiling

v1 bundles `chrome.exe` as a child process and uses Win32 owner-overlay (`GWLP_HWNDPARENT`) to glue Chromium on top of a NoteGen WebView2 panel. This delivers a real Chromium UI in NoteGen's workspace — but the two halves are **physically separate processes with no shared renderer**:

- Chromium has its own V8 / DOM / event loop / clipboard / context menu.
- NoteGen's React (chat sidebar, notebook UI) lives in WebView2, a different process.
- The two windows can sit visually adjacent, but **selection, drag-drop, and any DOM interaction cannot cross the boundary**. Topmost overlay means Chromium always paints above WebView2 sibling regions.

User-observed consequence: "browser and the right-side chat are decoupled" — true integration is impossible at this layer.

## v2's reframe: chat lives inside Chromium, not beside it

Stop trying to glue NoteGen's React to Chromium. Instead:

- **Mode 1 (notebook):** NoteGen WebView2 main UI as today — notes list / editor / chat sidebar. Chromium hidden.
- **Mode 2 (browser + AI):** Chromium occupies the workspace. A **Chrome extension** provides a sidepanel inside Chromium itself. The sidepanel hosts an iframe pointing back to NoteGen's local HTTP server, which serves the same chat/marks UI that Mode 1 uses. Result: visual "left page, right AI" — but achieved by Chromium splitting its own viewport, not by gluing two processes.

## The three diagrams (preserved verbatim from the brainstorm)

### 1. User-visible state machine

```
┌─────────────────────────────────────────────────────────────┐
│  Mode 1: 純筆記                                              │
│  ─────────────────────────────────────────────────────────  │
│  ┌──────────┬──────────────────────────┬──────────────────┐│
│  │ 筆記列表  │  編輯器                   │  Chat sidebar    ││
│  │          │                          │  (與 AI 對話)    ││
│  │ • 工作   │  # 我的筆記              │                  ││
│  │ • 學習   │  正在潤色的文字…           │                  ││
│  │ • inbox  │                          │                  ││
│  └──────────┴──────────────────────────┴──────────────────┘│
└─────────────────────────────────────────────────────────────┘
                          │   ▲
        按瀏覽器按鈕       │   │  切回筆記按鈕
        chromium_show()    │   │  chromium_hide()
                          ▼   │
┌─────────────────────────────────────────────────────────────┐
│  Mode 2: 瀏覽器 + AI(整個畫面 = Chromium child process)     │
│  ─────────────────────────────────────────────────────────  │
│  [← →  ⟳   https://example.com   ⋮ ]   ← 原生 Chrome UI    │
│  ┌─────────────────────────┬────────────────────────────┐  │
│  │                         │ Sidepanel(extension)       │  │
│  │   真實網頁渲染           │  ┌───────────────────────┐ │  │
│  │   (Chromium 引擎)        │  │ iframe →              │ │  │
│  │                         │  │ localhost:31416       │ │  │
│  │   選文字 / scroll        │  │   /sidepanel          │ │  │
│  │     ↓                   │  │                       │ │  │
│  │   content script        │  │ Compose-only:         │ │  │
│  │   把 selection / URL    │  │ [輸入框]               │ │  │
│  │   推給 sidepanel        │  │ [save mark 按鈕]       │ │  │
│  │                         │  │                       │ │  │
│  │                         │  │ 沒有 marks 列表        │ │  │
│  │                         │  │ 沒有 draft 持久化      │ │  │
│  │                         │  └───────────────────────┘ │  │
│  └─────────────────────────┴────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
       (使用者可一直停在 Mode 2,save 不會強制把人拉回 Mode 1)
```

### 2. Process / Win32 boundary architecture

```
╔═══════════════ Chromium child process(chrome.exe)═════════════════╗
║                                                                     ║
║  Tab 1  Tab 2  +                                                    ║
║  ┌────────────────────────────────┬───────────────────────────────┐ ║
║  │                                │  Side Panel(extension UI)    │ ║
║  │                                │  ┌─────────────────────────┐ │ ║
║  │  Web page                      │  │ <iframe                  │ │ ║
║  │  (真實 Chromium 渲染)           │  │   src="http://localhost  │ │ ║
║  │                                │  │        :31416/sidepanel" │ │ ║
║  │  ↓ Chrome extension            │  │   />                     │ │ ║
║  │  content script                │  │                          │ │ ║
║  │  抓 selection / URL / title    │  │  iframe 內容 = NoteGen   │ │ ║
║  │                                │  │  既有的 chat/mark 元件    │ │ ║
║  │  ─── postMessage ───→          │  └─────────────────────────┘ │ ║
║  │                                │      ▲                       │ ║
║  └────────────────────────────────┴──────┼───────────────────────┘ ║
║                                          │ HTTP / fetch            ║
║                                          │ (iframe 與 server 同     ║
║                                          │  origin localhost,無    ║
║                                          │  CORS 問題)              ║
╚══════════════════════════════════════════╪══════════════════════════╝
                                           │
                                           ▼
╔══════════════ NoteGen(Tauri main process,tauri.exe)══════════════╗
║                                                                     ║
║  Rust 後端                                                          ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │ axum HTTP server :31416(新加)                                │  ║
║  │   ├─ GET /sidepanel    → 服 sidepanel 用的 chat/mark HTML/JS  │  ║
║  │   └─ POST /api/marks   → 寫 mark + page context 進 SQLite     │  ║
║  │                                                              │  ║
║  │   既有 AI provider routing / chat.ts / description.ts         │  ║
║  │   既有 marks → article 整理(organize-notes.tsx,506 行)      │  ║
║  │   browser_chromium.rs(v1 已落地)                             │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                     ║
║  ┌──────────────────────────────────────────────────────────────┐  ║
║  │  Tauri WebView2 主畫面(Mode 1)                               │  ║
║  │  - 筆記列表 / 編輯器 / chat sidebar                            │  ║
║  │  - 與 sidepanel iframe 讀寫**同一個 SQLite**                   │  ║
║  └──────────────────────────────────────────────────────────────┘  ║
║                                                                     ║
║  SQLite(notes / marks / chats / tags / 既有 schema 加 3 欄)        ║
║  新欄位(marks 表):                                                ║
║     source_url       TEXT NULL                                      ║
║     source_title     TEXT NULL                                      ║
║     source_selection TEXT NULL                                      ║
╚═════════════════════════════════════════════════════════════════════╝
```

### 3. Save / persistence flow

```
使用者在 Mode 2 sidepanel 寫 mark,按 [save]
       │
       │ POST http://localhost:31416/api/marks
       │  body: {
       │    content: "...",
       │    source_url: "https://...",
       │    source_title: "...",
       │    source_selection: "..."
       │  }
       ▼
┌─────────────────────────────────┐
│  NoteGen Rust 後端              │
│  ─────────────────────────────  │
│  1. 寫入 SQLite marks 表         │
│  2. 自然以 created_at 進入       │
│     當日 YYYY-MM-DD bucket       │
│  3. 回 201 + mark id             │
│  4. (v2.1+: 觸發 AI 分類選 tag, │
│      非同步,失敗就停在 inbox)   │
└────────────┬────────────────────┘
             │
             ▼
  sidepanel 輸入框清空,顯示「已存」一秒後消失
  使用者繼續瀏覽 / 寫下一條 mark
  (sidepanel 不變,沒列表更新,因為 sidepanel 沒列表)

────── 過一段時間,使用者切回 Mode 1 ──────

       │ chromium_hide() (按關閉瀏覽器按鈕)
       ▼
┌─────────────────────────────────┐
│  Mode 1 主畫面                   │
│  ─────────────────────────────  │
│  筆記列表(按 YYYY-MM-DD 排序):  │
│    2026-06-14                   │
│      └─ 剛存的 N 個 mark          │
│         (帶 source_url 可點回    │
│          原網頁)                  │
│    2026-06-13                   │
│      └─ 舊 marks                │
│                                 │
│  使用者開始潤色 / 重組 / 刪除    │
│  (刪除僅在此模式進行,           │
│   sidepanel 從未提供 delete)    │
└─────────────────────────────────┘
```

## Locked design decisions (no re-debate)

| # | 決定 | 理由 |
|---|---|---|
| 1 | sidepanel 是 **無狀態 compose 視窗**(沒 marks 列表 / 沒歷史 / 沒 draft 持久化) | 跟 email compose 視窗同模型,使用者直覺成立,大幅簡化資料同步 |
| 2 | 關閉瀏覽器 = 未送出的 draft 直接丟失 | 符合「sidepanel 是暫存區」直覺;v2 不為 draft 保存付代價 |
| 3 | 刪除 mark **只能在筆記模式進行**,sidepanel 從未提供 delete UI | 避免兩邊都能刪導致的同步議題 |
| 4 | save 後 mark 進 SQLite,**自然按 created_at 落入當日 YYYY-MM-DD bucket** | NoteGen 筆記本來就以日期為主排序,無需額外分類即可使用 |
| 5 | AI 自動分類(選 tag / notebook)= **v2.1+ 強化層**,v2 MVP 不接 | 先 ship,先驗 UX。日期歸位已是「自動歸位」的最低可行版 |
| 6 | sidepanel iframe 跟 axum server **同 origin localhost** | 沒 CORS;sidepanel React 可直接 fetch NoteGen API |
| 7 | Page context(selection / URL / title)透過 **Chrome extension content script → postMessage → sidepanel iframe** | 唯一跨 Chromium / NoteGen 邊界的橋樑,必要且足夠 |

## Out of scope for v2

- 真實 OAuth / 認證:本地 localhost 服務,只回 NoteGen 自身 React;v2 不對外開放 server
- 多設備同步 sidepanel 狀態(因為 sidepanel 無狀態)
- 瀏覽器內筆記預覽 / 編輯既有 mark(明確排除)
- AI 直接讀 DOM 全文(只給 selection;全文抓取是 v2.2+ 議題,涉及大量 token cost)

## Known carry-over from v1

- `feat/browser-chromium` 分支已 ship,本 vision doc 不更動 v1 行為
- v1 的 BrowserPanel 在 v2 會被改寫(從「panel 內貼 chromium 矩形」改為「browser mode 時 chromium 全螢幕、退化掉 BrowserPanel React UI」)。但這是 v2 的事
- `browser_chromium.rs` 三個命令(`chromium_show/hide/set_panel_rect`)在 v2 保留 `chromium_show/hide`,`set_panel_rect` 可能廢棄(因為 Mode 2 全螢幕不需要矩形貼齊)

## Next session's first action

Brainstorm **fresh** with this doc as input. Don't re-derive the model. Write a `2026-XX-XX-browser-extension-sidepanel-plan.md` covering:

1. axum HTTP server inside Tauri Rust(crate 選型、port 衝突處理)
2. Chrome extension scaffold(manifest v3、sidepanel API、content script、background SW)
3. Mode-switching UI changes(BrowserPanel → full-area swap)
4. SQLite migration(marks 加 3 欄)
5. POST /api/marks endpoint + Next.js sidepanel route
6. Bundle 流程(extension 進 `src-tauri/chromium-extension/`、tauri.windows.conf.json 加 resource)
7. 手動驗收(7 項類似 v1 Task 6 的 visual checklist)

Estimated: 1-1.5 週實作 + 半週收尾。
