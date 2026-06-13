# CDP 瀏覽器引擎遷移 — 上線設計 (Shippable)

> 最後更新：2026-06-07  
> 分支：`feat/browser-cdp-engine`  
> 狀態：設計定案，待 writing-plans 產出實作計畫  
> 前置文件：`docs/superpowers/specs/2026-04-28-browser-ai-strategy-design.md`（引擎策略）、`docs/UPGRADE_PLAN.md`（既有修復 backlog）

---

## 1\. 目標與範圍

把 `feat/browser-cdp-engine` 上未提交的 WIP **收尾成可發佈的桌面瀏覽器功能**：從 Tauri 原生 WebView 改為「外部 CloakBrowser Chromium(headless)→ CDP(chromiumoxide)→ screencast 串流進 `<canvas>` + 合成輸入」的 out-of-process 架構。

**In scope（v1）**：引擎交付(P3 下載器)、路徑持久化、文件/設定/resolver 對齊、繁中 IME、剪貼簿橋接、崩潰自動重啟、安全收緊、popup 多分頁捕捉、右鍵選單、頁內尋找、檔案下載、收尾(favicon/zoom/screencast 調校/命名清理)、測試骨架。

**Out of scope**：M2(結構化存成筆記)、M3(瀏覽歷史向量索引)、M4(反向連結 + 間接 prompt injection 防護)。這些在引擎穩定後另開 spec。

---

## 2\. 已鎖定的決策

| 決策 | 結論 |
| --- | --- |
| 計畫範圍 | 完成 CDP 引擎遷移到可上線(不含 M2–M4) |
| 引擎發佈 | **首次啟動時在 App 內下載(P3)**;`resources` 維持 `["icons"]`,絕不 bundle 引擎到公開 release(避開「禁止再散布」授權違規) |
| IME + 剪貼簿 | **兩者皆納入 v1**(對主要使用者=繁中,是硬需求;剪貼簿是「browse→AI→save」願景核心) |
| 安全姿態 | **收緊傳輸 + 持久 profile**(保留登入,符合閱讀願景) |
| P2 功能 | **四項全納入**:popup/新分頁捕捉、右鍵選單、Ctrl+F 尋找、檔案下載 |
| 崩潰復原 | **自動重啟** |
| 建置順序 | A:解阻塞優先 + 垂直切片 |

---

## 3\. 現況基線(差距分析結論)

四個並行 auditor 交叉確認。**主幹已可運作**,剩下的是「能交付 + 能撐住真實使用者」的外殼。

**已 DONE(真的會動)**

*   Render path 完成:`browser-webview.tsx` 已改寫為純事件中樞,leaf `return <BrowserScreencast/>`。硬替換,無殘留原生 WebView。
*   導覽/內容指令對 CDP 為真:`browser_create / navigate / go_back / go_forward / reload / extract_text / capture / get_url / get_title / get_selected_text / clear_data / set_zoom`。
*   輸入映射(滑鼠/滾輪/鍵盤 → `Input.dispatch*`)、viewport+DPR(`Emulation.setDeviceMetricsOverride`)、screencast pump(每幀 ACK、newest-wins)、殭屍程序處理、mobile cfg-gating、chromiumoxide fetcher 關閉。
*   UI:URL bar / 上下頁 / 重載 / 分頁列(掛在 title bar)/ 書籤列 / StrictMode guard。

**現有測試**:`src/lib/browser/{find,nav-state,zoom}.test.ts`(純函式,架構無關,保留有效)。

---

## 4\. 架構總覽

```
┌─────────────────────────── NoteGen (Tauri WebView, Next.js) ───────────────────────────┐
│  BrowserPanel                                                                            │
│    ├─ NavBar / TabStrip(title bar)/ BookmarkBar / FindBar / Settings>引擎區塊            │
│    └─ BrowserWebView(事件中樞)── 渲染 ──▶ BrowserScreencast(<canvas> + 輸入合成)        │
│            │  invoke()                              ▲ Channel<ScreencastFrame>           │
│            ▼                                        │ emit browser-*                     │
│  ┌──────────────────────────── Rust (CdpState) ────┴───────────────────────────────┐    │
│  │  browser_engine：resolve → 下載器(P3)→ launch(headless)→ DevToolsActivePort       │    │
│  │  chromiumoxide Browser(WebSocket)+ handler_task(IO pump)+ watchdog(崩潰偵測)      │    │
│  │  cdp_events：每頁 listener(load/frame/within-doc/favicon/target/download)         │    │
│  │  cdp_screencast：startScreencast + 每幀 ACK → frame_channel                        │    │
│  └──────────────────────────────────────────┬──────────────────────────────────────┘    │
└─────────────────────────────────────────────┼───────────────────────────────────────────┘
                                               ▼  CDP over loopback ws (origin-restricted)
                              外部 CloakBrowser Chromium(headless,持久 profile)
```

核心原則:內容渲染在外部 Chromium,NoteGen 只收「像素 + 輸入」。好處是 Tauri 保持精簡、得到真 Chromium + stealth;代價集中在程序生命週期、幀延遲、輸入保真(IME/剪貼簿)—— 正是本 spec 的重點。

---

## 5\. 里程碑設計

> 順序 A:每個里程碑可獨立驗收。M6(測試)貫穿,不是最後才補。

### M1 — 引擎交付 + 狀態真實化(P0,最高優先)

**問題**:`tauri.conf.json` 的 `resources=["icons"]`、無下載器、resolver 不 fallback system → 全新安裝開瀏覽器=永久空白 + 只有 `console.error`。BYO 路徑只在記憶體、無 Settings UI。README/EngineStatus/resolver 三方矛盾。

**Rust**

*   新增引擎下載器(desktop-only):從 CloakHQ 官方 GitHub release 下載對應平台壓縮檔 → 校驗(size + 預期 sha256)→ 解壓到 `app_data/cloakbrowser/<version>/` → 回填 resolver 的 `downloaded_dir` slot。進度經 `Channel<DownloadProgress{ phase, received, total }>` 回前端。**絕不由 NoteGen 鏡像/托管 binary**(鏡像=再散布)。
*   `browser_engine_set_path`:除了寫 `CdpState.byo_path`,改為寫入 `tauri-plugin-store`;啟動時載入。
*   修正 `EngineStatus`:`source` 回報真實來源(`byo` / `env` / `downloaded` / `dev-engine-dir` / `cache`),移除謊報的 `'system'`。
*   resolver 探測路徑對齊實際佈局 `engine/<platform>/cloakbrowser-<platform>-x64/chrome(.exe)`。

**前端**

*   Settings 新增「瀏覽器引擎」區塊:顯示 `browser_engine_status`(installed / source / exe\_path);「下載引擎」按鈕 + 進度條(listen download Channel);「手動指定路徑」(BYO,呼叫 `browser_engine_set_path`)。
*   `BrowserWebView` 開引擎前先 preflight `browser_engine_status`;未安裝 → canvas 換成**空狀態卡**(下載 / 選路徑 CTA + 簡短說明),而非空白。
*   `browser_create` 失敗 → store 設 error 狀態 + toast + 導向 Settings 引擎區塊,取代現行 `console.error`。
*   新增 i18n keys(5 語系):引擎未安裝/下載中/下載失敗/選擇路徑/重試。

**文件**:改寫 `engine/README.md` 對齊真實策略(icons-only、無 system fallback、P3 下載為正式交付路徑)。

**授權**:`resources` 維持 `["icons"]`。CI release workflow 不抓引擎(抓了再散布=違規)。

**驗收**:無 system Chrome 的乾淨機器 → 下載引擎成功 → 開瀏覽器看到畫面;重開 App 後 BYO 路徑仍在。

---

### M2 — 崩潰自動重啟(P0)

**問題**:引擎死後 canvas 凍在最後一幀、`browserReady` 卡 true、StrictMode guard 擋重建 → 死到重開 App。`handler_task` 遇第一個 Err 直接 break、無通知。

**Rust**

*   `handler_task`/watchdog 偵測引擎斷線或 process exit → `emit("browser-engine-exited", { reason })` + 重置 `CdpState`(清 pages/listeners/tabs、drop Browser)。
*   加 engine-identity guard:`engine.pid` 配合啟動時間戳/識別,避免 PID 重用時 `taskkill`/`kill` 誤殺無關程序。

**前端**

*   listen `browser-engine-exited` → 重置 `initStartedRef` + `browserReady` → 自動重建引擎(指數退避、上限重試)+「引擎重啟中」提示;超過重試上限 → 落回 M1 的錯誤狀態卡。

**驗收**:手動 kill 外部 chrome 程序 → 數秒內自動恢復可用,無需重開 App。

---

### M3 — 輸入正確性:IME + 剪貼簿(P0,對主要使用者最關鍵)

**問題**:focus 目標是不可編輯 `<div tabIndex=0>`,無 composition 事件、無承載 OS IME 的 editable、無 `insertText` 指令 → 繁中打不了字。headless clipboard ≠ OS clipboard → 網頁複製貼不進筆記/chat。

**IME**

*   canvas 上疊一個**視覺隱藏但可聚焦的 contenteditable/textarea**,承載 OS 組字框(候選視窗才有錨點)。
*   監聽 `compositionstart/update/end` + `beforeinput`;組字進行中不送鍵盤事件(避免半成品字元)。
*   新增 Rust `browser_input_text`(CDP `Input.insertText`);`compositionend` 時送出整串組好的字。
*   一般可列印字元維持現有 `Char` 路徑;區分「組字中 vs 直接輸入」。

**剪貼簿(雙向橋接)**

*   **複製**:Ctrl+C / 右鍵複製 → 取引擎選取內容(`browser_get_selected_text`)→ 寫回 OS clipboard(`navigator.clipboard.writeText` 或 Tauri clipboard plugin)。
*   **貼上**:Ctrl+V → 讀 `navigator.clipboard.readText` → 經 `browser_input_text`/`Input.insertText` 注入引擎。
*   Ctrl+C/V 由 host 攔截走橋接,不再把原始鍵盤事件丟給 headless。

**驗收**:能用繁中 IME 在網頁輸入框打字;網頁選取能複製到 NoteGen 筆記/chat;外部複製的文字能貼進網頁表單。

---

### M4 — popup 多分頁 + 右鍵選單 + Ctrl+F + 檔案下載(P2 四項)

**popup/新分頁捕捉**

*   `Target.setAutoAttach` + listen `targetCreated`/`targetDestroyed`:`window.open`/`target=_blank`/Ctrl+click popup → 收編為新分頁(註冊 listener + screencast + Tab entry);`window.close` → 清掉 stale Tab。關掉 Maps→Gmail 死路(SPA 導覽已用 `EventNavigatedWithinDocument` 修好,本項補 popup)。

**右鍵選單**(取代 `browser_inject_context_menu` 的 stub)

*   `Page.addScriptToEvaluateOnNewDocument` 注入 in-page 選單 DOM(會隨 screencast 一起顯示)+ `Runtime.addBinding` 建立回呼;Rust 真的 `emit("browser-context-action", …)`。
*   動作:複製/貼上(走 M3 橋接)、上下頁/重載/全選、引用(quote)、**翻譯選取文字**(對應 UPGRADE\_PLAN 的 BUG-H1)、截圖、加書籤。

**Ctrl+F 尋找**(取代 find no-op stubs)

*   實作 find:TreeWalker 掃文字節點、高亮、上一個/下一個、結果計數,回 `browser-find-state`。
*   修衝突:`workspaceMode==='browser'` 且焦點在瀏覽器時,host 攔 Ctrl+F → `setFindOpen(true)` 並 `stopPropagation`,不外洩給 `layout.tsx` 的全域筆記搜尋。

**檔案下載**

*   `Browser.setDownloadBehavior` + listen `Page.downloadWillBegin`/`downloadProgress` → `emit("browser-download-started"/"browser-download-finished")` 餵現有前端 UI 與 `src/db/downloads.ts`。

**驗收**:popup 連結正常開新分頁;右鍵動作全部有效(含翻譯);Ctrl+F 開的是瀏覽器尋找而非筆記搜尋;頁內下載連結會觸發下載並進 DB。

---

### M5 — 收尾

*   **favicon**:cdp\_events 加 favicon listener(CDP 或解析 `<link rel=icon>`)→ `emit("browser-favicon-changed")`。
*   **zoom**:把 `BrowserStatusBar` 掛進 BrowserPanel(或把 +/-/% cluster 併入 NavBar);host 攔 Ctrl+ +/-/0 → `browser_set_zoom`(目前 no-op)。
*   **screencast 調校**:加 FPS 上限;viewport resize 不再每次 abort+restart(降低拖窗閃爍);dpr-only 變更(跨螢幕)也重報。
*   **seed 分頁標題 race**:先註冊 listener 再導覽,讓首頁 title 不會漏抓。
*   **devtools 按鈕**:headless 無乾淨開啟路徑 → v1 先移除按鈕(備案:用系統瀏覽器開 CDP devtools 前端 URL,列 follow-up)。
*   **清理**:刪 vestigial `browser_show/hide` + overlay(pushOverlay/popOverlay)機制、移除 `browser-bridge.json` capability、`BrowserWebView` 更名為名實相符(如 `BrowserView`/`BrowserHost`)。
*   **拆 commit**:把無關的 `tiptap-editor.tsx`(markdown 解析資料安全修復 + `editor.loadFailed*` 兩個 i18n key)拆成獨立 commit,讓本分支歷史只含瀏覽器遷移。

---

### M6 — 測試骨架(貫穿)

**抽純函式 + 單元測試**

*   Rust(`#[cfg(test)]`):`resolve_engine_executable`/`find_chromium_in_dir`(precedence、case-insensitive、depth≤3、Err 訊息)、抽出 `parse_devtools_endpoint(&str)`、mappers(`take_nav_kind` 預設 navigate、button name→enum、`frame_from_event` metadata、`chromium_exe_names`)。
*   TS(`.test.ts` 與來源同層):抽 `src/lib/browser/input-map.ts`(mods bitmask、buttonName、double/triple-click reducer、wheel delta 正規化)、`decodeFrameBytes`(base64→Uint8Array,JPEG 解碼在 jsdom 不可測)、`physicalCaps(css,dpr)`。

**整合測試**(需真引擎,`RUN_ENGINE_TESTS=1` 閘控,`#[ignore]` 預設,放 `src-tauri/tests/`)

*   launch→port 探測→`Browser::connect` happy path;navigate→`EventFrameNavigated`→`browser-url-changed`;screencast ≥N frames/T 秒(防「一幀凍住」回歸);殭屍回收(硬殺 Rust 端→重啟→確認前一棵程序樹已死 + Singleton lock 清除);input round-trip;viewport resize 重啟乾淨。
*   因需 no-redistribution binary,CI 不跑,屬開發者/手動。

**e2e**:更新 `e2e/tauri-mock.ts`(移除已刪的 `browser_open_devtools`、補新指令);`google-ua-verify.spec.ts` 重新定位為對真引擎的 stealth/偵測檢查或移除。

---

## 6\. 安全設計與一個待驗證的技術不確定性

*   **持久 profile**:保留登入(符合閱讀願景);列入已知:不可信網站渲染進同一 cookie jar + 內容餵 AI(間接 prompt injection,M4 防護另案)。
*   **傳輸收緊(已驗證 2026-06-07)**:直接讀過 `chromiumoxide-0.9.1` 原始碼確認 —— **不支援** `**--remote-debugging-pipe**`;連線一律走 WebSocket(`DevToolsActivePort` 的 ws URL),`browser/config.rs` 無任何 pipe transport 選項(唯一的 `Stdio::piped()` 只是擷取 child stderr)。
    *   **定案**:把 `--remote-allow-origins=*` 收成**指定 origin**、保持 loopback + ephemeral port,實際安全邊界倚賴**不可猜的 ws path token**(隨機 GUID)。拔掉 `*` 擋掉 DNS-rebind-to-127.0.0.1 類攻擊的一大半。
*   **stealth**:釘死 CloakBrowser chromium-v146;加一個(手動/gated)headless 偵測回歸檢查,版本 bump 時跑。

---

## 7\. 與既有 backlog 的關係(`docs/UPGRADE_PLAN.md`)

| backlog ID | 處置 |
| --- | --- |
| SEC-H5(瀏覽器無 URL scheme 驗證) | 驗證點從 WebView 移到 `browser_navigate`,在 M1/M4 一併加 scheme allowlist |
| BROWSER-R5(無 `browser_destroy`) | 已被 `CdpState.shutdown()` 取代,backlog 可結案 |
| BUG-H1 translate(右鍵翻譯待實作) | 納入 M4 右鍵選單 |

---

## 8\. 驗收標準(shippable 的定義)

1.  全新機器(無 system Chrome)→ Settings 下載引擎成功 → 開瀏覽器看到畫面。
2.  能用繁中 IME 打字;能把網頁內容複製進 chat/筆記;外部文字能貼進網頁。
3.  開新分頁/popup 不死路;右鍵動作、Ctrl+F、頁內下載皆有效。
4.  外部引擎被殺後自動恢復,無需重開 App。
5.  `pnpm lint` + `pnpm test:run` + `cargo build`(desktop)綠燈;LF 行尾。

---

## 9\. 風險登記

| 等級 | 風險 | 緩解 |
| --- | --- | --- |
| 中 | (已查證)chromiumoxide 不支援 pipe;改用 origin 限制 + path token | 已定案,無需 spike |
| 高 | IME 跨 OS/輸入法行為差異(候選視窗定位、組字事件序) | 隱藏 editable 錨點 + 真機測繁中注音/拼音 |
| 中 | screencast 大 viewport×dpr 吃 CPU/延遲 | FPS 上限 + newest-wins + resize 不重啟 |
| 中 | 下載器:CloakHQ release 結構/版本變動 | 版本與校驗和集中設定,失敗有明確 UX |
| 中 | stealth 隨 Chromium 版本/網站強化失效 | 偵測回歸檢查 + 釘版本 + 升級流程 |
| 低 | PID 重用誤殺 | engine-identity guard |

---

## 10\. 下一步

進 superpowers `writing-plans`,把本 spec 轉成逐步、可驗證、含 TDD 節點的實作計畫(每個里程碑一段)。第 6 節的 chromiumoxide pipe 相容性已於 2026-06-07 查證完畢(不支援 → 採 origin 限制 + path token)。