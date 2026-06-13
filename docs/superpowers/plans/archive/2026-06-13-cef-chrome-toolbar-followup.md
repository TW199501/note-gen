# CEF 原生 Chrome 工具列 — 收尾計畫（重寫 2026-06-13）

**狀態：** 修正版。本次重寫**移除上一版的 Task 1.3「自製 React URL bar fallback」**，回到原始 spec（`docs/superpowers/specs/2026-06-12-cef-chrome-ui-and-novnc-cleanup-design.md`）規定的單一交付軸：原生 Chromium 瀏覽器，NoteGen 不畫任何 browser chrome。

## 遷移背景

NoteGen 的內嵌瀏覽器原本是 **noVNC + CloakBrowser-Manager（Docker sidecar）** —— 在 docker 容器內跑 stealth Chromium，把畫面用 KasmVNC 串流出來、用 `@novnc/novnc` 在 React 裡渲染 canvas。優點：stealth、native input；缺點：強制 Docker 依賴，普通使用者裝不起來，bundle 多 200MB+。

2026-06-10 改換為 **CEF (Chromium Embedded Framework) + Views path + Chrome runtime** —— 直接在 NoteGen 進程內嵌完整 Chromium，把 Chrome 的工具列、分頁、選單、DevTools、find-in-page、縮放、書籤通通由 Chromium 自己畫，**NoteGen 不寫任何 browser chrome React UI**。

noVNC 整套（`browser_sidecar.rs`、`browser-host.tsx`、`browser-vnc.tsx`、`manager-client.ts`、`@novnc/novnc`、`docker/cloakbrowser-manager/` 等）已在 commit `6ed9b5f9` 完整刪除。

## 不可妥協的設計前提

從原 spec 復述（並重申本計畫不放棄）：

1. **NoteGen ships ZERO browser-chrome React UI.** 不寫 URL bar、不寫分頁列、不寫上下一頁按鈕、不寫任何 Chrome runtime 本來就提供的東西。
2. **使用者看到的 = Chromium 原生的 Chrome UI**，由 CEF Views compositor 畫，不是 React DOM。
3. 「也許 CEF 在我們這種嵌入模式下畫不出工具列」**不是可接受結論**，除非已經把 CEF C++ source（`cef_browser_view.h` / `cef_window.h` / Chrome runtime 初始化路徑）全讀過、把每個 Settings 欄位跟 cefsimple 一條一條 diff 過，並有具體文獻證明它就是不行。

## 目前進度（commit-level）

```
HEAD = 29307bc1 (feat/browser-novnc)
分支:
  claude/cef-toolbar-investigation  @ 5b2838c2  Recommendation A 已 commit, 未驗
  claude/cef-custom-toolbar-fallback @ 8cc14820  (廢棄，僅 research archive)
```

**已驗證可運作：**
- CEF 子程序、`init_cef`、`on_context_initialized` 在 TID_UI fire
- `browser_view_create` 成功、`window_create_top_level` 成功
- Window `promote_to_overlay` 接到 NoteGen 的 GWLP_HWNDPARENT，跟著 minimize/restore，無獨立 taskbar 圖示
- `cef_overlay_show/hide/set_panel_rect` 配合 `workspaceMode` 工作
- Google.com 渲染、滑鼠點擊可進入頁面
- GPU：SwiftShader workaround 啟用（locked-session / virtualised GPU 環境需要）

**未交付：**
- **原生 Chrome 工具列（URL bar / 分頁 / 上下一頁 / 三點選單）並未在 overlay 內繪出。** 頁面有畫、OS 標題列有、Chrome chrome 沒有。這是遷移的唯一未完成項目。

## Hypothesis 追蹤（2026-06-13 session）

| # | Hypothesis | 狀態 | Commit |
|---|------------|------|--------|
| (a) | `GWLP_HWNDPARENT` reparenting 破壞 Chrome runtime 的 toolbar paint | **ELIMINATED** | `ac6c4a51`（skip reparent 測試，toolbar 仍不出現） |
| (b) | 缺 cefsimple 的 delegate methods（`preferred_size`/`can_close`/`initial_show_state`） | UNTESTED（commit 後我沒視覺驗） | `29307bc1` |
| (c) | `add_child_view` 不是正確的 attach API | **FALSIFIED** | 研究報告 `investigation-hypothesis-c.md`；它**是**正確 API |
| Recommendation A | 拿掉顯式 `RuntimeStyle::CHROME` overrides，回 default | UNTESTED | `5b2838c2` |
| Recommendation B | 拿掉 `multi_threaded_message_loop = 1` + 起獨立 thread 跑 `run_message_loop` | UNTRIED | — |
| Recommendation C | 暫時禁用 SwiftShader（純診斷） | UNTRIED | — |
| Further | 重讀 CEF C++ source（`cef_main_process_impl`、Chrome runtime init path）找精確條件 | UNTRIED | — |

## Task 1 — 驗 Recommendation A

`claude/cef-toolbar-investigation` 已就緒。使用者跑：

```bash
cd /e/source/note-gen-cef-investigation
export CEF_PATH="$USERPROFILE/.local/share/cef"
export PATH="$CEF_PATH:$PATH"
export CMAKE_MAKE_PROGRAM="/c/Program Files/Microsoft Visual Studio/18/Insiders/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe"
pnpm tauri dev
```

點 Globe → browser mode → CEF 區頂部**有 / 沒** URL bar 與分頁。

- 有 → 跳 Task 4 收尾。
- 沒 → Task 2。

## Task 2 — 套 Recommendation B（A 失敗才做）

拿掉 `multi_threaded_message_loop = 1`，改用 cefsimple 走的路徑：

- `init_cef()` 的 `Settings` drop `multi_threaded_message_loop`
- 起獨立 thread 跑 `run_message_loop()`，shutdown 時 `quit_message_loop()`
- 確認 `on_context_initialized` 仍在 CEF UI thread fire（CEF UI thread 變成是這條獨立 thread）
- `post_task(ThreadId::UI, ...)` 仍可路由 work

技術細節：

```rust
// init_cef 後不要立刻 return，而是：
std::thread::spawn(|| {
    run_message_loop();
});
```

`shutdown_cef()` 改成先 `quit_message_loop()` 等 thread 結束、再呼叫 `shutdown()`。

Commit、push、再請使用者測一次。

## Task 3 — A + B 都失敗時的深掘

不再嘗試「降級到自製 UI」。改方向是：

1. **讀 CEF C++ source 找 Chrome runtime 初始化的精確條件**：
   - `~/.local/share/cef/include/internal/cef_main_runner_handler.h`
   - `~/.local/share/cef/include/views/cef_browser_view.h`（特別是 `GetChromeToolbar` 的實作前提）
   - CEF source mirror（`bitbucket.org/chromiumembedded/cef`）裡 `libcef/browser/chrome/` 路徑下的所有檔案
2. **逐欄位 diff cefsimple `Settings` vs ours**：列出 `Settings` 的每一個欄位，記錄 cefsimple 用什麼值、我們用什麼值、語意是否相同
3. **diff `BrowserSettings`**（給 `browser_view_create` 的第三個參數）
4. **加 `--log-severity=verbose` 跟 `--enable-logging`** 看 CEF 自己 log 什麼
5. **跑 cefsimple 本人**（已驗 `cargo run --example cefsimple` 可在 `E:\source\cef-rs\examples\cefsimple\`） 跟我們 NoteGen 對照，**確認 cefsimple 真的有畫出 Chrome 工具列**（投資前先驗證假設）

完成後，把找到的「正確條件」套進我們的 code，再驗。

不設「最後手段」—— 因為 Chrome runtime + Views = 原生 toolbar 是 CEF 文件白紙黑字承諾的，找不出來代表我們功課還沒做完，不代表它不可能。

## Task 4 — 工具列繪出後的收尾

只有 Task 1 / 2 / 3 任一階段把原生 toolbar 畫出來才執行。

1. **合 branch**：
   - 把成功的 commit cherry-pick / merge 進 `feat/browser-novnc`
   - 把 `claude/cef-toolbar-investigation` 砍掉（或留 archive）
   - 把 `claude/cef-custom-toolbar-fallback` 砍掉（archive 沒用，是錯誤方向）
2. **改 branch 名**：`feat/browser-novnc` 已不含 noVNC → 重新命名成 `feat/browser-cef`（local + remote）
3. **發 PR**：`gh pr create` 對 `main`
4. **更新 CLAUDE.md**：
   - In-app Browser section 拿掉 "work-in-progress" 標籤
   - Pending 拿掉「工具列未畫」項目
   - 加進「使用者驗證日期 + 視覺截圖位置」
5. **更新 memory file** `project_notegen_cef_spike.md`：把 status 從 "broken: toolbar missing" 改成 "fully delivered"

## 仍然 pending 的 CEF spike 收尾項（與 toolbar 獨立）

| 項目 | 描述 | 時機 |
|------|------|------|
| crates.io / vendor cef-rs | `../../cef-rs/cef` path dep 是 spike 用，發行版要換 | Task 4 之後或併行 |
| Bundle CEF runtime | `tauri.conf.json::bundle.resources` 列入 `libcef.dll` + `*.pak` + `icudtl.dat` + `locales/` | Task 4 之後（packaging 必要） |
| GPU probe-and-disable | 在 init_cef 時試一次無 SwiftShader、crash 才 fallback；目前 SwiftShader 寫死等於放棄 HW video decode | Task 4 之後（非阻擋） |

## 明確排除（do NOT re-propose）

- **自製 React URL bar / 任何 NoteGen-side browser chrome UI**。原 spec 的 "ZERO browser-chrome React UI" 是硬性需求，本次重寫重申。`claude/cef-custom-toolbar-fallback` branch 是錯誤方向的歷史紀錄，不是備案。
- **混合方案**（原生工具列 + 自製補強）—— 同樣違背 "ZERO React chrome" 原則。
- **「ship 部分功能就好」的妥協** —— Chrome runtime 提供全套 UI，少一樣都是未完成。
- **回去用 noVNC / WebView2 / CDP screencast** —— 原 spec 的 Rejected approaches 全部仍然有效。

## 與原 spec 的對應

| 原 spec 規定 | 本計畫對應 |
|--------------|------------|
| "NoteGen ships ZERO browser-chrome React UI" | Task 3 不放棄、不降級 |
| "Native Chrome UI ... painted by Chromium itself" | 全部 hypothesis / Recommendation 都對準此目標 |
| noVNC stack deletion | 6ed9b5f9 已完成 |
| CEF Views + Chrome runtime | Task 1-3 確認此架構真的把原生 UI 畫出來 |
| 起始 URL = google.com | `app_setup.rs:32-38` 已對 |

## 上一版 follow-up plan 為何被取代

上一版（同檔名，於本日稍早寫）有 **Task 1.3「Build custom React URL bar fallback」**，違背原 spec 的「ZERO browser-chrome React UI」前提。在使用者明確指出後（兩次：先「強調是加載原生的 Chromium」、再「為何要自己畫」），本版**完整移除 fallback 路徑**，所有未來 task 軸只對準原生 Chrome UI 畫出來這一個交付定義。
