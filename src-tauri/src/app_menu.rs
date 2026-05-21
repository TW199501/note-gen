//! Commands backing the global app-level right-click menu (the React
//! `<AppContextMenu />` mounted on the main Tauri webview, i.e. everything
//! that's NOT the child browser webview).

use tauri::{AppHandle, Manager};

/// Toggle the WebKit/WebView2 devtools window on the main webview.
///
/// Cross-platform: WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux)
/// all expose this through Tauri's `WebviewWindow` API. In release builds
/// devtools are typically stripped unless the `devtools` feature is enabled
/// in `tauri = { features = ["devtools"] }`, but in dev (`pnpm tauri dev`)
/// they're always available.
#[tauri::command]
pub fn app_toggle_devtools(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    // is_devtools_open / open_devtools / close_devtools are gated behind
    // `debug_assertions` in tauri 2.x release builds. In production we'd need
    // to enable the `devtools` feature on the `tauri` crate; until that's
    // wired up the user can still use platform shortcuts (Cmd+Opt+I on macOS,
    // F12 on Windows) in dev. Wrap the calls so release builds compile.
    #[cfg(debug_assertions)]
    {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
        return Ok(());
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = window;
        Err("devtools require a dev build or the tauri `devtools` feature".to_string())
    }
}

/// Region screenshot via the OS-native interactive screenshot tool.
///
/// Returns the absolute path of the saved PNG on success, or `Ok(None)` if
/// the user cancelled (ESC / Cmd+. on macOS). On Windows and Linux the
/// native tool drops the result into the clipboard rather than a file —
/// we surface that as an Err and let the frontend fall back to a "paste in
/// chat" hint until proper file-handle support is wired up.
///
/// macOS: `screencapture -i path` opens the system region selector
///   (Cmd-Shift-4 UX) and saves directly to `path`. Exit code 0 with the
///   file present = success, missing file = user cancelled.
/// Windows: `ms-screenclip:` URI launches the Snipping Tool clip mode,
///   result goes to clipboard. We do NOT block waiting because the user
///   may cancel; the frontend should prompt for paste afterwards.
/// Linux: best-effort `gnome-screenshot -a -f path` if available.
#[tauri::command]
pub async fn app_region_screenshot(app: AppHandle) -> Result<Option<String>, String> {
    use tauri::path::BaseDirectory;

    let app_data = app
        .path()
        .resolve("screenshot", BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let out_path = app_data.join(format!("region-{}.png", ts));

    #[cfg(target_os = "macos")]
    {
        // `-i` interactive (region selector), `-x` no shutter sound, `-t png`
        // explicit format. Tool returns 0 even if user cancels; we detect
        // cancel by absence of the file afterwards.
        let status = std::process::Command::new("screencapture")
            .arg("-i")
            .arg("-x")
            .arg("-t")
            .arg("png")
            .arg(&out_path)
            .status()
            .map_err(|e| format!("failed to spawn screencapture: {e}"))?;
        if !status.success() {
            return Err(format!("screencapture exited with {status}"));
        }
        if out_path.exists() {
            Ok(Some(out_path.to_string_lossy().to_string()))
        } else {
            Ok(None)
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Snipping Tool's clip mode. Result goes to the clipboard — frontend
        // is responsible for hinting the user to paste. out_path is computed
        // above but unused on Windows; swallow it so rustc doesn't warn (and
        // so future "save to file" mode can drop the `let _` without churn).
        let _ = out_path;
        std::process::Command::new("cmd")
            .args(["/c", "start", "", "ms-screenclip:"])
            .status()
            .map_err(|e| format!("failed to launch ms-screenclip: {e}"))?;
        Err("WINDOWS_CLIPBOARD".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        // gnome-screenshot is the most-installed; fall back to spectacle (KDE).
        let tried_gnome = std::process::Command::new("gnome-screenshot")
            .arg("-a")
            .arg("-f")
            .arg(&out_path)
            .status();
        if let Ok(s) = tried_gnome {
            if s.success() && out_path.exists() {
                return Ok(Some(out_path.to_string_lossy().to_string()));
            }
        }
        let tried_spectacle = std::process::Command::new("spectacle")
            .args(["-r", "-b", "-n", "-o"])
            .arg(&out_path)
            .status();
        if let Ok(s) = tried_spectacle {
            if s.success() && out_path.exists() {
                return Ok(Some(out_path.to_string_lossy().to_string()));
            }
        }
        Err("no supported region-screenshot tool found (install gnome-screenshot or spectacle)".to_string())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        Err("unsupported platform".to_string())
    }
}
