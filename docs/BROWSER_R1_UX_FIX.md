# 內建瀏覽器 R1 UX 修復計畫

> 最後更新：2026-05-15
> 範圍：修補 R1（多分頁）首次體驗、開新分頁與 `target=_blank` 行為
> 對應程式碼：`src-tauri/src/browser.rs`、`src/app/core/main/browser/browser-webview.tsx`、`src/app/core/main/browser/tab-strip.tsx`
> 相關文件：`docs/BROWSER_WEBVIEW_SPEC.md`（R1 規格）、`docs/POST_R1_BACKLOG.md`（後續計畫）

---

## Context

PR #5 合入 R1 phase 1+2（多分頁 data layer + 真 per-tab WebView），但實測發現首次體驗有三個破口：

1. 打開瀏覽器面板**不會自動載入首頁**，需要使用者主動在網址列輸入 URL 按 Enter 才會 spawn webview。
2. 在 webview 還沒 spawn 期間，標題列的「擷取文字」/「截圖」按鈕仍可被點，按了就 throw `[Browser] Failed to extract text: "Browser not created"`，Next.js dev overlay 把錯誤跳出來。
3. 網頁中的 `<a target="_blank">` 與 `window.open()` 目前被注入腳本**強制改成 same-window 導航**（`browser.rs:325-365`），點外連結不會開新分頁，跟一般瀏覽器體驗不一致。

這些都是 R1 完成度問題，非 PR #5 引入的回歸，也不在現有 `UPGRADE_PLAN.md` 或 `BROWSER_WEBVIEW_SPEC.md` 的待後續清單。本文件聚焦修這三點，以便 R1 首版 UX 站得住。

---

## Problem Statement

NoteGen 內建瀏覽器目前的首次體驗對非開發者使用者來說無法直接上手 —— 打開瀏覽器面板看到空白畫面、按工具列按鈕看到紅色錯誤、點網頁中的外連結沒反應或跳同分頁。使用者期望的是「打開就是首頁、旁邊有 +、點外連結會開新分頁」，跟 Safari/Chrome/Edge 等一致。

---

## Expected Behavior

依使用者描述整理為驗收基準：

1. **B1**：切換到瀏覽器模式 → 立刻看到首頁網頁載入（`browserHomepage` 設定值，預設 Google）。
2. **B2**：第一個分頁旁邊立刻看得到「+」按鈕。Tab strip 永遠至少有一個 tab 與一個 +。
3. **B3**：按「+」→ 開新分頁，分頁停在首頁。使用者可在網址列輸入新網址。
4. **B4**：在任一網頁點 `<a target="_blank">` 連結 → 開新分頁載入該 URL，當前分頁不變。
5. **B5**：在任一網頁中鍵點擊連結，或按住 Ctrl/Cmd 點連結 → 開新分頁。
6. **B6**：點普通連結（無 target 或 `target="_self"`）→ 同分頁導航，行為與既有一致。
7. **B7**：B1–B6 完整流程中 console 不能出現 `[Browser] Failed to extract text: "Browser not created"`。

---

## Non-Goals

避免 scope creep，下列**不在**本次修復範圍：

1. **不加 Cmd+T / Ctrl+T 鍵盤 shortcut** —— 使用者描述沒提，留 backlog。
2. **不改新分頁起始頁** —— 沿用 `browserHomepage` 設定（一般瀏覽器是「新分頁頁」可顯示書籤，但這需要另外設計）。
3. **不重寫 webview builder factory** —— 見 Risk M3「第二個分頁注入腳本 inherit limitation」。本次接受 MVP 行為。
4. **不修「擷取文字」按鈕的 readiness gating** —— 廢 lazy-mount 後 webview 一定 ready，原 bug 自然消失。後續若要更穩可加 `disabled={!browserReady}`，但本次不動以縮小 diff。
5. **不移除 `browserAutoOpen` store flag** —— 步驟 1 後此 flag 永遠是 `true`，已成 dead code，但清除散落在 5 個 component 的 setter 屬 cleanup 工項，可後續單獨做。

---

## Implementation Plan

### 步驟 1 — Rust 端：新增 `__browser_open_in_new_tab` wrapper

注入腳本只能呼 `__browser_*` 系列 invoke（受 `browser-bridge.json` capability 限制）；`browser_tabs_new` 不在 allow list。所以需要一個薄 wrapper。

**檔案**：`src-tauri/src/browser.rs`，加在現有 `__browser_*` 命令區塊（約 line 763–809，跟 `__browser_content_extracted`、`__browser_find_state` 等並列）。

```rust
/// Invoked from injected page script when a `target=_blank` link, middle-click,
/// Ctrl/Cmd-click, or window.open() needs to spawn a new tab. Thin wrapper over
/// `browser_tabs_new` so injected JS can reach it through browser-bridge cap.
#[tauri::command]
pub async fn __browser_open_in_new_tab(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    url: String,
) -> Result<(), String> {
    browser_tabs_new(app, state, Some(url)).await.map(|_id| ())
}
```

**註冊**：在 `src-tauri/src/lib.rs` 的 `tauri::generate_handler![...]` 區塊加入 `browser::__browser_open_in_new_tab`。

> Skill note (tauri-v2)：忘了註冊會 silently fail —— invoke 端只會看到「Command __browser_open_in_new_tab not found」。

### 步驟 2 — 改寫注入腳本：攔截 emit 改開新分頁

**檔案**：`src-tauri/src/browser.rs:325–365`（第一段 `.initialization_script(...)` 區塊）

**整段替換為**：

```rust
.initialization_script(r#"(function(){
    if (window.__notegenNewTabPatched) return;
    window.__notegenNewTabPatched = true;

    function openInNewTab(url) {
        if (!url) return;
        try {
            window.__TAURI_INTERNALS__.invoke('__browser_open_in_new_tab', { url: String(url) });
        } catch(e) {}
    }

    // (a) window.open() → 新分頁
    window.open = function(url) {
        openInNewTab(url);
        return null;
    };

    // (b) 點擊 anchor：target=_blank、中鍵、Ctrl/Cmd+click 都開新分頁
    document.addEventListener('click', function(e) {
        var a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href || href.indexOf('javascript:') === 0 || href.charAt(0) === '#') return;
        var url;
        try { url = new URL(href, location.href).href; } catch(_) { return; }

        if (e.button === 1 || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            openInNewTab(url);
            return;
        }
        if (a.getAttribute('target') === '_blank') {
            e.preventDefault();
            openInNewTab(url);
            return;
        }
        // 其他：保留同分頁導航
    }, true);

    // (c) auxclick：某些 WebView 只在 auxclick 觸發中鍵
    document.addEventListener('auxclick', function(e) {
        if (e.button !== 1) return;
        var a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        var href = a.getAttribute('href');
        if (!href) return;
        try {
            openInNewTab(new URL(href, location.href).href);
            e.preventDefault();
        } catch(_) {}
    }, true);
})();"#)
```

**關鍵差異與既有腳本對比**：

| 行為 | 既有腳本 (line 325–365) | 新腳本 |
|---|---|---|
| `window.open(url)` | 改 `location.href = url`（強制 same-window） | 改呼 `__browser_open_in_new_tab`（開新分頁） |
| `<a target="_blank">` | DOM mutation 移除 `target` 屬性 + `MutationObserver` 監視新加 anchor | 不動 DOM；用 capture-phase click listener 攔截 |
| 中鍵點擊 | 不處理 | 攔截開新分頁 |
| Ctrl/Cmd+click | 不處理 | 攔截開新分頁 |
| 普通連結（無 target） | 同分頁導航 | 同分頁導航（保留） |

`window.__notegenSameWindowPatched` flag 改名為 `window.__notegenNewTabPatched` 以反映新行為。

### 步驟 3 — 前端：廢掉 lazy-mount

**檔案**：`src/app/core/main/browser/browser-webview.tsx:60–87`

刪除 line 64 的 lazy-mount gate：

```diff
   if (!containerRef.current) return
-  // Lazy-mount gate：browserAutoOpen=false 時不自動 spawn 子 WebView，
-  // 避免啟動就出現 about:blank#blocked 的空白視窗（v1.0.7 行為）。
-  // 使用者可呼叫 useBrowserStore.getState().setBrowserAutoOpen(true) 啟用。
-  if (!browserAutoOpen) return
   const rect = containerRef.current.getBoundingClientRect()
```

把 line 14 的 destructure 移除 `browserAutoOpen`：

```diff
- const { browserReady, setBrowserReady, ..., browserAutoOpen, ... } = useBrowserStore()
+ const { browserReady, setBrowserReady, ..., ... } = useBrowserStore()
```

把 line 231 的 effect dependency 從 `[browserAutoOpen]` 改為 `[]`（或留必要 deps）。

**保留**：line 78–84「seed first tab」邏輯不動。`browser_create` 第 73 行的 `url: browserHomepage` 不動 —— 這確保不會走到 `about:blank#blocked` 的歷史 bug。

### 步驟 4 — 前端：Tab strip 0 tabs 時也顯示

**檔案**：`src/app/core/main/browser/tab-strip.tsx:75–77`

刪除：

```diff
- // Hide the strip entirely until the first tab exists — keeps the chrome
- // minimal for users who never use multi-tab.
- if (tabs.length === 0) return null
```

搭配步驟 3，實際上 `tabs.length` 不會是 0（webview create 後立刻 seed 第一個 tab），但拆掉這條保險邏輯讓 strip 在所有狀態下都可見、未來也不會再因 0 tabs 隱身。

---

## Order Rationale

| 順序 | 步驟 | 為何這個順序 |
|---|---|---|
| 1 | 步驟 1（Rust wrapper + handler 註冊） | 先有 sink 才有人接 emit。否則步驟 2 寫好 invoke 也會 silently fail（skill 提醒）。 |
| 2 | 步驟 2（改注入腳本） | Rust wrapper 在，注入腳本才有對象可呼。 |
| 3 | 步驟 3（廢 lazy-mount） | 前面兩步都是 webview 內部行為，跟 mount 時機解耦。最後做避免 mid-state 干擾測試。 |
| 4 | 步驟 4（拆 tab strip 隱藏） | 純前端 1 行 diff，最後順手做。 |

每一步可獨立 `pnpm tauri dev` 驗證，發現問題立刻單步回退。

---

## Risk Mitigation

### M1：歷史 `about:blank#blocked` bug 復發

**風險**：v1.0.7 之前 `browser_create` 啟動時若 URL 為空會顯示 `about:blank#blocked` 空白頁，PR 內某次重構引入 lazy-mount flag 來繞過。

**緩解**：`browser_create` 第 73 行的 `url: browserHomepage` 確保啟動帶有合法 URL，永遠不會走到 `about:blank`。`browserHomepage` 在設定預設值為 `https://www.google.com`（見 `src/stores/setting.ts`）。驗證手段：步驟 3 完成後跑 `pnpm tauri dev` 確認首次啟動進到 Google 而非空白頁。

### M2：BrowserPanel 啟動成本

**風險**：廢 lazy-mount 後，BrowserPanel 一 mount 就立刻 spawn webview，可能讓「不用瀏覽器的使用者也付出記憶體成本」。

**緩解**：BrowserPanel 在 `src/app/core/main/page.tsx:361` 是條件渲染 —— 只有切到「Browser mode」才 render。使用者一直停在筆記模式不會碰到 webview spawn。所以此風險不存在。

### M3：MVP limitation —— 新分頁尚未繼承注入腳本

**風險**：`browser.rs:1062–1065` 註解寫明：

> MVP limitation: new tabs do not yet inherit the same initialization_scripts (find-in-page, zoom override, same-window patch) and on_page_load handlers as the first tab. Phase 2b will extract `browser_create`'s ~300-line builder config into a reusable factory so every tab gets full feature parity.

也就是：使用者在第一個分頁點 `target=_blank` 連結 → 正確開新分頁（步驟 2 已掛上腳本）。但在**第二個以後的分頁**裡再點 `target=_blank` 連結 → **新分頁本身沒有注入腳本**，行為退化到 WebView 預設（可能會被 `wry` 直接同分頁導航或彈出新視窗，行為不確定）。

**緩解**：

1. 接受 MVP limitation，本次不修。理由：phase 2b 抽 builder factory 工作量 ~300 行重構，超出本次 1 天估時。
2. 在 `POST_R1_BACKLOG.md` 加註此 limitation，待 phase 2b 一併解。
3. UI 文案上不誤導使用者「所有分頁完全等效」。
4. 若 phase 2b 在 Q3 前未動工，再評估補丁路徑（最小 patch：在 `browser_tabs_new` 內為新 webview 也注入同樣腳本，但這需要小心字串複用以免維護兩份）。

### M4：注入腳本攔截太積極導致網站壞掉

**風險**：用 capture-phase click listener 攔截所有 anchor 點擊，可能跟某些 SPA（自己 hijack click 做 client-side routing）衝突。

**緩解**：

1. 只在 `e.button === 1 || e.ctrlKey || e.metaKey || a.target === '_blank'` 時 `preventDefault()`；其他情況 listener 提前 `return`，不干擾頁面 handler。
2. 排除 `javascript:` 與 `#` 起頭的 href（不開新分頁）。
3. 用 capture phase（`addEventListener(..., true)`）只是為了在頁面 handler 之前看到事件，並不會搶走頁面 handler —— 我們不 `stopPropagation`。
4. 驗證對象至少包含：Google 搜尋結果頁、GitHub repo、Twitter（SPA）、Wikipedia（傳統 server-rendered）。

### M5：注入腳本與既有 R4/R6 腳本衝突

**風險**：`browser.rs:372`（find-in-page）、`browser.rs:506` 附近（zoom）有其他 `.initialization_script(...)`。它們各自有 `__noteGenXxxPatched` flag 防重入。

**緩解**：新腳本用獨立 flag `__notegenNewTabPatched`，不會跟 `__noteGenFindPatched`、`__noteGenZoomPatched` 衝突。重新命名 flag 後跟舊腳本（`__notegenSameWindowPatched`）也不共用 namespace，舊腳本走完不會被重複註冊。

---

## Verification Checklist

`pnpm tauri dev` 啟動後依序檢查：

- [ ] **B1**：切到瀏覽器模式 → 直接顯示 Google 首頁，**console 無** `[Browser] Failed to extract text: "Browser not created"` 錯誤。
- [ ] **B2**：tab strip 立刻顯示，含 1 個 tab + 1 個 "+" 按鈕。
- [ ] **B3**：點 "+" → 出現第二個 tab，URL 為 `browserHomepage`，第一個 tab 內容不變。
- [ ] **B4**：Google 搜尋「openai」，點第一個結果（通常 `target="_blank"`）→ 開**新分頁**載入該 URL，搜尋結果頁仍是第一個 tab。
- [ ] **B5**：在 Wikipedia 任一條目中鍵點連結 → 開新分頁；Cmd/Ctrl + 左鍵點連結 → 開新分頁。
- [ ] **B6**：在 Wikipedia 條目點普通內部連結 → **同分頁導航**（不要每點都變新分頁）。
- [ ] **B7**：B1–B6 全程 console 乾淨（無 ERR、無 warning）。
- [ ] **回歸 R4**：Cmd+F 仍正常開啟 find-in-page。
- [ ] **回歸 R6**：Cmd+= / Cmd+- 仍正常縮放。
- [ ] **回歸 R8**：右鍵 DevTools toggle 仍正常。
- [ ] **回歸 R2**：在 GitHub 下載一個檔案，Downloads drawer 仍正常記錄。
- [ ] **單元測試**：`pnpm test:run` 全綠（特別是 `src/lib/browser/*.test.ts` 與 `src/stores/browser.test.ts`）。
- [ ] **E2E**：`PLAYWRIGHT_HEADLESS=1 pnpm e2e` 全綠（特別是 `error-audit.spec.ts` 不能因新加 listener 引入 warning）。
- [ ] **Rust 編譯**：`cd src-tauri && cargo check` 全綠。
- [ ] **Lint**：`pnpm lint` 全綠。

**已知會壞掉的測試**（需要更新）：

- `src/stores/browser.test.ts` 若有針對 `browserAutoOpen` 的測試，因 store 行為改變需更新斷言。但 flag 本次不移除，store shape 不變，理論上測試會通過。

---

## Estimated Effort

- 步驟 1（Rust wrapper + 註冊）：0.25 天
- 步驟 2（改寫注入腳本）：0.5 天，含跨網站驗證
- 步驟 3（廢 lazy-mount）：0.25 天
- 步驟 4（拆 tab strip 隱藏）：0.05 天
- 驗證清單（B1–B7 + 4 條回歸 + 編譯/lint/test/e2e）：0.5 天

**合計約 1.5 天**（一位工程師）。Critical path：步驟 1 → 步驟 2 → 步驟 3，三者必須依序；步驟 4 可任何時間插入。

---

## Future Work（不在本次範圍）

- **Phase 2b**：把 `browser_create` 的 builder config 抽成 reusable factory，新分頁繼承完整注入腳本與 on_page_load handler。對應 `browser.rs:1062–1065` 的 MVP limitation。
- **A9 entrypoints 與 readiness**（候選加入 `POST_R1_BACKLOG.md`）：Cmd+T shortcut、「在新分頁開啟連結」右鍵選單、`title-bar-browser.tsx` 按鈕的 readiness gating。
- **新分頁頁設計**：取代目前的「直接載入 homepage」，做一個內建的「新分頁頁」顯示常用書籤 / 最近瀏覽。
- **`browserAutoOpen` flag 清除**：步驟 3 後此 flag 永遠為 true，可從 `stores/browser.ts:27,105,106` 與 5 個 setter 呼叫點全部移除。
