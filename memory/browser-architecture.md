# In-app Browser Architecture (Bundled Chromium child process)

> Extracted from CLAUDE.md 2026-06-14 to keep that file lean. CLAUDE.md keeps a 3-line summary + pointer back here.

## What it is

The in-app browser ships a complete **ungoogled-chromium** (BSD-licensed, redistributable) and launches `chrome.exe` as a child process. The browser's UI is the **native** Chrome UI (URL bar, tabs, back/forward, three-dot menu, DevTools, find, zoom, bookmarks) — NoteGen ships ZERO browser-chrome React UI. The overlay is glued to a `data-chromium-panel` div via Win32 window management.

## Architecture

`browser_chromium.rs::chromium_show` is **lazy** — first call spawns `chrome.exe` with:

```
--user-data-dir=<app-data>/browser-profile
--no-first-run
--no-default-browser-check
--window-position=-32000,-32000
https://www.google.com/
```

A background thread polls `EnumWindows` (filtered by the child PID, top-level, visible, class `Chrome_WidgetWin*`) up to 15 s until the main window appears. Once found, it sets `GWLP_HWNDPARENT = NoteGen's HWND` via `SetWindowLongPtrW` — making it an **owned top-level**:

- No extra taskbar icon
- Follows NoteGen's minimize/restore
- Paints **above** Tauri's DirectComposition WebView2 (this is the whole point — WebView2 covers sibling children)

`chromium_set_panel_rect` (high-frequency, idempotent) stores the latest screen-space physical-px rect and calls `SetWindowPos(HWND_TOPMOST, …, SWP_NOACTIVATE | SWP_SHOWWINDOW)`.

`chromium_hide` parks the window at `(-32000, -32000)` so re-show keeps page state.

An **exit watcher** polls `try_wait` every 500 ms — when the child dies (crash or user closes Chrome's ✕), it emits `chromium-status: exited` and the frontend auto-restarts ONCE; further failures show a manual retry button.

`RunEvent::Exit` in `main.rs` calls `browser_chromium::shutdown()` to kill `chrome.exe` so the bundled browser dies with NoteGen (it's not a standalone app the user manages).

## Win32 access

Raw FFI under `#[link(name = "user32")]` rather than the `windows` crate — version-proof, no transitive crate churn. The functions used:

- `EnumWindows`, `GetWindowThreadProcessId`, `GetClassNameW`, `GetParent`, `IsWindow`, `IsWindowVisible`
- `SetWindowLongPtrW(GWLP_HWNDPARENT)`, `SetWindowPos(HWND_TOPMOST, ...)`

## Panel entry (React side)

`src/app/core/main/browser/index.tsx` exports `BrowserPanel` — a `data-chromium-panel` div. It uses `ResizeObserver` + `tauri://move|resize|scale-change` events to push rects (`getBoundingClientRect()` + `outerPosition` + `scaleFactor`, skipping rects < 50×50 in **physical px**) via `chromium_set_panel_rect`; the first valid rect fires `chromium_show`. `chromium-status` events drive `launching` / `ready` / `exited` / `error` UI states with the auto-restart and manual retry button.

## Key Rust files

- `src-tauri/src/browser_chromium.rs` (`#[cfg(target_os = "windows")]`): launch + EnumWindows discovery + GWLP_HWNDPARENT promote + show/hide/set_panel_rect + exit watcher + shutdown
- `src-tauri/src/main.rs`: 3 commands registered + `RunEvent::Exit` shutdown call

## Path resolution

`chrome_exe_path()` tries in order:

1. `resource_dir/chromium/chrome.exe` (packaged, via `tauri.windows.conf.json`'s `bundle.resources: ["icons", "chromium"]`)
2. `<exe-dir>/../../chromium/chrome.exe` (dev, where dev exe lives at `src-tauri/target/{debug,release}/`)

## Dev setup (Windows)

`pnpm fetch-chromium` downloads pinned ungoogled-chromium `149.0.7827.53-1.1` (~177 MB) into `src-tauri/chromium/` (gitignored) before first dev run. The script uses Windows 10+'s built-in `bsdtar` (`tar.exe` supports zip) and flattens the top-level dir so `chrome.exe` sits at `src-tauri/chromium/chrome.exe`.

## macOS / Linux

Out of scope for this iteration:
- `browser_chromium.rs` is `#[cfg(target_os = "windows")]`
- `tauri.windows.conf.json` is platform-scoped
- `BrowserPanel` returns early when `platform() !== 'windows'`

Future work: per-OS distribution channels (Mac dmg, Linux AppImage).

## v2 roadmap (not yet implemented)

See `docs/superpowers/specs/2026-06-14-browser-integrated-chat-vision.md` for the next iteration: Chrome extension sidepanel that puts NoteGen's chat **inside** Chromium via iframe to a local axum-served React UI. Solves the v1 limitation that browser and chat sidebar can't share state because they're separate processes.
