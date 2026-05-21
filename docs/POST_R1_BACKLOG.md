# NoteGen Post-R1 Backlog

> 最後更新：2026-05-15
> 範圍：PR #5（R1–R8 + e2e/test infra）合入後剩下的所有工作
> 來源：合併 `docs/UPGRADE_PLAN.md` 待後續清單 + `docs/BROWSER_WEBVIEW_SPEC.md` R7/R9 + Open Questions Q3/Q4/Q5/Q6

NoteGen 內建瀏覽器第一波（R1 多分頁、R2 下載、R3 檔案上傳 spike、R4 頁內搜尋、R5 上下頁狀態、R6 縮放、R8 DevTools toggle）連同 `docs/UPGRADE_PLAN.md` 階段 1–8，已在 PR #5 合入 `TW199501/note-gen:main`。剩餘工作分散在兩處：`docs/UPGRADE_PLAN.md` 的「待後續處理」（安全/功能/瘦身項目），以及 `docs/BROWSER_WEBVIEW_SPEC.md` 的 R7 翻譯、R9 行動截圖，加 Open Questions Q3/Q4/Q5/Q6。本文件把這些整併為單一、無命名衝突的清單，依照「槓桿、風險、資料門檻」分三階段排序。ID 命名衝突的解法：兩份來源不一致時 **以 WebView spec 為準**，UPGRADE_PLAN 那邊重新命名。

## ID 命名衝突處理

UPGRADE_PLAN 的 `BROWSER-R2`（截圖多螢幕）與 `BROWSER-R5`（缺 `browser_destroy`）跟 `BROWSER_WEBVIEW_SPEC.md` 的 R2/R5 撞名但意思完全不同（spec R2 = 下載，spec R5 = 上下頁狀態，兩者皆已完成）。UPGRADE_PLAN 也把 `BUG-H1` 用在兩個不同 bug 上：「右鍵加書籤接 DB」（Phase 5 已完成），與「右鍵翻譯選取文字」（未完成、跟 spec R7 是同一件事）。

| 舊 ID（來源） | 原意 | 改名為 | 備註 |
|---|---|---|---|
| `BROWSER-R2`（UPGRADE_PLAN 待後續） | 截圖多螢幕支援 | `SCREENSHOT-MULTI-MONITOR` | 避免與 spec R2（下載，已完成）撞名 |
| `BROWSER-R5`（UPGRADE_PLAN 待後續） | 缺 `browser_destroy` 命令 | `BROWSER-DESTROY` | 避免與 spec R5（上下頁，已完成）撞名 |
| `BUG-H1`（翻譯版本） | 右鍵翻譯選取文字 | 併入 `R7` | 同範圍、同一個 `browser-translate-text` emit（`browser-webview.tsx:216`），之後只用 R7 追蹤 |

底下全部使用改名後的 ID。

## Canonical Backlog（單一排序清單）

| # | ID | 標題 | 來源 | 範圍 |
|---|---|---|---|---|
| 1 | `DEP-9` | 移除 `reqwest_dav` 重複 Cargo 宣告 | UPGRADE_PLAN 待後續 | Cargo.toml 清理，非功能 |
| 2 | `BUG-M4` | 修 `runWithConcurrencyLimit` splice 邏輯 | UPGRADE_PLAN 待後續 | `src/lib/rag.ts` 單一函式 |
| 3 | `SEC-H5` | 瀏覽器導航做 URL scheme 驗證 | UPGRADE_PLAN 待後續 | `browser_navigate`、`browser_tabs_new`、`browser_create` |
| 4 | `BROWSER-DESTROY` | 加 `browser_destroy` 釋放整個面板與所有分頁 | UPGRADE_PLAN 待後續 | Rust + 前端 unmount lifecycle |
| 5 | `BUG-C2` | WebView 事件 listener 清理稽核 | UPGRADE_PLAN 待後續 | `browser-webview.tsx` + `tab-strip.tsx` |
| 6 | `DEP-3` | 統一 hooks 套件（`react-use` vs `usehooks-ts`） | UPGRADE_PLAN 待後續 | 5 個 import 點 |
| 7 | `R8-DEVTOOLS-PROD-GATE` | 回答 Q6：release build 保留還是拿掉 `devtools` feature | Q6 | `src-tauri/Cargo.toml:21` |
| 8 | `Q5-DOWNLOADS-SYNC` | 決策：下載歷史是否同步 | Q5 | 決策 + 文件註記 |
| 9 | `SIZE-1` | `tesseract.js`（~8MB）延後載入 | UPGRADE_PLAN 待後續 | `src/lib/ocr.ts` + 4 個呼叫端 |
| 10 | `SIZE-2` | `pdfjs-dist`（~2.5MB）延後載入 + 本地 worker | UPGRADE_PLAN 待後續 | `src/lib/pdf.ts` |
| 11 | `SIZE-4` | 替換已棄用 `html2canvas` | UPGRADE_PLAN 待後續 | 2 個 export 呼叫端 |
| 12 | `SCREENSHOT-MULTI-MONITOR` | 截圖改抓 webview 所在螢幕，不要永遠 `monitors.first()` | UPGRADE_PLAN 待後續 | `browser.rs` 的 `browser_capture` |
| 13 | `SEC-C3` | 限制 shell-execute 參數白名單（MCP/Agent） | UPGRADE_PLAN 待後續 | `capabilities/desktop.json`、`default.json` |
| 14 | `SEC-H7` | 把 `fs:` scope 從 `**` 收緊到實際 workspace + AppData | UPGRADE_PLAN 待後續 | `capabilities/default.json` |
| 15 | `Q3-TRANSLATE-POPOVER` | 決定 R7 翻譯 popover 用 Shadow DOM 還是 Tauri overlay | Q3 | Spike + 決策 |
| 16 | `R7` | 實作右鍵翻譯（併入 BUG-H1 翻譯版） | Spec R7 + UPGRADE_PLAN BUG-H1 | `browser-webview.tsx`、新檔 `translate-popover.tsx`、`lib/ai/translate.ts` |
| 17 | `SEC-H4` | API key 加密儲存 | UPGRADE_PLAN 待後續 | `stores/setting.ts` + `model-config.ts` |
| 18 | `Q4-MOBILE-USAGE` | 從 `activity` 讀行動端瀏覽器使用量做為 R9 門檻 | Q4 | 純決策 |
| 19 | `R9` | iOS/Android 瀏覽器截圖（Q4 門檻） | Spec R9 | 原生 mobile plugin |

## Phase A — 快速勝（高槓桿、低風險）

**里程碑：** v1.1.x 修正版。本階段全部項目不動架構、不依賴 Open Question 決策。目標 1 位工程師 5–7 個工作天。

| # | ID | 描述 | 阻塞依賴 | 估時（天） | 主要動到的檔案 | 風險 |
|---|---|---|---|---|---|---|
| A1 | `DEP-9` | 刪除 `src-tauri/Cargo.toml:55` 第二條 `reqwest_dav = "=0.2.1"`，第 40 行已宣告，desktop-only target 重宣告屬冗餘。完成後跑 `cargo check` 三平台驗證。 | 無 | 0.1 | `src-tauri/Cargo.toml` | 無（Cargo 對相同版本會自動 dedupe，刪除純屬整潔）。 |
| A2 | `BUG-M4` | `src/lib/rag.ts:87` 的 `executing.findIndex(p => p === promise)` 比的是當下剛 push 進去的 `promise`，不是已完成的那個。正解：每個 `.then/.catch` 用 closure 抓自己在 `executing` 的 slot 並自行移除。 | 無 | 0.5 | `src/lib/rag.ts` | 低。錯 splice 仍會動陣列（只是動錯位置），repro 不容易，但 task 數 > limit 時會看到 concurrency 漂移。補一個 vitest（sleep 錯開的 task，斷言 `limit` 個 peak concurrency）。 |
| A3 | `SEC-H5` | 瀏覽器目前接受任何 `url::Url::parse` 通過的東西，`file://`、`javascript:`、`chrome://`、`data:` 全過。在 `browser_navigate`、`browser_create`、`browser_tabs_new` 開頭加白名單（`http`、`https`、`about:blank`），其餘回傳合理 error 讓 UI toast。 | 無 | 0.5 | `src-tauri/src/browser.rs`（661、322、1113 行）、`src/app/core/main/browser/browser-nav-bar.tsx`（toast 處理） | 低。現有測試只 cover happy path，補 Rust unit test 驗證拒絕。注意書籤/歷史 drawer 不要默默壞掉 — 存入時就驗證，不要等到 navigate 才報錯。 |
| A4 | `BROWSER-DESTROY` | 前端有 `browser_show`/`browser_hide` 但沒 `browser_destroy`。`browser_tabs_close` 只釋放單一分頁的 webview。新增 `browser_destroy(app, state)`：對 `tab_labels` 每個 label `webview.close()`，清空 `tabs`、`tab_labels`、`active_tab_id`、`webview_label`、`last_position`、`pending_nav`。從 `BrowserPanel` unmount 與 workspace 切換時呼叫。 | A3 | 0.5 | `src-tauri/src/browser.rs`、`src-tauri/src/lib.rs`（`generate_handler![]`）、`src/app/core/main/browser/index.tsx` | 低。第一個分頁用固定 label `BROWSER_LABEL`，關掉再重生在 Tauri 2.x 有已知地雷（`browser_tabs_close:1237` 已留註解）。`BROWSER_LABEL` 改用「搬出螢幕 + state reset」而非真 `wv.close()`。 |
| A5 | `BUG-C2` | `browser-webview.tsx:225–230` 的 cleanup 在裡面 `await` listener promise — React 在 await 結束前 unmount 就永遠不會呼叫 `unlisten()`。改成同步累積（`const unlisteners: UnlistenFn[] = []; listener.then(fn => unlisteners.push(fn))`），cleanup 時 `unlisteners.forEach(fn => fn())`，用 `cancelled` flag 處理 listener 還沒註冊完就 unmount 的情況。同樣 pattern 順手查 `find-bar.tsx:21,33` 與 `tab-strip.tsx:35`。 | A4 | 1 | `src/app/core/main/browser/browser-webview.tsx`、`src/app/core/main/browser/find-bar.tsx`、`src/app/core/main/browser/tab-strip.tsx` | 中。錯誤修法會重複註冊 listener；現有 `error-audit.spec.ts` e2e 是 warning-free，回歸立刻浮現。加 unit test：mock `getCurrentWindow().listen`，斷言「即使 `cancelled === true` 後才註冊到 listener，最終仍會呼叫 `unlisten()`」。 |
| A6 | `DEP-3` | `package.json` 同時有 `react-use@^17.6.0` 與 `usehooks-ts@^3.1.1`。`react-use` 有 4 處 import（`useLocalStorage` x3、`useClickAway` x1），`usehooks-ts` 只 1 處（`expandable-tabs.tsx` 用 `useOnClickOutside`）。砍 `usehooks-ts`，那 1 處改用 `react-use` 對應 hook。 | 無 | 0.5 | `src/components/ui/expandable-tabs.tsx`、`package.json` | 無。`usehooks-ts` 對 callbacks vs events 處理略有差別，驗證 ref signature 仍可用。 |
| A7 | `R8-DEVTOOLS-PROD-GATE` | 決定 Q6：release build 是否保留 `Cargo.toml:21` 的 `devtools` feature？建議 **保留，但用 `cfg(debug_assertions)` 或新增 `notegen-prod-devtools` feature 控制**。理由：bundle 增量 ~150KB（vs tesseract 微不足道）、browser-bridge capability 已隔離 webview 與 Tauri API、唯一成本是「使用者誤觸 shortcut 看到嚇人的 inspector」 — UI 用 `app.isDevMode` 把 toggle 藏起來即可。 | A4 | 0.5（決策 + 實作） | `src-tauri/Cargo.toml`、`src-tauri/src/browser.rs`（`browser_toggle_devtools:702`） | 低。若選「release 拿掉」要還原 R8 前端 toggle；若「保留」加個設定 gate 即可。mobile build 不要 ship toggle 按鈕（命令本身是 desktop-only）。 |
| A8 | `Q5-DOWNLOADS-SYNC` | 決策：`downloads` SQLite table 要不要跟 notes 一樣經 GitHub/WebDAV 同步？建議 **不同步** — 下載通常是大型 binary（PDF、zip），不該進版控；下載歷史本質上是「這台機器發生的事」。在 `docs/BROWSER_WEBVIEW_SPEC.md` Open Questions 標 resolved「local only」，並在 `src/lib/sync/sync-manager.ts` 加註解明示排除，讓未來擴 sync 的人不會把它加進去。 | 無 | 0.25（決策 + 1 行註解） | `docs/BROWSER_WEBVIEW_SPEC.md`、`src/lib/sync/sync-manager.ts`（純註解） | 無。 |

**Phase A 里程碑：** 整批屬清理或「動一個檔」級的修補，目標一次包成 v1.1.0。順序：A1、A2、A6、A8 互不相干可同時推進；A3 → A4 → A5 動同一塊瀏覽器面板，照順序以避免 merge 衝突。

## Phase B — 架構/風險改動

**里程碑：** v1.2.0，安全 capability 收緊 + bundle 大幅瘦身。目標 8–12 工作天，獨立 feature branch。

| # | ID | 描述 | 阻塞依賴 | 估時（天） | 主要動到的檔案 | 風險 |
|---|---|---|---|---|---|---|
| B1 | `SIZE-1` | `src/lib/ocr.ts:1` 模組頂層 `import { createWorker } from 'tesseract.js'`，5 個呼叫端（`chat-clipboard.tsx`、mark `clipboard.tsx`、`control-scan.tsx`、`control-image.tsx`、設定 `ocr.tsx`）都 eager import。把 `ocr.ts` 改成 async factory（`const { createWorker } = await import('tesseract.js')`），按鈕/元件那邊用 `next/dynamic`。 | 無 | 1.5 | `src/lib/ocr.ts`、`src/app/core/setting/imageMethod/ocr.tsx`、`src/app/core/main/mark/control-scan.tsx`、`src/app/core/main/mark/control-image.tsx`、`src/app/core/main/mark/clipboard.tsx`、`src/app/core/main/chat/chat-clipboard.tsx` | 中。tesseract worker 初始化有成本；改成按下才載會讓首次 OCR 延遲從 0ms 變 1–2s，加 loading toast。tesseract 預設從 CDN 抓 WASM，跟 CSP（SEC-H6 已限 `worker-src`）確認過。 |
| B2 | `SIZE-2` | 同 B1 套到 `src/lib/pdf.ts`。額外：`pdf.ts:8` 把 `pdfjsLib.GlobalWorkerOptions.workerSrc` 設成 CDN URL，改成 build 時把 worker 複製到 `public/` 當本機 static asset，這樣將來 `script-src` 收緊也不會壞。 | B1 | 2 | `src/lib/pdf.ts`、`src/app/core/main/mark/control-file.tsx`、`next.config.ts`（複製 asset 步驟） | 中。目前 CSP 為了 CDN worker 必須允許 `cdnjs.cloudflare.com`，改本機後可以收緊。要驗證離線啟動。 |
| B3 | `SIZE-4` | `html2canvas`（upstream 已 10 個未發版 commit）用在 `export-menu.tsx:11,167` 與 `export-button.tsx:12,64`。選項：(a) `html-to-image`（更小、有維護、API 相近），(b) Tauri 原生 `WebView::take_snapshot`。建議 (a)，原生路線要更深的重寫。 | 無 | 1.5 | `src/app/core/main/editor/markdown/export-menu.tsx`、`src/app/core/main/editor/markdown/footer-bar/export-button.tsx`、`package.json` | 中。輸出像素一致性是最大風險 — KaTeX / Tiptap 在兩 lib 下 rasterize 可能略有差異。先 snapshot 既有 export，新 lib 出來比對。 |
| B4 | `SCREENSHOT-MULTI-MONITOR` | `browser.rs:1001–1003` 用 `xcap::Monitor::all()...monitors.first()` — 即便瀏覽器在副螢幕也永遠抓主螢幕。修法：查 `webview.outer_position()`，用 `xcap::Monitor::from_point()` 找對應螢幕。Tauri 座標是 logical pixels，要 DPI 轉換。 | A3 | 1.5 | `src-tauri/src/browser.rs`（約 990–1018 行） | 中高。多螢幕 + DPI 是平台特有地雷（Windows 縮放 ≠ macOS Retina ≠ Linux/X11）。加 Rust integration test scaffold，即使只能 dev 跑。 |
| B5 | `SEC-C3` | `capabilities/desktop.json` 和 `default.json` 都允許 `shell:allow-execute` 跑 `bash`/`python`/`python3` 且 `args: true` — 任意參數。Phase 3 UPGRADE_PLAN 明確延後。收緊方向：要求 MCP/Agent caller 先註冊「完整命令列」（`mcp.rs` 已有結構），capability 改成有限的 arg-template 白名單；或停用 `bash`/`python` shell-execute 改用 sidecar binary。 | 無 | 2 | `src-tauri/capabilities/desktop.json`、`src-tauri/capabilities/default.json`、`src-tauri/src/mcp.rs`、`src-tauri/src/skills.rs`、`src/lib/mcp/` | 高。MCP 和 Skills 本來就**故意**跑使用者程式碼，問題是「我們是否信賴使用者裝的 script 會 sandbox 自律」。錯誤修法會弄壞所有 MCP server 安裝。merge 前要跑完整 MCP 測試矩陣（filesystem、fetch、sqlite、github）。 |
| B6 | `SEC-H7` | `capabilities/default.json:24–77` 給 `fs:scope`、`fs:read-all`、`fs:read-dirs`、`fs:read-files`、`fs:write-files`、`fs:write-all`、`fs:allow-mkdir` 全是 `path: "**"`。改成 `$APPDATA/**` + `$WORKSPACE/**`（runtime 算出 workspace 自訂路徑）。Tauri 2 支援 per-window scope，screenshot window 完全不需要 fs。 | A4 | 2 | `src-tauri/capabilities/default.json`、`src-tauri/src/app_setup.rs`（如需 runtime 注入 scope） | 高。許多 code 假設可讀寫任意路徑 — `src/lib/workspace.ts` 已處理 custom workspace 分流，但 `src/db/backup.rs`、`src/lib/skills/`、`backup.rs` 可能戳到 scope 外。回歸必跑：備份/還原、skill zip 匯入、自訂 workspace 切換、從任意位置上傳圖片。 |

**Phase B 里程碑：** 安全 capability 收緊 + bundle 瘦身是 v1.2.0 的主體。SEC-C3 和 SEC-H7 是高 blast radius 項目，各自獨立 commit + 完整回歸。SIZE-1/2/4 互不相干，必要時可 cherry-pick 回 v1.1.x point release。

## Phase C — 延後/資料門檻

**里程碑：** R7（翻譯）等 Q3 決策後出貨；R9（行動截圖）等 Q4 確認值得做；SEC-H4 等 API key 洩漏成為實際抱怨、或下次 store 大改時順手做。目標：開放式。

| # | ID | 描述 | 阻塞依賴 | 估時（天） | 主要動到的檔案 | 風險 |
|---|---|---|---|---|---|---|
| C1 | `Q3-TRANSLATE-POPOVER` | 兩方案做 spike：(a) 在 WebView 內注入 Shadow DOM popover（與 WebView 同生死，導頁就丟，接受），(b) Tauri overlay window 浮在 WebView 上（位置同步變 bug 源）。初步推 **(a)** — overlay 的位置同步要對抗縮放 + 捲動 + 多螢幕 + 切分頁，是永久維護稅；翻譯 UI 在導頁時消失是 OK 的 UX。1 天 spike 確認 Shadow DOM 能撐過 `initialization_script`（高機率 OK）。 | 無（純決策） | 1 | 純 spike，結論寫進 `docs/BROWSER_WEBVIEW_SPEC.md` Open Questions | spike 風險低；選定方案後風險繼承到 R7。 |
| C2 | `R7` | 實作右鍵「翻譯」，重用 `src/lib/ai/translate.ts`。`browser-webview.tsx:216` 的 `browser-translate-text` emit 目前沒人聽 — 在 `BrowserPanel` 或 `browser-webview.tsx` 加 listener，呼叫使用者 chat model 翻譯，依 Q3 決定的渲染方式顯示。每個請求一個 AbortController（連按時 cancel 前一次）。AI 沒設定時 toast。 | C1 | 3 | `src/app/core/main/browser/browser-webview.tsx`、新檔 `src/app/core/main/browser/translate-popover.tsx`、`src/lib/ai/translate.ts`（確認接受 `AbortSignal`） | 中。使用者選的 chat model 不一定適合翻譯（例如小型 Ollama，可能拒絕 system prompt）。用 translator 專用 system prompt + 限制長度。`BUG-H1`（翻譯版）= spec R7，之後只用 R7 追蹤。 |
| C3 | `SEC-H4` | API key 目前明文存 `store.json`（`stores/setting.ts:307`，`aiModelList` 內 `apiKey` 是字串，見 `config.tsx:125`）。加密選項：(a) OS keychain，透過 `tauri-plugin-stronghold` 或平台 keyring crate；(b) 用 `machine-uid` + 靜態 salt 對稱加密。(a) UX 較好（首次無需解鎖 prompt），(b) PR 較小。建議 (a)，拆三步：加 plugin → 第一次啟動 migration → store.json fallback 留一個版本 → 下版砍 fallback。 | A6 | 4 | `src-tauri/Cargo.toml`、`src-tauri/src/lib.rs`、新檔 `src-tauri/src/secret_store.rs`、`src/stores/setting.ts`、所有 imageHosting 提供者（`src/lib/imageHosting/*.ts`）、`src/lib/ai/index.ts` | 高。錯誤 migration 會弄丟使用者的 key（要他們去 OpenAI 重撈）。必須三步：讀新或讀舊 → 寫新 → 下版砍舊，不能一次切換。 |
| C4 | `Q4-MOBILE-USAGE` | 讀 `src/db/activity.ts` 的 beta 使用者紀錄（或之後加 telemetry），看行動端瀏覽器是不是真的有人用。<5% mobile session 開瀏覽器 → R9 無限延後，改成「不支援」toast；≥15% → 做 R9。 | 取得 telemetry / beta 數據 | 0.5（純決策） | `docs/BROWSER_WEBVIEW_SPEC.md` Open Questions | 分析本身無風險。 |
| C5 | `R9` | iOS/Android 瀏覽器截圖。Spec 指出 `browser.rs:508` 整段被 `cfg(not(android/ios))` 包住，目前 `browser_capture` 是 desktop-only（990–1018 行）。行動版要寫 Tauri mobile plugin（Swift + Kotlin）包 `WKWebView.takeSnapshot` 與 `WebView.draw(Picture)`。Rust 端在 `cfg(any(target_os="android", target_os="ios"))` 分支（目前 1020–1024 行回傳「不支援」）呼叫 plugin。 | C4、B4 | 5 | 新目錄 `src-tauri/mobile/plugin/`、`src-tauri/src/browser.rs`（1020–1024 行）、`src/app/core/main/browser/browser-nav-bar.tsx`（mobile 取消隱藏按鈕） | 高。Mobile plugin 是 NoteGen 第一次寫，預估 2 天 setup 才能動到 feature code。 |

## Critical Path

最長的相依鏈是安全收緊 → R7/SEC-H4 出貨：

```
A3 (SEC-H5)  →  A4 (BROWSER-DESTROY)  →  A5 (BUG-C2)
                       ↓
                B4 (SCREENSHOT-MULTI-MONITOR)
                       ↓
                B5 (SEC-C3)  →  B6 (SEC-H7)
                                       ↓
                                C3 (SEC-H4)
```

總計 ≈ 12 工作天（A3 0.5 + A4 0.5 + A5 1 + B4 1.5 + B5 2 + B6 2 + C3 4 ≈ 11.5）。這是把整套安全收緊出貨的底線。C2（R7）走另一條平行鏈，前面只卡 C1（Q3 決策），跟安全鏈無關，Phase A 結束後隨時可動。

## Parallelizable Work

兩位工程師可同時推進這些配對，動到的檔案不重疊：

| 工程師 1（瀏覽器/安全） | 工程師 2（瘦身/AI） |
|---|---|
| A3 SEC-H5（`browser.rs`） | A2 BUG-M4（`rag.ts`） |
| A4 BROWSER-DESTROY（`browser.rs`、`index.tsx`） | A6 DEP-3（`expandable-tabs.tsx`） |
| A5 BUG-C2（`browser-webview.tsx`、`find-bar.tsx`） | B1 SIZE-1（`ocr.ts` + 呼叫端） |
| B4 SCREENSHOT-MULTI-MONITOR（`browser.rs`） | B2 SIZE-2（`pdf.ts`） |
| B5 SEC-C3（`capabilities/*.json`、`mcp.rs`） | B3 SIZE-4（`export-menu.tsx`、`export-button.tsx`） |
| C1 + C2 R7（`browser-webview.tsx`、新 popover） | C3 SEC-H4（stronghold + `stores/setting.ts`） — 但要等 B6 落地，migration 才會跑在收緊後的 fs scope 上 |

**不能平行的：**
- A4 → A5 → C2 都動 `browser-webview.tsx`（A4 加 unmount effect，A5 才能再 refine）。
- B5、B6 都動 `capabilities/default.json`，必須序列化。

## Open Questions

| Q | 處理建議 |
|---|---|
| **Q3**（翻譯 popover 寄宿方式） | C1 一天 spike Shadow-DOM-in-WebView。判定規則：若 `initialization_script` 能撐過 `pushState` / DOMContentLoaded（至少 Google Search、GitHub、SPA 如 Twitter 三個目標），選 (a)；否則 fallback 到 (b) Tauri overlay + `outer_position()` + `ResizeObserver` 同步位置。**預設推 (a) Shadow DOM**，即便 UX 上接受「導頁時 popover 會丟」，因為 overlay 位置同步是永久維護稅。 |
| **Q4**（行動截圖價值） | 最低成本解：**無限延後** — `browser_capture` 行動分支 ship 一個 toast「請用 iOS 內建截圖」+ 系統文件連結。等 telemetry 顯示行動端瀏覽器使用量真的值得做，再回頭開 R9。若工程堅持要做，最小 spike 是 1 天 iOS-only 原型（`WKWebView.takeSnapshot`）確認可行性，Android 視結果而定。 |
| **Q5**（下載歷史同步） | **不同步**，已在 A8 註明。下載可能是巨大（影片、資料集），本質就是 per-device，硬同步會把所有 sync provider 的配額爆掉。Spec 記下，`sync-manager.ts` 不要加。 |
| **Q6**（DevTools 在 release） | **保留 `devtools` feature**，UI toggle 藏在 `app.isDevMode()`（新設定 flag，預設 `false`）之後。理由：bundle 增量小，browser-bridge capability 已隔離 webview 與 Tauri API（DevTools 注入攻擊的爆炸半徑很小），重度使用者真的需要它 debug 卡住的 webview。Mobile build 維持現有 `browser_toggle_devtools` 的 cfg 排除。 |

## Skip / Won't Fix 建議

| 項目 | 理由 |
|---|---|
| `DEP-9`（仍在 backlog） | 留在 backlog 但歸類為「5 分鐘清理」，不是 bug。Cargo 對相同版本 dedupe，第二條宣告純屬冗餘 — 清掉只是為了讓未來讀 code 的人不要誤會。 |
| `R9` 行動截圖，若 Q4 < 5% | 無限延後，改成「使用系統截圖」toast。5 天做 NoteGen 第一個 mobile plugin 的成本太大，行動端本來就能用系統截圖整個畫面。 |
| 新 telemetry 框架 | 不加。UPGRADE_PLAN 沒要求。`activity` table 在 beta 回答 Q4 夠用，真有需求再擴。 |
| `R7` 全頁翻譯 | Spec 明確標「全頁翻譯不做」，不要擴大範圍。 |
| `SEC-H4` 對稱加密捷徑 | 不要走。`machine-uid` 衍生 key 在被入侵的機器上一行 Rust 就能拆出來，給使用者錯誤的安全感。要嘛 stronghold 做好，要嘛延後 — 沒有半套。 |
| Observability hook（OpenTelemetry 之類） | 不在 scope。NoteGen 是本地檔案的 Tauri shell app，Phase 8 才剛清完 dead deps，不要再請一個重量級的回來。 |

## Critical Files for Implementation

- `src-tauri/src/browser.rs`
- `src/app/core/main/browser/browser-webview.tsx`
- `src-tauri/capabilities/default.json`
- `src/lib/rag.ts`
- `src/stores/setting.ts`
