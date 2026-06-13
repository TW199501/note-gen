# In-app Browser: Rejected Approaches

> Seven approaches tried for replacing the Tauri WebView in-app browser. **Don't re-propose any of these without reading why they failed.**
> Extracted from CLAUDE.md 2026-06-14. The current shipping approach (bundled `chrome.exe` + owner-overlay) is the 4th major attempt.

## 1. CDP screencast + synthesized input

Drive an external browser via Chrome DevTools Protocol; stream pixels back into NoteGen and synthesize input events. **Failed:** lossy IME / clipboard / context-menu / drag-drop. Branch `feat/browser-cdp-engine` (M1–M3 built then abandoned).

## 2. Win32 `SetParent` reparenting of an external process

Make the external browser window a child of NoteGen. **Failed:** creates two taskbar icons (Windows treats parent-child differently from owner-owned). UX broken.

## 3. Tauri WebView2 with custom React browser UI

Stay inside WebView2, build URL bar / tabs / DevTools button in React. **Rejected by user:** wants real Chromium everywhere, not "Edge dressed up as Chrome". Some users actively distrust WebView2 for sites that rely on Chromium-specific behavior.

## 4. Embedding CloakBrowser binary

Bundle the CloakBrowser binary that lives at `engine/`. **Failed:** license forbids redistribution.

## 5. noVNC / Docker

Run a real Chromium inside a Docker container, stream the desktop via noVNC into a React `<iframe>`. **Failed:** Docker is an unacceptable dependency for normal users (we want one-installer install, not "install Docker first"). Branch `feat/browser-novnc` history at `58eee580`; deleted 2026-06-13 commit `6ed9b5f9`.

## 6. Raw `browser_host_create_browser` + child-HWND (CEF, pre-Views path)

Use CEF's low-level browser host API directly with a child HWND. **Failed:** no Chrome UI at all (page only), no input focus routing (clicks didn't reach the page). Was the first CEF spike before the Views API pivot.

## 7. CEF Views + Chrome runtime embedding

Embed Chromium as a library, use the CEF Views API to compose a window containing both the page and the Chrome toolbar (`ChromeToolbarType::NORMAL` + `RuntimeStyle::CHROME` + `is_frameless=0`). **Failed:** page rendered fine, clicks worked, but the **native Chrome toolbar never painted** inside the overlay despite three hypothesis rounds:

- (a) `GWLP_HWNDPARENT` reparenting kills the toolbar — eliminated (commit `ac6c4a51`)
- (b) Missing cefsimple delegate methods (`preferred_size` / `can_close` / `initial_show_state`) — added, no effect (commit `29307bc1`)
- (c) `add_child_view(BrowserView)` is the wrong API path — untested when abandoned

Dropped 2026-06-13 in favor of bundling the real `chrome.exe`. Branches `claude/cef-custom-toolbar-fallback` + `claude/cef-toolbar-investigation` deleted 2026-06-14.

## Why the current approach (bundled chrome.exe) won

The fundamental insight: **stop treating Chromium as a library you embed**. Ship a complete Chrome binary, launch it as a child process, use Win32 owner-overlay (`GWLP_HWNDPARENT`) to glue its window into NoteGen's workspace. The native Chrome UI is what a real browser has — zero composition needed. Window management is the only NoteGen-side code.

This nullifies all 7 above:
- Not CDP (no streaming, real pixels)
- Not `SetParent` (using `GWLP_HWNDPARENT` for owned top-level — different semantics, no second taskbar)
- Not WebView2 (real Chromium)
- Not CloakBrowser (ungoogled-chromium is BSD, redistributable)
- Not noVNC (no Docker; chrome.exe runs natively)
- Not raw `browser_host` (chrome.exe ships its own UI)
- Not CEF Views (chrome.exe IS the UI; no Views API in the loop)

See [browser-architecture.md](browser-architecture.md) for how the current approach is wired.
