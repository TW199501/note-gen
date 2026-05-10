# 內建瀏覽器 WebView 補強計畫

> 最後更新：2026-05-10
> 範圍：補齊先前盤點出的 9 項 WebView 缺失
> 對應程式碼：`src-tauri/src/browser.rs`、`src/app/core/main/browser/`、`src/stores/browser.ts`

---

## Problem Statement

NoteGen 內建瀏覽器目前是**單一子 WebView**架構（`browser.rs:184-279`），對使用者而言缺少現代瀏覽器的基本功能：無法開新分頁、無法下載檔案、無法上傳檔案、無法在頁內搜尋、無法縮放、上下頁按鈕狀態錯亂、行動平台無法截圖、DevTools 無法關閉、翻譯按鈕只是空殼。

這些缺失讓「邊瀏覽邊整理筆記」的核心情境經常卡住——使用者必須切換到外部瀏覽器才能完成基本動作，內建瀏覽器淪為唯讀預覽工具，違背產品定位。

---

## Goals

1. **G1：把內建瀏覽器從「唯讀預覽器」升級為「可完成基本網頁工作的工作面板」**——使用者不需要為了下載、登入上傳、頁內搜尋而離開 NoteGen。
2. **G2：上下頁、DevTools 等狀態 UI 與真實狀態 100% 同步**——按鈕禁用、開關狀態正確反映 WebView 實際情況，消除「按了沒反應」的困惑。
3. **G3：iOS / Android 上瀏覽器功能達桌面版的 80%**（截圖、儲存頁面內容、書籤），而非目前的「整段 cfg 切掉」狀態。
4. **G4：翻譯與頁內搜尋等資訊整合功能達到可用閾值**——翻譯按鈕真的能翻譯、Ctrl+F 真的能搜尋。
5. **G5：完成本計畫後，內建瀏覽器相關 GitHub issue 數量在 30 天內不再增加新的「基本功能缺失」類別**。

---

## Non-Goals

1. **不做擴充功能（extensions）系統**——架構複雜度爆炸，且 Tauri WebView 平台層不支援 Chrome extension API。需要時再開新 spec。
2. **不做廣告攔截 / 內容過濾**——維護黑名單成本高、與筆記產品核心無關。
3. **不做 reader mode / 自動 PDF 檢視器**——已有 `pdfjs-dist` 套件，但這是另一個獨立的「PDF 閱讀」功能，不該綁在瀏覽器裡。
4. **不做完整的 cookie / session manager UI**——清除按鈕已存在（`browser.rs:462-505`），更細緻的管理（網站別 cookie 編輯）屬於進階使用者需求，本期不做。
5. **不做代理（proxy）設定 UI**——應該由系統代理繼承，加 UI 會誤導使用者以為這是隱私功能。

---

## User Stories

依優先順序排列，分四類人物：**Researcher**（邊看邊抄筆記）、**Power User**（重度使用者）、**Mobile User**（iOS/Android）、**Developer**（套版/除錯）。

### P0 — 核心阻塞情境

1. **Researcher**：身為研究者，我想要**同時開多個分頁比對資料**，這樣不必為了切換來源頁而失去當前頁的捲動位置。
2. **Researcher**：身為研究者，我想要**在當前頁面用 Ctrl+F 搜尋關鍵字**，這樣可以快速跳到引用段落。
3. **Power User**：身為使用者，我想要**從網頁下載檔案到本機**（PDF、CSV、圖片），這樣可以直接附加到筆記。
4. **Power User**：身為使用者，我想要**在登入網站時上傳檔案**（頭像、附件），這樣不必跳出去用外部瀏覽器登入再回來。
5. **Power User**：身為使用者，我想要**上下頁按鈕在無歷史時自動禁用**，這樣不會點到沒反應的按鈕而困惑。

### P1 — 體驗顯著提升

6. **Researcher**：身為視力有限的使用者，我想要**用 Ctrl+/-/0 縮放網頁**，這樣可以閱讀小字內容。
7. **Researcher**：身為非英語使用者，我想要**右鍵選擇「翻譯這段」就真的看到翻譯結果**，而不是只觸發一個沒實作的 event。
8. **Developer**：身為開發者，我想要**DevTools 按鈕能反映目前是開或關**，並支援關閉，這樣在除錯網頁時不會每次都疊開新視窗。

### P2 — 行動平台對齊

9. **Mobile User**：身為 iOS/Android 使用者，我想要**截取目前網頁畫面到筆記**，這樣行動平台與桌面平台功能對等，不會有「桌面才有」的不一致感。

---

## Requirements

### P0：必做（缺了就不算功能補齊）

#### R1. 多分頁支援

**行為**
- 瀏覽器面板頂部新增分頁列（tab strip），支援新增、關閉、切換、拖曳排序、中鍵關閉。
- 每個分頁對應一個獨立的子 WebView instance（label 改為動態 `browser-webview-{id}`）。
- 攔截 `target=_blank` / `window.open()` 改為**開新分頁**而非當前頁導航（修改 `browser.rs:193-229` 的注入腳本）。
- 分頁狀態（URL、title、favicon、捲動位置）持久化到 `store.json`，重開 app 後恢復。
- 同時最多 10 個分頁，超過時提示使用者關閉舊分頁（避免記憶體爆炸）。

**驗收條件**
- [ ] 能開 5 個分頁同時運作，互不干擾。
- [ ] 點網頁中 `<a target="_blank">` 連結會開新分頁，當前頁面不變。
- [ ] 關閉分頁時對應 WebView instance 被 `webview.close()` 釋放，記憶體回收（用 Activity Monitor 驗證）。
- [ ] 重啟 app 後分頁恢復（URL 與順序）。
- [ ] 拖曳重排分頁順序時，對應 WebView 不會重新載入。

**技術考量**
- `browser.rs:36` 的 `BROWSER_LABEL` 常數需改為動態。`BrowserState` 需從單一 `webview_label` 改成 `HashMap<TabId, WebviewLabel>`。
- 隱藏非當前分頁需重複用「搬出螢幕」trick（`browser.rs:323-338`），不可同時 mount 多個 visible WebView 在同一座標。
- Zustand store `browser.ts` 需擴充 tabs array、activeTabId。

#### R2. 下載處理

**行為**
- 當網頁觸發下載（HTTP `Content-Disposition: attachment` 或 `<a download>`），跳出 Tauri `dialog.save()` 讓使用者選位置。
- 下載進度顯示在瀏覽器底部 status bar（`browser-status-bar.tsx`）。
- 下載完成後 toast 顯示「在 Finder/Explorer 顯示」與「附加到筆記」兩個動作。
- 下載歷史記錄到 SQLite 新表 `downloads`（url, filename, path, size, timestamp）。

**驗收條件**
- [ ] 從 GitHub release 下載一個 zip，能選位置儲存。
- [ ] 下載中顯示進度條，能取消。
- [ ] 下載失敗（網路斷、磁碟滿）時顯示錯誤 toast，不會卡 UI。
- [ ] 「附加到筆記」會把檔案複製到當前筆記資料夾並插入連結。

**技術考量**
- Tauri 2 的 `tauri-plugin-http` 已啟用（`Cargo.toml:28`），可用 `reqwest` stream 抓檔。但 WebView 內 click 觸發的下載需攔截：用 navigation handler 偵測 response header，改走 Rust 端下載而非讓 WebView 自己處理（WebView 預設行為是開新視窗顯示）。
- 需新增 Tauri command `browser_download(url, suggested_name)`，用 `tokio` stream 寫檔案，emit 進度 event。

#### R3. 檔案上傳

**行為**
- 點 `<input type="file">` 跳出原生檔案選擇對話框，選定後檔案內容透過 WebView 標準 API 傳給網頁。

**驗收條件**
- [ ] 在 Gmail 附加檔案能成功上傳。
- [ ] 在 GitHub 上傳大頭貼能成功。
- [ ] 取消檔案選擇時不會卡死網頁。

**技術考量**
- `browser-bridge.json:4` 的限制是針對 `__browser_*` 命令隔離，不影響 WebView 原生的檔案輸入框。
- 需確認 Tauri 2 的 child WebView 預設是否支援 file input；macOS 上 WKWebView 預設支援，Windows WebView2 也支援。**先驗證實際行為再決定要不要寫額外程式碼**——可能只是文件上的擔心，實際已可用。
- 若需明確啟用：在 `WebviewBuilder` 上設定 `accept_first_mouse(true)` 並確認 capability 是否需要 `dialog:default`（雖然是 WebView 自己呼叫不是我們的 invoke）。

#### R4. Find in Page (Ctrl+F)

**行為**
- 按 Ctrl+F（macOS Cmd+F）在瀏覽器面板上方滑入搜尋列。
- 即時高亮所有匹配，Enter / Shift+Enter 跳到下一個 / 上一個。
- 顯示「3/12」當前位置與總數。
- Esc 或點 X 關閉並清除高亮。

**驗收條件**
- [ ] 中英文皆可搜尋。
- [ ] 大小寫切換 toggle 可用。
- [ ] 跳到匹配項時頁面自動捲動到該位置。
- [ ] 搜尋列只在瀏覽器面板有焦點時觸發 Ctrl+F，不會搶 chat / editor 的 Ctrl+F。

**技術考量**
- WebView 沒有原生 find API 暴露給 Tauri。需注入 JS 實作：`window.find()`（Chromium 方案）或自寫 TreeWalker。
- 推薦走自寫 TreeWalker（穩定且能跨平台），參考已知套件 `mark.js` 的實作（不直接引用，避免外部 npm 套件污染 WebView）。

#### R5. 上下頁按鈕狀態同步

**行為**
- back/forward 按鈕的 `disabled` 屬性反映當前 WebView 的 history 狀態。
- 每次導航完成（page-loaded event）後更新狀態。

**驗收條件**
- [ ] 全新分頁的 back 按鈕是 disabled。
- [ ] 走訪一頁後 back 按鈕變 enabled。
- [ ] 按 back 到首頁後 back 按鈕又變 disabled、forward 變 enabled。

**技術考量**
- 注入腳本在 `pageshow` event 時讀 `window.history.length` 與當前 index（用 `history.state` 或 `popstate` 追蹤），透過新增的 `__browser_nav_state` 命令回傳。
- Rust 端 emit `browser-nav-state` event，前端 `browser-nav-bar.tsx` 訂閱並更新 button 的 disabled prop（目前 `onClick={() => invoke('browser_go_back')}` 改為條件 enable）。

### P1：應做（顯著提升體驗）

#### R6. Zoom 縮放

**行為**
- Ctrl+= 放大 10%、Ctrl+- 縮小 10%、Ctrl+0 重設。
- 縮放層級顯示在 status bar，per-tab 持久化。

**驗收條件**
- [ ] 縮放範圍 25%–500%，超出範圍按鍵無作用。
- [ ] 切換分頁時各分頁保持自己的縮放比例。

**技術考量**
- 注入 CSS transform（`document.body.style.zoom = 1.2`）是最快實作。Chromium 系列支援 `zoom` 屬性，行為一致。

#### R7. 翻譯實作

**行為**
- 右鍵選 「翻譯」 後，呼叫使用者已設定的 AI provider（chat 用同一個 model），把選取文字翻譯成使用者偏好語系（從 `next-intl` locale 推導，可在設定覆寫）。
- 翻譯結果顯示在 floating popover（`@radix-ui/react-popover`），位置貼著選取範圍。
- 全頁翻譯**不做**（成本過高，留 v2）。

**驗收條件**
- [ ] 選一段英文按右鍵→翻譯，2 秒內看到中文結果。
- [ ] AI 設定不完整時顯示「請先到設定→AI 設定 model」提示，不會靜默失敗。
- [ ] 連續觸發新翻譯時，前一個請求被 abort（用 `AbortController`，避免堆疊請求）。

**技術考量**
- 重用 `src/lib/ai/translate.ts` 既有翻譯邏輯。
- 目前 `browser-webview.tsx:153-154` 只 emit event 沒有 listener；新增 listener 連到 translate API 並把結果再 inject 回 WebView 顯示 popover。

#### R8. DevTools 開關狀態

**行為**
- DevTools 按鈕變 toggle，顯示目前是開或關。
- 再點一次能關閉。

**驗收條件**
- [ ] 點開→看到 DevTools 視窗→再點關閉→DevTools 視窗消失，按鈕狀態同步。

**技術考量**
- Tauri 2 的 webview API：`webview.is_devtools_open()`、`webview.close_devtools()`。需確認 macOS / Windows / Linux 都可用（Tauri docs 標 `devtools` feature flag 為 dev-only，需確認 production build 是否需要）。
- `Cargo.toml:21` 已啟用 `devtools` feature。

### P2：未來考量（架構要支援，但 v1 不做）

#### R9. iOS/Android 截圖

**行為**
- 行動平台上「截取頁面」按鈕能用，輸出與桌面版相同的 PNG。

**驗收條件**
- [ ] iOS 模擬器上能截取網頁存到 Photos 或筆記。
- [ ] Android 同上。

**技術考量**
- `browser.rs:508` 整段被 `cfg(not(android/ios))` gate 掉，目前用 `xcap` 套件（限 desktop）。
- 行動平台需改用 WebView 自己的截圖 API：iOS WKWebView 的 `takeSnapshot`、Android WebView 的 `Picture.draw`。需寫 Tauri mobile plugin 包裝原生呼叫。
- **本期不做實作**，但 R1（多分頁）的架構設計需保留 per-tab `screenshot()` 介面，避免之後加入時要改 store。

---

## Success Metrics

### Leading Indicators（30 天內）

- **多分頁採用率**：開過 ≥ 2 個分頁的使用者佔啟用瀏覽器使用者 ≥ 40%。
- **下載完成率**：發起下載的成功率（非取消）≥ 95%。
- **Ctrl+F 觸發次數**：每位活躍瀏覽器使用者每週 ≥ 3 次。
- **back/forward 按鈕誤點率**：disabled 狀態被點擊次數 = 0（disabled 應該真的擋住）。

### Lagging Indicators（90 天）

- **瀏覽器面板使用時長**：每使用者每日中位數 vs 補強前對比 +30%。
- **「瀏覽器功能缺失」類 GitHub issue 月新增數**：從目前 2~4 件 / 月降到 ≤ 1 件 / 月。
- **「邊瀏覽邊存到筆記」流程完成率**：從瀏覽器點開連結到內容存入 mark/note 的轉換率 +20%。

### 量測方法

- 採用率與功能呼叫次數：埋點到 `src/db/activity.ts` 既有 activity 記錄表，新增 `browser_*` 事件類型。
- GitHub issue 統計：用 label `area:browser` 過濾。
- 使用時長：從 `activity.ts` 的 session 時間區間推導。

---

## Open Questions

| # | 問題 | 誰回答 | 是否阻塞 |
|---|------|--------|----------|
| Q1 | 多分頁的記憶體上限要設幾個？10 太少還是合理？需參考 macOS/Windows/Linux 上 Tauri WebView 多 instance 的實際記憶體佔用 | Engineering（需做 spike） | 阻塞 R1 設計 |
| Q2 | 檔案上傳是否真的需要額外程式碼？還是 Tauri 2 子 WebView 已預設支援？ | Engineering（30 分鐘 spike） | 阻塞 R3 |
| Q3 | 翻譯結果 popover 用 inject DOM 進 WebView，還是用 Tauri 原生 overlay 浮在 WebView 上方？前者跨頁切換會丟、後者位置追蹤難 | Engineering + Design | 阻塞 R7 |
| Q4 | 行動平台 R9 是否值得做？目前行動端瀏覽器使用量未知 | Product（需先看 activity 數據） | 不阻塞 v1 |
| Q5 | 下載歷史是否要與 NoteGen sync 機制（GitHub/WebDAV）同步？還是純本機？建議純本機（隱私 + 大檔不該同步） | Product | 不阻塞 |
| Q6 | DevTools 在 production build 是否需要保留？目前 `Cargo.toml:21` 啟用了 `devtools` feature，影響 bundle size 與安全性 | Engineering + Product | 不阻塞 R8（先做開關，production 是否關掉再議） |

---

## Timeline Considerations

### 建議分三階段（基準日 2026-05-10，1 人 full-time 預估）

**Phase 1（2 週｜2026-05-11 → 2026-05-22）— 核心可用性**

| 工項 | 預估 | 起 | 訖 |
|------|------|-----|-----|
| R5 上下頁狀態同步 | 0.5 天 | 2026-05-11 | 2026-05-11 |
| R8 DevTools 開關 | 0.5 天 | 2026-05-12 | 2026-05-12 |
| R6 Zoom | 1 天 | 2026-05-13 | 2026-05-13 |
| R3 檔案上傳驗證 spike + 必要修補 | 1 天 | 2026-05-14 | 2026-05-14 |
| R4 Find in Page | 3 天 | 2026-05-15 | 2026-05-19 |
| 整合測試 + buffer | 3 天 | 2026-05-20 | 2026-05-22 |

> **Phase 1 里程碑**：2026-05-22 釋出 v1.1.x，僅單分頁體驗改善，不動架構。

**Phase 2（3 週｜2026-05-25 → 2026-06-12）— 架構升級**

| 工項 | 預估 | 起 | 訖 |
|------|------|-----|-----|
| R1 多分頁 — `BrowserState` 改造 | 2 天 | 2026-05-25 | 2026-05-26 |
| R1 多分頁 — UI（tab strip、切換、關閉） | 4 天 | 2026-05-27 | 2026-06-01 |
| R1 多分頁 — 持久化 + 拖曳排序 | 2 天 | 2026-06-02 | 2026-06-03 |
| R1 把 Phase 1 功能 per-tab 化 | 1 天 | 2026-06-04 | 2026-06-04 |
| R2 下載處理 | 4 天 | 2026-06-05 | 2026-06-10 |
| 迴歸測試 + buffer | 2 天 | 2026-06-11 | 2026-06-12 |

> **Phase 2 里程碑**：2026-06-12 釋出 v1.2.0，多分頁 + 下載。需開 feature branch，完整迴歸通過再 merge。

**Phase 3（彈性｜2026-06-15 起）— 整合與行動平台**

| 工項 | 預估 | 起 | 訖 |
|------|------|-----|-----|
| Q3 決議（翻譯 popover 方式） | 1 天 | 2026-06-15 | 2026-06-15 |
| R7 翻譯實作 | 3 天 | 2026-06-16 | 2026-06-18 |
| Q4 數據檢視（行動平台使用量） | 0.5 天 | 2026-06-19 | 2026-06-19 |
| R9 行動平台截圖（若 Q4 通過） | 5 天 | 2026-06-22 | 2026-06-26 |

> **Phase 3 里程碑**：最遲 2026-06-26。R9 視 Q4 結論決定是否進入本期；若延後，本期於 2026-06-18 結束。

### 依賴

- R1 是 R2、R6、R8 的隱性依賴（per-tab 狀態管理）。建議 Phase 1 完成 R5/R4/R6/R8 的**單分頁版**，Phase 2 做 R1 時順手把它們 per-tab 化。
- R7 依賴使用者已設定 AI provider，需在 onboarding 提示。
- 沒有外部硬截止日期。

### 風險

- **多分頁記憶體爆炸**：每個 WebView instance 在 macOS 上約 80–150MB，10 個分頁可能達 1.5GB。需在 Q1 spike 後決定上限。
- **Find in Page 注入 JS 與網頁衝突**：某些 SPA 會重 render DOM，導致高亮被洗掉。需測試 React/Vue 重型網站。
- **檔案上傳跨平台一致性**：iOS/Android WebView 的 file input 行為差異大，可能需 platform-specific 程式碼。
