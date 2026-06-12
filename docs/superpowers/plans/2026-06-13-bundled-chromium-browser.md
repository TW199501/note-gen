# NoteGen 打包 Chromium 實體瀏覽器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 NoteGen 內建瀏覽器換成「打包一份完整 ungoogled-chromium、以子程序啟動 chrome.exe(自帶全套原生 Chrome UI)、用 owner 視窗手法貼進瀏覽器面板」的實體瀏覽器。

**Architecture:** 沿用 CEF 時代已驗證的 owner-overlay 視窗整合(`GWLP_HWNDPARENT` = NoteGen HWND → 無工作列圖示、跟隨縮放/還原;`SetWindowPos` 貼面板矩形;top-level owned 視窗才能畫在 DirectComposition 的 WebView2 之上),但瀏覽器本體從「CEF 函式庫嵌入」改為「完整 chrome.exe 子程序」——UI 不再需要自己組,Chromium 原生全套(網址列/分頁/選單/DevTools)直接到手。

**Tech Stack:** Tauri 2 (Rust) + raw Win32 FFI(不經 `windows` crate,version-proof)、ungoogled-chromium 149.0.7827.53-1.1(BSD,可再散布)、Next.js 15 前端佔位 panel。

**Spec:** `docs/superpowers/specs/2026-06-13-bundled-chromium-browser-design.md`

---

## 執行環境與前提

- **Worktree:** `E:\source\note-gen\.claude\worktrees\browser-chromium`,分支 `feat/browser-chromium`(基於 main @ `81a55df0`)。所有 task 在此執行。
- **舊分支 `feat/browser-novnc` 在 Task 7 之前不可刪**——Task 1 要從它 checkout 數個檔案(該分支已完成「移除舊 WebView 堆疊」的驗證版本)。
- **LF only:** 每次 commit 前驗 `file <changed files> | grep CRLF`(全域硬規則)。
- Windows-only 功能,全部 Rust 程式碼 `#[cfg(target_os = "windows")]`。
- main 上沒有 CEF 程式碼(CEF 只存在於舊分支),所以本分支**不需要** `CEF_PATH` 等環境變數,`cargo check` 直接可跑。

## File Structure(全貌)

```
刪除(Task 1):
  src/app/core/main/browser/{bookmark-bar,bookmark-drawer,browser-drawer,
    browser-nav-bar,browser-status-bar,browser-webview,downloads-drawer,
    find-bar,history-drawer,tab-strip}.tsx        ← 舊 WebView 瀏覽器 React UI
  src/components/title-bar-browser.tsx
  src-tauri/src/browser.rs                         ← 舊 WebView 命令(1432 行)
  src-tauri/capabilities/browser-bridge.json
  e2e/browser-ui.spec.ts                           ← 測舊 UI
  e2e/google-ua-verify.spec.ts                     ← 測舊 browser.rs 的 UA,已無意義

自舊分支 checkout(Task 1;「移除舊堆疊」的已驗證最終狀態):
  src/app/core/layout.tsx                          ← browser mode 頂天佈局
  src/app/core/main/page.tsx                       ← workspaceMode 切換 wiring(再改 invoke 名)
  src/components/title-bar.tsx                     ← browser mode 縮成右上控制島
  src/components/app-context-menu.tsx              ← execCommand callback void 修正
  src-tauri/src/lib.rs                             ← 純移除 browser 的版本(mobile entry)

新增:
  scripts/fetch-chromium.mjs                       ← Task 2:下載/解壓/攤平 chromium
  src-tauri/src/browser_chromium.rs                ← Task 3:launch/探測/promote/show-hide
  src-tauri/tauri.windows.conf.json                ← Task 5:bundle.resources 加 chromium
  src-tauri/chromium/                              ← gitignored,fetch 腳本產物

修改:
  src-tauri/src/main.rs                            ← Task 1 刪 browser;Task 3 註冊 chromium
  src/app/core/main/browser/index.tsx              ← Task 1 佔位;Task 4 換正式版
  e2e/tauri-mock.ts                                ← Task 4:browser_* mocks → chromium_*
  package.json                                     ← Task 2:fetch-chromium script
  .gitignore                                       ← Task 2:/src-tauri/chromium/
```

---

### Task 1: 清除舊 WebView 瀏覽器堆疊

**Files:**
- Delete: 上表「刪除」全部 16 檔
- Checkout from `feat/browser-novnc`: 上表 5 檔
- Modify: `src-tauri/src/main.rs`、`src/app/core/main/page.tsx`
- Create: `src/app/core/main/browser/index.tsx`(暫時佔位版)

- [ ] **Step 1: git rm 舊檔案**

```bash
git rm src/app/core/main/browser/bookmark-bar.tsx \
       src/app/core/main/browser/bookmark-drawer.tsx \
       src/app/core/main/browser/browser-drawer.tsx \
       src/app/core/main/browser/browser-nav-bar.tsx \
       src/app/core/main/browser/browser-status-bar.tsx \
       src/app/core/main/browser/browser-webview.tsx \
       src/app/core/main/browser/downloads-drawer.tsx \
       src/app/core/main/browser/find-bar.tsx \
       src/app/core/main/browser/history-drawer.tsx \
       src/app/core/main/browser/tab-strip.tsx \
       src/components/title-bar-browser.tsx \
       src-tauri/src/browser.rs \
       src-tauri/capabilities/browser-bridge.json \
       e2e/browser-ui.spec.ts \
       e2e/google-ua-verify.spec.ts
```

注意:**保留** `src/stores/browser.ts`、`src/stores/browser-chat.ts`、`src/db/bookmarks.ts`、`src/db/browser-history.ts`、`src/db/downloads.ts`(workspaceMode 狀態與 DB 表仍在使用;清 DB 表是 spec 明定的後續獨立工作)。

- [ ] **Step 2: 從舊分支 checkout「移除舊堆疊」的已驗證版本**

```bash
git checkout feat/browser-novnc -- \
  src/app/core/layout.tsx \
  src/app/core/main/page.tsx \
  src/components/title-bar.tsx \
  src/components/app-context-menu.tsx \
  src-tauri/src/lib.rs
```

`lib.rs` 在舊分支 = main 版本純移除 browser(無 CEF 內容),可直接用。

- [ ] **Step 3: page.tsx 把 CEF 命令名換成 chromium**

`src/app/core/main/page.tsx` 內找到(workspaceMode useEffect 中):

```ts
    } else if (platform() === 'windows') {
      invoke('cef_overlay_hide').catch(() => { /* CEF not initialized on this platform / not yet promoted */ })
    }
```

改為:

```ts
    } else if (platform() === 'windows') {
      invoke('chromium_hide').catch(() => { /* chromium not launched yet / non-windows */ })
    }
```

同一個 useEffect 上方的中文註解把「CEF overlay」字樣改成「Chromium overlay」、「cef_overlay_hide」改「chromium_hide」、「BrowserPanel mount 時自己上報 rect + show」語意不變。

- [ ] **Step 4: main.rs 移除舊 browser 模組**

`src-tauri/src/main.rs`(main 版本)刪除以下內容:

1. `mod browser;`(約 line 16)
2. 整個 `use browser::{ ... BrowserState, };` 區塊(約 lines 27–38)
3. `.manage(BrowserState::new())`(約 line 53)
4. `generate_handler![...]` 裡全部 35 個 browser 項目:`browser_create`, `browser_navigate`, `browser_go_back`, `browser_go_forward`, `browser_reload`, `browser_show`, `browser_hide`, `browser_resize`, `browser_extract_text`, `browser_capture`, `browser_get_url`, `browser_get_title`, `browser_get_selected_text`, `browser_clear_data`, `browser_inject_context_menu`, `browser_toggle_devtools`, `browser_set_zoom`, `__browser_zoom_changed`, `browser_find_start`, `browser_find_next`, `browser_find_prev`, `browser_find_close`, `__browser_find_state`, `__browser_find_requested`, `browser_tabs_list`, `browser_tabs_new`, `browser_tabs_switch`, `browser_tabs_close`, `browser_tabs_update_meta`, `__browser_content_extracted`, `__browser_title_changed`, `__browser_favicon_changed`, `__browser_context_action`, `__browser_title_result`, `__browser_selected_text`

- [ ] **Step 5: index.tsx 換成暫時佔位版**

`src/app/core/main/browser/index.tsx` 整檔覆寫:

```tsx
'use client'

// 暫時佔位:舊 WebView 瀏覽器 React 堆疊已刪除;打包 Chromium 的後端
// (browser_chromium.rs)在後續 task 落地後,本元件換成上報 rect 的正式版。
export function BrowserPanel() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-neutral-500">
      <span className="text-sm">Browser panel</span>
    </div>
  )
}
```

- [ ] **Step 6: 驗證編譯與測試**

```bash
cd src-tauri && cargo check 2>&1 | tail -5 && cd ..
pnpm lint
pnpm test:run
```

Expected: cargo check 無 error(warning 可,但不應有 browser 相關 unresolved);lint 0 errors;vitest 61 tests pass(stores/db 測試未動)。若 cargo 報出其他檔案引用 `browser::`,以同樣方式移除該引用。

- [ ] **Step 7: LF 檢查後 commit**

```bash
file src/app/core/layout.tsx src/app/core/main/page.tsx src/components/title-bar.tsx src/app/core/main/browser/index.tsx src-tauri/src/main.rs | grep CRLF || echo "LF OK"
git add -A
git commit -m "refactor(browser): remove legacy WebView browser stack

The in-app browser is being replaced by a bundled full Chromium child
process (see spec 2026-06-13). Deletes the React browser-chrome UI
(nav bar, tab strip, drawers), browser.rs (1432 lines of WebView
commands), and the e2e specs that tested them. Keeps stores/db modules
(workspaceMode + tables still in use). Frontend glue files ported from
the validated final state of feat/browser-novnc."
```

---

### Task 2: fetch-chromium 下載腳本

**Files:**
- Create: `scripts/fetch-chromium.mjs`
- Modify: `package.json`(scripts)、`.gitignore`

- [ ] **Step 1: 寫腳本**

`scripts/fetch-chromium.mjs`(注意:解壓用 Windows 10+ 內建的 bsdtar `tar.exe`,它原生支援 zip;攤平一層資料夾讓 `chrome.exe` 落在 `src-tauri/chromium/chrome.exe`,Rust 端解析的就是這個固定路徑):

```js
#!/usr/bin/env node
// 下載固定版本的 ungoogled-chromium 到 src-tauri/chromium/(gitignored)。
// BSD 授權、可自由再散布 — 這是發行版能直接打包的法律前提。
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const VERSION = '149.0.7827.53-1.1'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const destDir = join(root, 'src-tauri', 'chromium')
const versionFile = join(destDir, '.version')

if (existsSync(versionFile) && readFileSync(versionFile, 'utf8').trim() === VERSION
    && existsSync(join(destDir, 'chrome.exe'))) {
  console.log(`chromium ${VERSION} already present at ${destDir}`)
  process.exit(0)
}

const asset = `ungoogled-chromium_${VERSION}_windows_x64.zip`
const url = `https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/download/${VERSION}/${asset}`

rmSync(destDir, { recursive: true, force: true })
mkdirSync(destDir, { recursive: true })
const zipPath = join(destDir, asset)

console.log(`downloading ${url} ...`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`download failed: HTTP ${res.status}`)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(zipPath))

console.log('extracting ...')
// Windows 10 1803+ 內建 bsdtar(tar.exe),原生支援 zip。
execFileSync('tar', ['-xf', zipPath, '-C', destDir], { stdio: 'inherit' })
rmSync(zipPath)

// zip 內容包在單一頂層資料夾 — 攤平,讓 chrome.exe 位於 src-tauri/chromium/chrome.exe。
const entries = readdirSync(destDir).filter((n) => n !== '.version')
if (!existsSync(join(destDir, 'chrome.exe')) && entries.length === 1) {
  const inner = join(destDir, entries[0])
  for (const name of readdirSync(inner)) renameSync(join(inner, name), join(destDir, name))
  rmSync(inner, { recursive: true, force: true })
}

if (!existsSync(join(destDir, 'chrome.exe'))) {
  console.error('chrome.exe not found after extraction — zip layout changed?')
  process.exit(1)
}
writeFileSync(versionFile, `${VERSION}\n`)
console.log(`chromium ${VERSION} ready at ${destDir}`)
```

- [ ] **Step 2: package.json 加 script**

`package.json` 的 `"scripts"` 區塊加一行(放在 `"sync-version"` 附近):

```json
"fetch-chromium": "node scripts/fetch-chromium.mjs",
```

- [ ] **Step 3: .gitignore 加排除**

`.gitignore` 在 `/docs/*/*` 規則附近加:

```
/src-tauri/chromium/
```

- [ ] **Step 4: 跑腳本驗證(下載 177MB,需時數分鐘)**

```bash
pnpm fetch-chromium
ls src-tauri/chromium/chrome.exe && cat src-tauri/chromium/.version
git status --short | head -5
```

Expected: `chrome.exe` 存在、`.version` = `149.0.7827.53-1.1`、git status **不出現** `src-tauri/chromium`(已 ignore)。

- [ ] **Step 5: LF 檢查後 commit**

```bash
file scripts/fetch-chromium.mjs | grep CRLF || echo "LF OK"
git add scripts/fetch-chromium.mjs package.json .gitignore
git commit -m "build(browser): add fetch-chromium script (pinned ungoogled-chromium)

Downloads the redistributable ungoogled-chromium x64 build into
src-tauri/chromium/ (gitignored) and flattens it so chrome.exe sits at
a fixed path for both the dev resolver and bundle.resources."
```

---

### Task 3: browser_chromium.rs 後端模組

**Files:**
- Create: `src-tauri/src/browser_chromium.rs`
- Modify: `src-tauri/src/main.rs`(註冊模組/命令/Exit 清理)

- [ ] **Step 1: 寫模組(整檔)**

`src-tauri/src/browser_chromium.rs`:

```rust
//! Bundled-Chromium in-app browser (Windows-only).
//!
//! 與先前 CEF spike(把 Chromium 當函式庫、用 Views API 自己組 UI、Chrome
//! 工具列始終畫不出來)不同:本模組把打包的完整 Chromium(`src-tauri/chromium/
//! chrome.exe`)以「子程序」啟動。原生 Chrome UI(網址列/分頁/上下頁/選單/
//! DevTools/find/zoom/書籤)是真瀏覽器本來就有的,零成本到手。
//!
//! 視窗整合沿用 CEF overlay 已驗證的 owner 手法:
//! `SetWindowLongPtrW(GWLP_HWNDPARENT) = NoteGen HWND` 讓 Chromium 視窗成為
//! owned top-level(無工作列圖示、跟著 NoteGen 縮放/還原),`SetWindowPos`
//! 貼齊 BrowserPanel 矩形。必須是 top-level owned(不能 WS_CHILD)——Tauri 的
//! WebView2 走 DirectComposition,永遠畫在 sibling child HWND 之上。
#![cfg(target_os = "windows")]

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const START_URL: &str = "https://www.google.com/";
// 隱藏時停放的畫面外座標(CEF 時代沿用值;-32000 在 DPI 放大後仍安全)。
const OFFSCREEN_XY: i32 = -32000;

static CHROME_HWND: AtomicIsize = AtomicIsize::new(0);
static CHILD_PID: AtomicU32 = AtomicU32::new(0);
static LAUNCHING: AtomicBool = AtomicBool::new(false);
static VISIBLE: AtomicBool = AtomicBool::new(false);
static PANEL_X: AtomicI32 = AtomicI32::new(0);
static PANEL_Y: AtomicI32 = AtomicI32::new(0);
static PANEL_W: AtomicI32 = AtomicI32::new(0);
static PANEL_H: AtomicI32 = AtomicI32::new(0);
static CHILD: Mutex<Option<Child>> = Mutex::new(None);

// ---- minimal Win32 (raw FFI; version-proof vs the `windows` crate) ----
#[link(name = "user32")]
extern "system" {
    fn EnumWindows(cb: extern "system" fn(isize, isize) -> i32, lparam: isize) -> i32;
    fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
    fn GetParent(hwnd: isize) -> isize;
    fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
    fn IsWindow(hwnd: isize) -> i32;
    fn IsWindowVisible(hwnd: isize) -> i32;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, val: isize) -> isize;
    fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
}

const GWLP_HWNDPARENT: i32 = -8;
const HWND_TOPMOST: isize = -1;
const SWP_NOACTIVATE: u32 = 0x0010;
const SWP_SHOWWINDOW: u32 = 0x0040;

fn log(msg: &str) {
    let path = std::env::temp_dir().join("notegen_chromium.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(f, "[chromium] {msg}");
    }
}

#[derive(Clone, serde::Serialize)]
struct ChromiumStatus {
    state: String, // "launching" | "ready" | "exited" | "error"
    message: String,
}

fn emit_status(app: &AppHandle, state: &str, message: &str) {
    log(&format!("status: {state} {message}"));
    let _ = app.emit(
        "chromium-status",
        ChromiumStatus { state: state.into(), message: message.into() },
    );
}

/// 解析 chrome.exe 路徑。打包版:resource_dir/chromium/chrome.exe(Task 5 的
/// bundle.resources);開發版:exe 在 src-tauri/target/debug/ → ../../chromium/。
fn chrome_exe_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("chromium").join("chrome.exe");
        if p.exists() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("..").join("..").join("chromium").join("chrome.exe");
            if p.exists() {
                return Some(p);
            }
        }
    }
    None
}

// ---- EnumWindows 探測(以子程序 PID 精準匹配,比 CEF 時代的同進程大海撈針可靠)----
static SEARCH_PID: AtomicU32 = AtomicU32::new(0);
static FOUND_HWND: AtomicIsize = AtomicIsize::new(0);

extern "system" fn enum_cb(hwnd: isize, _lparam: isize) -> i32 {
    if FOUND_HWND.load(Ordering::SeqCst) != 0 {
        return 0;
    }
    let mut pid: u32 = 0;
    unsafe { GetWindowThreadProcessId(hwnd, &mut pid) };
    if pid != SEARCH_PID.load(Ordering::SeqCst) {
        return 1;
    }
    if unsafe { GetParent(hwnd) } != 0 {
        return 1; // 只要 top-level
    }
    if unsafe { IsWindowVisible(hwnd) } == 0 {
        return 1;
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), 64) };
    if len <= 0 {
        return 1;
    }
    let class = String::from_utf16_lossy(&buf[..len as usize]);
    if !class.starts_with("Chrome_WidgetWin") {
        return 1;
    }
    FOUND_HWND.store(hwnd, Ordering::SeqCst);
    0
}

fn find_chrome_window(pid: u32) -> isize {
    FOUND_HWND.store(0, Ordering::SeqCst);
    SEARCH_PID.store(pid, Ordering::SeqCst);
    unsafe { EnumWindows(enum_cb, 0) };
    FOUND_HWND.load(Ordering::SeqCst)
}

/// 依面板矩形貼齊(隱藏中或還沒收到 rect 時 no-op,呼叫端不用 gate)。
fn reposition() {
    let hwnd = CHROME_HWND.load(Ordering::SeqCst);
    if hwnd == 0 || !VISIBLE.load(Ordering::SeqCst) {
        return;
    }
    let (x, y) = (PANEL_X.load(Ordering::SeqCst), PANEL_Y.load(Ordering::SeqCst));
    let (w, h) = (PANEL_W.load(Ordering::SeqCst), PANEL_H.load(Ordering::SeqCst));
    if w <= 0 || h <= 0 {
        return;
    }
    unsafe { SetWindowPos(hwnd, HWND_TOPMOST, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW) };
}

/// 停放到畫面外(保留尺寸,re-show 只需一次 SetWindowPos;頁面狀態不丟)。
fn park_offscreen() {
    let hwnd = CHROME_HWND.load(Ordering::SeqCst);
    if hwnd == 0 {
        return;
    }
    let w = PANEL_W.load(Ordering::SeqCst).max(800);
    let h = PANEL_H.load(Ordering::SeqCst).max(600);
    unsafe { SetWindowPos(hwnd, HWND_TOPMOST, OFFSCREEN_XY, OFFSCREEN_XY, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW) };
}

fn ensure_launched(app: AppHandle, parent: isize) {
    if LAUNCHING.swap(true, Ordering::SeqCst) {
        return; // 已有一個啟動流程在跑
    }
    std::thread::spawn(move || {
        let result = launch_and_promote(&app, parent);
        LAUNCHING.store(false, Ordering::SeqCst);
        if let Err(e) = result {
            emit_status(&app, "error", &e);
        }
    });
}

fn launch_and_promote(app: &AppHandle, parent: isize) -> Result<(), String> {
    let exe = chrome_exe_path(app).ok_or_else(|| {
        "chrome.exe not found — run `pnpm fetch-chromium` (dev) or reinstall NoteGen".to_string()
    })?;
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("browser-profile");
    std::fs::create_dir_all(&profile).map_err(|e| format!("create profile dir: {e}"))?;

    emit_status(app, "launching", "");
    // --window-position 直接讓視窗誕生在畫面外,使用者不會看到它在預設位置閃一下。
    let child = Command::new(&exe)
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg(format!("--window-position={OFFSCREEN_XY},{OFFSCREEN_XY}"))
        .arg(START_URL)
        .spawn()
        .map_err(|e| format!("spawn {}: {e}", exe.display()))?;
    let pid = child.id();
    CHILD_PID.store(pid, Ordering::SeqCst);
    if let Ok(mut guard) = CHILD.lock() {
        *guard = Some(child);
    }
    log(&format!("launched pid={pid} ({})", exe.display()));

    // Chromium 主視窗是非同步建立的;輪詢最多 15 秒。
    // 注意:用獨立 --user-data-dir 啟動的第一個 chrome.exe 程序「就是」browser
    // process(不會 hand-off 給既有實例),所以 PID 匹配可靠。
    let mut hwnd = 0isize;
    for _ in 0..150 {
        hwnd = find_chrome_window(pid);
        if hwnd != 0 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if hwnd == 0 {
        return Err("Chromium main window not found within 15s".into());
    }

    // Owner 手法(CEF overlay 已驗證):owned top-level → 無工作列圖示、
    // 跟隨 NoteGen 縮放/還原,且仍畫在 DirectComposition WebView2 之上。
    unsafe { SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, parent) };
    CHROME_HWND.store(hwnd, Ordering::SeqCst);
    if VISIBLE.load(Ordering::SeqCst) {
        reposition();
    } else {
        park_offscreen();
    }
    emit_status(app, "ready", "");
    log(&format!("promoted hwnd={hwnd} owner={parent}"));

    spawn_exit_watcher(app.clone(), pid);
    Ok(())
}

/// 監看子程序結束(崩潰或使用者按了 Chrome 的 ✕)→ 清狀態 + 發事件。
/// 前端收到 "exited" 會自動重啟一次;之後顯示重試 UI。
fn spawn_exit_watcher(app: AppHandle, pid: u32) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if CHILD_PID.load(Ordering::SeqCst) != pid {
            return; // 已被新的 launch 取代,停止監看舊子程序
        }
        let Ok(mut guard) = CHILD.lock() else { return };
        let Some(child) = guard.as_mut() else { return };
        match child.try_wait() {
            Ok(Some(status)) => {
                *guard = None;
                drop(guard);
                CHROME_HWND.store(0, Ordering::SeqCst);
                CHILD_PID.store(0, Ordering::SeqCst);
                log(&format!("chromium exited: {status}"));
                emit_status(&app, "exited", "");
                return;
            }
            Ok(None) => {}
            Err(e) => {
                log(&format!("try_wait failed: {e}"));
                return;
            }
        }
    });
}

// ---- Tauri commands(語意對齊 CEF 時代的 cef_overlay_*)----

/// 儲存最新面板矩形(螢幕空間實體 px,前端由 getBoundingClientRect + 視窗
/// outer-position + DPI 算出)。可見時順帶重新貼齊。高頻呼叫、冪等。
#[tauri::command]
pub fn chromium_set_panel_rect(x: i32, y: i32, width: i32, height: i32) {
    PANEL_X.store(x, Ordering::SeqCst);
    PANEL_Y.store(y, Ordering::SeqCst);
    PANEL_W.store(width, Ordering::SeqCst);
    PANEL_H.store(height, Ordering::SeqCst);
    reposition();
}

/// 進入瀏覽器模式:標記可見;子程序活著就貼齊,死了/沒啟動就(重新)啟動。
/// 惰性啟動 = app 開機不付 Chromium 的成本,binary 缺失只在瀏覽器模式報錯。
#[tauri::command]
pub fn chromium_show(app: AppHandle, window: tauri::WebviewWindow) {
    VISIBLE.store(true, Ordering::SeqCst);
    let hwnd = CHROME_HWND.load(Ordering::SeqCst);
    if hwnd != 0 && unsafe { IsWindow(hwnd) } != 0 {
        reposition();
        return;
    }
    CHROME_HWND.store(0, Ordering::SeqCst);
    let Ok(parent) = window.hwnd() else { return };
    ensure_launched(app, parent.0 as isize);
}

/// 離開瀏覽器模式:停放畫面外。子程序與頁面狀態保留。
#[tauri::command]
pub fn chromium_hide() {
    VISIBLE.store(false, Ordering::SeqCst);
    park_offscreen();
}

/// main.rs 的 RunEvent::Exit 呼叫——打包的瀏覽器是 owned overlay,必須跟著
/// NoteGen 一起死(它不是使用者自行管理的獨立 app)。
pub fn shutdown() {
    CHILD_PID.store(0, Ordering::SeqCst); // 先讓 exit watcher 收工
    if let Ok(mut guard) = CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
            log("shutdown: chromium killed");
        }
    }
}
```

- [ ] **Step 2: main.rs 註冊**

`src-tauri/src/main.rs`(在 Task 1 清完 browser 之後):

1. mod 區塊加:

```rust
#[cfg(target_os = "windows")]
mod browser_chromium;
```

2. `generate_handler![...]` 尾端(`app_region_screenshot` 後)加:

```rust
            #[cfg(target_os = "windows")] browser_chromium::chromium_show,
            #[cfg(target_os = "windows")] browser_chromium::chromium_hide,
            #[cfg(target_os = "windows")] browser_chromium::chromium_set_panel_rect,
```

3. `RunEvent::Exit` 分支(已有 `cleanup_temp_screenshot_dir(&app_handle);`)加:

```rust
                #[cfg(target_os = "windows")]
                browser_chromium::shutdown();
```

- [ ] **Step 3: 編譯驗證**

```bash
cd src-tauri && cargo check 2>&1 | tail -5 && cd ..
```

Expected: 無 error。常見坑:`Emitter`/`Manager` trait 未 use(app.emit / app.path 需要)、`serde::Serialize` derive 路徑(Cargo.toml 已有 serde)。

- [ ] **Step 4: LF 檢查後 commit**

```bash
file src-tauri/src/browser_chromium.rs src-tauri/src/main.rs | grep CRLF || echo "LF OK"
git add src-tauri/src/browser_chromium.rs src-tauri/src/main.rs
git commit -m "feat(browser): launch bundled Chromium as owned-overlay child process

chrome.exe (full native Chrome UI) is spawned with a dedicated profile,
its main window discovered by PID via EnumWindows, promoted to an
owned top-level overlay (GWLP_HWNDPARENT = NoteGen) and glued over the
browser panel rect — the technique validated by the CEF spike, minus
the part that never worked (building Chrome UI via the Views API)."
```

---

### Task 4: BrowserPanel 前端接線 + e2e mock

**Files:**
- Modify: `src/app/core/main/browser/index.tsx`(佔位版 → 正式版)
- Modify: `e2e/tauri-mock.ts`

- [ ] **Step 1: index.tsx 換成正式版(整檔覆寫)**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { Button } from '@/components/ui/button'

// 內建瀏覽器 = 打包的完整 Chromium(ungoogled-chromium),由
// src-tauri/src/browser_chromium.rs 以子程序啟動,並以原生 owned overlay
// 視窗貼在本面板上方。本元件不擁有任何瀏覽器像素:它上報自己的螢幕矩形
// 讓原生視窗貼齊,並在原生視窗還沒起來時顯示啟動/錯誤狀態。
//
// 座標轉換:getBoundingClientRect() 是相對 webview 的 CSS px;overlay 活在
// 桌面螢幕空間實體 px → 加上視窗 outer position、乘以 DPI scale factor。
// NoteGen 是 frameless(set_decorations(false)),outerPosition == innerPosition。
//
// show 由本元件 mount 後第一個有效 rect 觸發;hide 由 page.tsx 依
// workspaceMode 觸發(放在本元件 unmount cleanup 會跟 React 卸載競態)。

type ChromiumStatus = {
  state: 'launching' | 'ready' | 'exited' | 'error'
  message: string
}

export function BrowserPanel() {
  const ref = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<ChromiumStatus | null>(null)
  const autoRetriedRef = useRef(false)

  useEffect(() => {
    if (platform() !== 'windows') return
    const win = getCurrentWindow()
    let raf = 0
    let cancelled = false
    let shown = false

    const push = async () => {
      if (cancelled || !ref.current) return
      const rect = ref.current.getBoundingClientRect()
      const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
      const x = Math.round(pos.x + rect.left * scale)
      const y = Math.round(pos.y + rect.top * scale)
      const w = Math.round(rect.width * scale)
      const h = Math.round(rect.height * scale)
      if (w < 50 || h < 50) return // 跳過 layout 前的零矩形
      if (cancelled) return
      await invoke('chromium_set_panel_rect', { x, y, width: w, height: h })
      if (!shown && !cancelled) {
        shown = true
        await invoke('chromium_show')
      }
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => { void push() })
    }

    schedule()
    const ro = new ResizeObserver(schedule)
    if (ref.current) ro.observe(ref.current)

    const unlistenPromise = Promise.all([
      win.listen('tauri://move', schedule),
      win.listen('tauri://resize', schedule),
      win.listen('tauri://scale-change', schedule),
      listen<ChromiumStatus>('chromium-status', (e) => {
        setStatus(e.payload)
        // 意外結束 → 自動重啟一次;再失敗就交給重試 UI。
        if (e.payload.state === 'exited' && !autoRetriedRef.current) {
          autoRetriedRef.current = true
          void invoke('chromium_show')
        }
        if (e.payload.state === 'ready') autoRetriedRef.current = false
      }),
    ])

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      void unlistenPromise.then((fns) => fns.forEach((f) => f()))
    }
  }, [])

  const retry = () => {
    setStatus(null)
    void invoke('chromium_show')
  }

  const failed = status?.state === 'error' || status?.state === 'exited'

  return (
    <div
      ref={ref}
      data-chromium-panel
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-neutral-900 text-neutral-500"
    >
      {failed ? (
        <>
          <span className="text-sm">
            {status?.state === 'error' ? `Chromium 啟動失敗:${status.message}` : 'Chromium 已結束'}
          </span>
          <Button variant="outline" size="sm" onClick={retry}>重試</Button>
        </>
      ) : (
        <span className="text-sm">
          {status?.state === 'launching' ? 'Chromium 啟動中…' : 'Chromium — bundled native browser'}
        </span>
      )}
    </div>
  )
}
```

(狀態字串先寫死 zh-TW;若要 i18n 五語系是後續 polish,不擋本計畫。)

- [ ] **Step 2: e2e/tauri-mock.ts 更新 mock 表**

在 `installTauriMock` 的命令表中:**刪除**所有 `browser_*` 與 `__browser_*` 項目(對應已刪除的舊命令),**加入**:

```ts
      // Bundled-Chromium overlay (Windows-only at runtime; mock unconditionally
      // so platform stubs that report 'windows' don't blow up BrowserPanel).
      chromium_show: () => undefined,
      chromium_hide: () => undefined,
      chromium_set_panel_rect: () => undefined,
```

- [ ] **Step 3: 驗證**

```bash
pnpm lint && pnpm test:run
```

Expected: 0 errors / 61 tests pass。

- [ ] **Step 4: LF 檢查後 commit**

```bash
file src/app/core/main/browser/index.tsx e2e/tauri-mock.ts | grep CRLF || echo "LF OK"
git add src/app/core/main/browser/index.tsx e2e/tauri-mock.ts
git commit -m "feat(browser): wire BrowserPanel to chromium overlay + status events

Rect reporting (ResizeObserver + move/resize/scale-change) drives
chromium_set_panel_rect; first valid rect fires chromium_show. The
chromium-status event surfaces launching/error/exited states with a
one-shot auto-restart and a manual retry button."
```

---

### Task 5: 打包資源(Windows bundle)

**Files:**
- Create: `src-tauri/tauri.windows.conf.json`

- [ ] **Step 1: 建平台覆寫檔**

`src-tauri/tauri.windows.conf.json`(新檔;Tauri 2 平台 conf 與主 conf 做 merge,**陣列是整個取代**,所以要把主 conf 既有的 `icons` 一起列入):

```json
{
  "bundle": {
    "resources": ["icons", "chromium"]
  }
}
```

效果:Windows 打包時 `src-tauri/chromium/` 整夾複製到 `<resource_dir>/chromium/`,正是 `chrome_exe_path()` 的打包版路徑。macOS/Linux 不受影響(不打包 200MB+ 的 Windows Chromium)。

- [ ] **Step 2: 驗證 conf 被接受**

```bash
cd src-tauri && cargo check 2>&1 | tail -3 && cd ..
node -e "JSON.parse(require('fs').readFileSync('src-tauri/tauri.windows.conf.json','utf8')); console.log('JSON OK')"
```

(完整 bundle 驗證在 Task 6 之後由 release CI 做;本機不強制跑 `tauri build`。)

- [ ] **Step 3: LF 檢查後 commit**

```bash
file src-tauri/tauri.windows.conf.json | grep CRLF || echo "LF OK"
git add src-tauri/tauri.windows.conf.json
git commit -m "build(browser): bundle chromium/ into Windows resources

Platform-specific conf so only Windows installers carry the 200MB+
Chromium payload; resource_dir/chromium/chrome.exe is the packaged-path
half of chrome_exe_path()."
```

---

### Task 6: 手動驗收(使用者執行)— CHECKPOINT

**這一步需要使用者操作與目視確認,代理不可自行宣告通過。**

- [ ] **Step 1: 啟動**

```bash
pnpm fetch-chromium   # 若 Task 2 已跑過會直接 skip
pnpm tauri dev
```

- [ ] **Step 2: 驗收清單(逐項目視)**

1. 點 Globe 切到瀏覽器模式 → 面板內出現**完整 Chrome UI**:網址列、分頁列、上下頁、三點選單(本計畫的唯一交付定義)
2. 能輸入網址瀏覽、能開新分頁
3. NoteGen 縮小/還原,Chromium 視窗跟隨;工作列**沒有**第二個圖示
4. 切回筆記模式 → Chromium 消失(停放畫面外);再切回 → 頁面狀態還在
5. 拖動/縮放 NoteGen 視窗 → overlay 跟著貼齊面板
6. 關閉 NoteGen → `chrome.exe` 程序一起結束(工作管理員確認)
7. 在瀏覽器模式按 Chrome 的 ✕ 關掉視窗 → 面板自動重啟一次 Chromium

- [ ] **Step 3: 已知限制確認(不擋驗收,記錄即可)**

- 使用者可拖 Chrome 分頁列把視窗拖離面板(下次 rect 事件會貼回來);徹底鎖定是後續 polish
- 狀態字串未 i18n

任何一項驗收失敗 → 用 superpowers:systematic-debugging 處理,不得跳過。

---

### Task 7: 殘骸清理 + 文件

**前提:Task 6 驗收通過。此 task 含不可逆操作(刪分支),執行前再向使用者確認一次。**

- [ ] **Step 1: 歸檔舊計畫/spec 文件**

舊文件躺在主 checkout(`E:/source/note-gen/docs/superpowers/`,先前被 gitignore、從未入版控)。複製進 worktree 歸檔並 commit:

```bash
mkdir -p docs/superpowers/plans/archive docs/superpowers/specs/archive
cp /e/source/note-gen/docs/superpowers/plans/2026-06-07-cdp-browser-engine-shippable.md \
   /e/source/note-gen/docs/superpowers/plans/2026-06-08-notegen-novnc-browser.md \
   /e/source/note-gen/docs/superpowers/plans/2026-06-09-notegen-novnc-browser-stabilization.md \
   /e/source/note-gen/docs/superpowers/plans/2026-06-09-novnc-responsive-relaunch.md \
   /e/source/note-gen/docs/superpowers/plans/2026-06-13-cef-chrome-toolbar-followup.md \
   docs/superpowers/plans/archive/
cp /e/source/note-gen/docs/superpowers/specs/2026-06-07-cdp-browser-engine-shippable-design.md \
   /e/source/note-gen/docs/superpowers/specs/2026-06-12-cef-chrome-ui-and-novnc-cleanup-design.md \
   docs/superpowers/specs/archive/
git add docs/superpowers && git commit -m "docs(browser): archive CDP/noVNC/CEF era plans and specs"
```

- [ ] **Step 2: 刪舊 worktree 與分支(需使用者確認)**

```bash
git worktree remove E:/source/note-gen-cef-fallback
git worktree remove E:/source/note-gen-cef-investigation
git branch -D feat/browser-novnc claude/cef-custom-toolbar-fallback claude/cef-toolbar-investigation
git push origin --delete claude/cef-custom-toolbar-fallback claude/cef-toolbar-investigation
```

(`feat/browser-novnc` 只有 local,origin 上只有兩條 `claude/cef-*`。歷史靠 reflog/GitHub 留底。)

- [ ] **Step 3: 更新主 checkout 的 CLAUDE.md(on-disk 檔,gitignored,不 commit)**

`E:/source/note-gen/CLAUDE.md`:

1. **In-app Browser 整節改寫**為新架構:打包 ungoogled-chromium、`browser_chromium.rs` 子程序 + owner-overlay、`chromium_show/hide/set_panel_rect` 命令、`pnpm fetch-chromium` 開發前置、Task 6 驗收日期
2. **刪除** CEF 相關內容:`browser_cef.rs`、`CEF_PATH` build requirement、SwiftShader/GPU 段落、cef-rs path dep pending 項
3. **Rejected approaches 加一條**:「CEF Views + Chrome runtime 嵌入(Chrome 工具列在嵌入模式畫不出來,三輪 hypothesis 調查未解,2026-06-13 棄)」
4. Tauri commands 模組列表:`browser_cef.rs` → `browser_chromium.rs`

- [ ] **Step 4: 最終驗證 + 收尾**

```bash
pnpm lint && pnpm test:run && cd src-tauri && cargo check 2>&1 | tail -3 && cd ..
git log --oneline main..HEAD
```

之後走 superpowers:finishing-a-development-branch(發 PR 到 main)。

---

## Self-Review 紀錄(計畫完成時執行)

1. **Spec coverage:** 需求 1(打包可散布 Chromium)= Task 2+5;需求 2(原生 UI、零 React chrome)= Task 3 架構本身 + Task 6 驗收項 1;需求 3(貼面板/隨模式)= Task 3+4 + 驗收 4-5;需求 4(新分支重來、舊分支全刪)= worktree 前提 + Task 7;錯誤處理(缺檔/逾時/崩潰重啟)= Task 3 emit + Task 4 auto-retry;清理(歸檔/CLAUDE.md)= Task 7。
2. **Placeholder scan:** 無 TBD/TODO;所有程式碼步驟附完整內容。
3. **Type consistency:** 命令名三處一致(Rust `chromium_show/hide/set_panel_rect` ↔ index.tsx invoke ↔ tauri-mock);事件名 `chromium-status` Rust emit ↔ 前端 listen;`ChromiumStatus.state` 四值一致。


