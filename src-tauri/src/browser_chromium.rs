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
//
// SEARCH_PID / FOUND_HWND 是模組級靜態,find_chrome_window 不可重入。
// 安全性依賴 LAUNCHING.swap 守衛:同一時間只有一個 launch_and_promote thread
// 跑 polling loop,所以 find_chrome_window 不會被並發呼叫。
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
    let parent = match window.hwnd() {
        Ok(h) => h.0 as isize,
        Err(e) => {
            // 取不到 NoteGen 主視窗 HWND(實務上 Windows 下不會發生,但防靜默卡死)
            emit_status(&app, "error", &format!("window.hwnd() failed: {e}"));
            return;
        }
    };
    ensure_launched(app, parent);
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
