# NoteGen 獨立 Fork 升級與修復計畫

> 最後更新：2026-04-04

## Context

NoteGen 是從 codexu/note-gen fork 出來的，目前決定獨立發展。本計畫涵蓋：移除上游綁定、版本升級、安全修復、Bug 修復。

---

## 階段一：移除上游金鑰綁定 -- DONE

### `src-tauri/tauri.conf.json`

*   `plugins.updater.pubkey` 清空為 `""`（保留結構）
*   `plugins.updater.endpoints` 清空為 `[]`（保留結構）
*   `bundle.createUpdaterArtifacts` 改為 `false`（兩處）
*   `dangerousInsecureTransportProtocol` 改為 `false`

> 之後要自己的自動更新時，用 `pnpm tauri signer generate` 產生金鑰對，填回設定即可。

---

## 階段二：Next.js 15.3.2 → 15.5 升級 -- DONE

### 已升級的套件

| 套件 | 之前 | 之後 |
| --- | --- | --- |
| `next` | 15.3.2 | **15.5.14** |
| `@types/react` | ^18 | **^19 (19.2.14)** |
| `@types/react-dom` | ^18 | **^19 (19.2.3)** |
| `eslint-config-next` | 15.0.3 | **15.5.14** |

### 已修改的檔案

*   `next.config.ts`：移除無用的 `sassOptions`（專案無 .scss/.sass 檔）
*   `package.json`：`--turbopack` 已加回 build script（15.5 已修復 Turbopack production bug）

### 修復的 React 19 Types 相容問題（5 處）

*   `src/app/core/main/editor/markdown/md-editor-wrapper.tsx:52` — `useRef` 需明確初始值 `undefined`
*   `src/app/core/main/mark/mark-loading.tsx:9` — 同上
*   `src/app/core/setting/skills/components/skill-card.tsx:37` — 同上
*   `src/app/core/main/mark/tag-manage.tsx:72-120` — `cloneElement` 需 `<any>` 泛型
*   `src/components/ui/expandable-tabs.tsx:60,65` — ref 型別需明確 `HTMLDivElement`

### 驗證結果

*   `pnpm build`（Turbopack）：52 個頁面全部成功
*   `npx next build --turbopack`：skills/sync 頁面正常，bug 已修復
*   `pnpm tauri build`：成功，執行檔縮小至約 17MB

---

## 階段三：安全漏洞修復（第一批）-- DONE

| ID | 修復內容 | 檔案 |
| --- | --- | --- |
| **SEC-C1** | MCP 移除 shell fallback，改用 `Command::new()` 直接執行，防止命令注入 | `src-tauri/src/mcp.rs` |
| **SEC-C2** | `dangerousInsecureTransportProtocol` 改為 `false` | `src-tauri/tauri.conf.json` |
| **SEC-H1** | MarkdownIt `html: true` → `false`，阻止 AI 回應中 raw HTML 執行 | `src/app/core/main/chat/chat-preview.tsx` |
| **SEC-H2** | Infographic 錯誤改用 `textContent` 取代 `innerHTML` | `src/lib/infographic.ts` |
| **SEC-H3** | 移除 GitLab token 的 console.log（含前 10 字元洩漏） | `src/components/title-bar-toolbars/sync-toggle.tsx` |
| **SEC-H6** | 設定 CSP 政策，限制 script/connect/img/worker 來源 | `src-tauri/tauri.conf.json` |

### 暫不處理

*   **SEC-H4**（API key 加密儲存）：改動大，涉及整個 store 架構
*   **SEC-C3**（Shell 參數限制）：影響 MCP/Agent 功能

---

## 階段四：P0 Crash Bug 修復 -- DONE

| ID | 修復內容 | 檔案 |
| --- | --- | --- |
| **BROWSER-R1** | `browser_create` 的 `.unwrap()` 改為 `.map_err()`，無效 URL 回傳錯誤而非 crash | `src-tauri/src/browser.rs:116` |
| **BUG-C3** | 移除 Node.js `crypto` import，改用同步 FNV-1a hash（去重不需加密等級） | `src/lib/rag.ts` |
| **BUILD-1** | `browser_inject_context_menu` 加入 desktop `main.rs` 的 import 和 `generate_handler![]` | `src-tauri/src/main.rs` |

---

## 階段五：P1 功能性 Bug 修復 -- DONE

| ID | 修復內容 | 檔案 |
| --- | --- | --- |
| **BUG-C1** | `versionRef` 改為模組層級 `_condenseVersion`，race condition 防護有效 | `src/stores/chat.ts` |
| **BUG-H1** | 右鍵「加書籤」接上 DB `addBookmark`，加入瀏覽器書籤列 | `src/app/core/main/browser/index.tsx` |
| **BUG-H5** | `insertChats` 補全 7 個缺失欄位（conversationId 等） | `src/db/chats.ts` |
| **BROWSER-S2** | BookmarkDrawer/HistoryDrawer 加入 `pushOverlay`/`popOverlay` | `bookmark-drawer.tsx`、`history-drawer.tsx` |
| **BUG-M6** | `uploadChats` 加 try/catch/finally，`syncState` 正確重設 | `src/stores/chat.ts` |

---

## 階段六：P2 清理優化 -- DONE

| 項目 | 修復內容 |
| --- | --- |
| 移除 7 個未使用依賴 | `pinyin`、`@codemirror/commands`、`@octokit/core`、`github-markdown-css`、`words-count`、`date-fns-tz`、`date-fns` |
| 統一日期庫 | `activity/index.ts` 和 `mobile-me-helpers.ts` 遷移到 dayjs |
| i18n 修復 | `ja.json` 中文→日文、Cancel 硬編碼→`tCommon('cancel')` |
| @types/lodash-es | 搬到 devDependencies |

---

## 階段七：TitleBar 拆分 + 瀏覽器 UI 精簡 -- DONE

| 項目 | 修復內容 |
| --- | --- |
| TitleBar 拆分 | 485 行拆為三檔：`title-bar.tsx`（~185 行共用）、~`~title-bar-notes.tsx~`~（~230 行）、`title-bar-browser.tsx` |
| 瀏覽器底部 bar 移除 | 「擷取文字」「截圖」移至頂部工具列，「清除資料」移至網址列設定 Popover |
| 瀏覽器模式切換 bug | 搜尋列隱藏、切換時自動開新對話 |

---

## 待後續處理（下次修復清單）

### 安全類

| ID | 說明 |
| --- | --- |
| SEC-C3 | Shell 執行權限允許 bash/python 任意參數（影響 MCP/Agent） |
| SEC-H4 | API key 明文儲存（需重構 store 架構） |
| SEC-H5 | 瀏覽器 WebView 無 URL scheme 驗證 |
| SEC-H7 | 檔案系統權限過度寬鬆 |

### 功能類

| ID | 說明 |
| --- | --- |
| BUG-C2 | WebView event listener 清理邏輯 |
| BUG-H1 (translate) | 右鍵「翻譯選取文字」待實作 |
| BROWSER-R2 | 截圖多螢幕支援 |
| BROWSER-R5 | 無 `browser_destroy` 命令 |
| BUG-M4 | `runWithConcurrencyLimit` promise 移除邏輯有誤 |

### 優化類

| ID | 說明 |
| --- | --- |
| SIZE-1 | `tesseract.js` (~8MB) lazy-load |
| SIZE-2 | `pdfjs-dist` (~2.5MB) lazy-load + 本地 worker |
| SIZE-4 | 替換已棄用 `html2canvas` |
| DEP-3 | 統一 hooks 庫 |
| DEP-9 | `reqwest_dav` Cargo.toml 重複宣告 |