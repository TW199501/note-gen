# NoteGen 打包 Chromium 實體瀏覽器 — 設計文件

日期:2026-06-13
分支:`feat/browser-chromium`(基於 main)
狀態:已與使用者逐項確認核可

## 背景與動機

使用者最初的需求:把 NoteGen 內建瀏覽器從 Tauri WebView 換成「實體瀏覽器」——
一個完整、含原生 UI 的 Chromium,直接打包進 NoteGen。

此前歷經三次失敗方向(均已廢棄,**不得再提**):

1. **CDP + CloakBrowser 外掛程序**(`feat/browser-cdp-engine`)— 截圖串流 + 合成輸入,IME/剪貼簿不可靠。
2. **noVNC + Docker sidecar** — 強制 Docker 依賴,一般使用者裝不起來。
3. **CEF Views + Chrome runtime 嵌入**(`feat/browser-novnc` 末期)— 把 Chromium 當函式庫嵌進
   NoteGen 進程。頁面可渲染、可點擊,但 **Chrome 原生工具列(網址列/分頁/選單)始終畫不出來**,
   三輪 hypothesis 調查未解。

本設計改採第四條路:**把 Chromium 當完整子程序啟動**。UI 問題從「自己用 Views API 組」
變成「Chromium 本來就有」,難度從 API 考古降為視窗管理。

## 核心需求(不可妥協)

1. NoteGen 打包**可自由散布的完整 Chromium**(非 CEF 函式庫、非 CloakBrowser)。
2. 瀏覽器 UI 全部用 Chromium **原生自帶的**(網址列/分頁/上下頁/三點選單)。
   **NoteGen 不畫任何 browser-chrome React UI。**
3. 瀏覽器視窗貼進 NoteGen 的瀏覽器面板區域,隨 workspace 模式顯示/隱藏。
4. 從 main 開新分支 `feat/browser-chromium` 重來;舊三條分支
   (`feat/browser-novnc`、`claude/cef-toolbar-investigation`、`claude/cef-custom-toolbar-fallback`)全部刪除。
5. Windows 優先(與 CEF 時代相同的平台範圍)。

## 設計

### 1. Chromium 來源與打包

- 採用 **ungoogled-chromium** Windows x64 建置(BSD 授權、可自由再散布、無 Google 回報服務)。
- **開發期:** `scripts/fetch-chromium.mjs` 下載解壓到 `src-tauri/chromium/`(gitignore),開發者跑一次。
- **發行版:** 經 `tauri.conf.json` 的 `bundle.resources` 打進安裝檔。安裝檔 +200MB 是已接受的代價。
- CloakBrowser(`engine/`,禁止再散布)不再使用、維持 gitignore 不動。

### 2. Rust 後端(新模組 `src-tauri/src/browser_chromium.rs`)

- **啟動:** 以子程序啟動 `chrome.exe`,參數:
  `--user-data-dir=<app-data>/browser-profile`(獨立 profile,不污染使用者既有 Chrome)、
  `--no-first-run`、`--no-default-browser-check` + 起始 URL(`https://www.google.com/`)。
- **視窗探測:** 依子程序 PID + window class `Chrome_WidgetWin_1` + top-level + visible,
  輪詢 `EnumWindows` 直到找到主視窗(逾時報錯)。
- **貼進面板:** 沿用 CEF overlay 已驗證的 owner 手法 —
  `SetWindowLongPtr(GWLP_HWNDPARENT) = NoteGen HWND`(無獨立工作列圖示、跟著 NoteGen
  縮放/還原),再依面板矩形 `SetWindowPos`。
- **Tauri 命令面:** `chromium_set_panel_rect` / `chromium_show` / `chromium_hide`,
  語意與 CEF 時代的 `cef_overlay_*` 一致;app 退出時終止子程序。
- **生命週期:** 子程序意外結束(崩潰或使用者按 Chrome 的 ✕)→ 發事件給前端,
  下次切到瀏覽器模式時自動重啟。

### 3. 前端(極薄)

- `BrowserPanel`(`src/app/core/main/browser/index.tsx`)維持佔位 div 模式:
  回報面板矩形、依 `workspaceMode` 呼叫 show/hide。
- 舊 WebView 瀏覽器的 React 元件(nav-bar、tab-strip、各 drawer 等 11 檔)+
  `src-tauri/src/browser.rs` 全數刪除。
- 既有 SQLite 的 bookmarks / browser-history / downloads 表**先不動**
  (Chrome profile 自管歷史書籤;清表是後續獨立工作)。

### 4. 錯誤處理

- chrome.exe 不存在(開發者沒跑 fetch 腳本)→ 面板顯示明確指引訊息。
- 啟動失敗 / 視窗探測逾時 → 錯誤事件 + 面板顯示重試按鈕。
- 子程序崩潰 → 同上,自動重啟一次,再失敗顯示錯誤。

### 5. 殘骸清理

- 刪除分支(local + remote):`feat/browser-novnc`、`claude/cef-toolbar-investigation`、
  `claude/cef-custom-toolbar-fallback`;一併移除對應的舊 worktree
  (`E:/source/note-gen-cef-fallback`、`E:/source/note-gen-cef-investigation`)。歷史靠 GitHub/reflog 留底。
- 過時計畫文件(CDP/noVNC/CEF 的 plans)移到 `docs/superpowers/plans/archive/`。
- CLAUDE.md 的 In-app Browser 章節改寫為新架構。

### 6. 驗證方式

- **手動驗收(核心):** `pnpm tauri dev` → 切瀏覽器模式 → 面板內出現**完整 Chrome UI**
  (網址列、分頁、上下頁、三點選單)→ 能瀏覽、開分頁 → NoteGen 縮小/還原跟隨 →
  切離模式即隱藏 → 關 NoteGen 子程序一起結束。
- Win32 視窗邏輯難以單元測試,以手動驗收 + log 為主;前端 store 變更補 vitest。

## 已否決方案(do NOT re-propose)

- CEF Views 嵌入(工具列畫不出,三輪調查未解)
- noVNC / Docker、CDP screencast、Tauri WebView2
- 打包 CloakBrowser(授權禁止再散布)
- 自製 React URL bar / 任何 NoteGen 端 browser chrome UI
- `SetParent` WS_CHILD 父子嵌入(雙工作列圖示等問題;owner 手法不同,已驗證無此問題)

## 未來工作(本次不做)

- 與筆記擷取整合:`--remote-debugging-port`(CDP)抓頁面內容 → 後續里程碑
- 清除 SQLite 舊 browser 表
- macOS / Linux 支援
- GPU/SwiftShader 相關處理(子程序模式下 Chromium 自行管理 GPU,預期不需要)
