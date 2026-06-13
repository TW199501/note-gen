# CEF Chrome UI + noVNC Cleanup — Design

**Date:** 2026-06-12
**Branch:** `feat/browser-novnc` (CEF spike branch; will be renamed later)
**Status:** Approved — ready for plan

## Context

NoteGen's in-app browser pivoted to CEF (Chromium Embedded Framework) on 2026-06-10. The CEF show/hide ↔ `workspaceMode` wiring shipped today (`crystalline-seeking-biscuit.md` plan, verified with a desktop screenshot of the embedded Chromium 148 page). The browser panel is now real Chromium, owned by NoteGen, drag-tracking the panel rect via Tauri events.

Two pieces remain before NoteGen has a usable browser:

1. **The CEF window currently shows only the page content.** No URL bar, no back/forward, no tabs, no menu — because the spike used `browser_host_create_browser` + `WindowInfo::set_as_child`, which produces a raw rendering window without any browser chrome. To "actually browse", a user would need code to call `navigate()`.

2. **The dormant noVNC stack still ships.** `browser_sidecar.rs`, `BrowserHost`, `browser-vnc`, `manager-client`, `@novnc/novnc`, `docker/cloakbrowser-manager/`, and a handful of `tauri.conf.json` CSP entries remain compiled and registered but are unreachable from the UI. They add bundle weight, confuse readers, and keep noVNC drift alive.

The intended outcome: NoteGen's browser panel becomes a full **native Chromium browser** — the same UI as a standalone Chrome browser, painted by Chromium itself, with no NoteGen-custom URL bar or navigation glue — and the noVNC era is deleted from the tree.

## Approach

### Part B — CEF Views with the Chrome runtime

Replace the current `browser_host_create_browser(window_info=set_as_child, ...)` call with the **CEF Views path**: create a `BrowserView` whose delegate returns `ChromeToolbarType::NORMAL`, then wrap it in a `Window` created via `window_create_top_level`. The Window is rendered by Chromium with its native chrome — URL bar, back/forward/reload, tabs, three-dot menu, DevTools (F12), find-in-page (Ctrl+F), zoom (Ctrl+±), bookmarks bar — all of it for free.

The Window is set frameless via `WindowDelegate::is_frameless() -> 1` (no OS title bar/borders) so it visually integrates with NoteGen. The existing **promote-to-overlay** machinery (SetParent → owned-popup → `GWLP_HWNDPARENT = NoteGen`) is reapplied to this new Window's HWND so it stays owned by NoteGen (no separate taskbar entry, follows minimize/restore). Show/hide/rect-tracking remain unchanged — same atomics, same `cef_overlay_*` commands.

The starting URL changes from the diagnostic `data:text/html,...` page to **`https://www.google.com/`**.

**What this means for the frontend:** nothing changes. `BrowserPanel` stays a placeholder div that reports its rect to Rust. No `<UrlBar/>`, no `<NavButtons/>`, no `currentUrl/currentTitle/isLoading/canGoBack/canGoForward` store fields, no `cef_navigate/back/forward/reload/stop` commands, no `CefClient + LoadHandler + DisplayHandler` event bridging. Chromium owns the chrome UI; React owns nothing inside the panel.

### Part H — noVNC stack deletion

Delete every file and reference that exists only for the noVNC/CloakBrowser-Manager engine. Keep engine-agnostic utilities (`find.ts`, `nav-state.ts`, `zoom.ts`) — they will be useful when [B] needs Chrome-runtime keyboard shortcut routing or DevTools state.

## Critical Files

**Rust — `src-tauri/src/browser_cef.rs`** (modify):
- Add `wrap_browser_view_delegate! { pub struct NoteGenBrowserViewDelegate; impl BrowserViewDelegate { fn chrome_toolbar_type(...) -> ChromeToolbarType::NORMAL } }`
- Add `wrap_window_delegate! { pub struct NoteGenWindowDelegate { browser_view: RefCell<Option<BrowserView>> }; impl WindowDelegate { fn is_frameless(...) -> 1; fn on_window_created(self, window) { window.add_child_view(self.browser_view.take().unwrap().into()); window.show(); } } }`
- Replace `browser_host_create_browser(...)` body in `create_child_browser` with `browser_view_create(None, Some(&url), Some(&settings), None, None, Some(&mut bv_delegate))` followed by `window_create_top_level(Some(&mut w_delegate))`
- Rewrite `enum_child_cb` + `promote_to_overlay` to find the new CEF Window via `EnumWindows + GetWindowThreadProcessId == ourPid + class name match` (the new window is a top-level, not a child of NoteGen, so `EnumChildWindows` no longer hits it)
- Fix the misleading `swiftshader` log message string from the earlier change

**Rust — `src-tauri/src/main.rs`** (modify):
- Remove `use browser_sidecar::{...}` block (lines 28-31)
- Remove `mod browser_sidecar;`
- Remove `browser_sidecar_*` / `browser_profile_*` entries from `generate_handler!`
- Remove `stop_container_on_exit()` call from `RunEvent::Exit`

**Rust — `src-tauri/src/lib.rs`** (modify):
- Mirror the removals from `main.rs` (browser_sidecar mod, use, handler entries)

**Rust — `src-tauri/src/app_setup.rs`** (modify):
- Change the start URL passed to `create_child_browser` from the diagnostic `data:` string to `https://www.google.com/`
- Keep the call site itself — same parameters (HWND, rect, URL)

**Rust — `src-tauri/src/browser_sidecar.rs`** (delete):

**Frontend — `src/app/core/main/browser/browser-host.tsx`** (delete)
**Frontend — `src/app/core/main/browser/browser-vnc.tsx`** (delete)
**Frontend — `src/lib/browser/manager-client.ts`** (delete)
**Frontend — `src/lib/browser/vnc-url.ts`** (delete)
**Frontend — `src/lib/browser/vnc-url.test.ts`** (delete)
**Frontend — `src/novnc.d.ts`** (delete)
**Docker — `docker/cloakbrowser-manager/`** (delete recursively)

**Frontend — `src/app/core/main/browser/index.tsx`** (no change — `BrowserPanel` stays as-is):
- The rect-tracking effect and `data-cef-panel` div remain. Chrome UI is painted by CEF, not React.

**Test mock — `e2e/tauri-mock.ts`** (modify):
- Remove `browser_sidecar_status`/`browser_sidecar_ensure`/`browser_profile_launch`/`browser_profile_stop`/`browser_profile_set_clipboard`/`browser_profile_get_clipboard` stubs (they no longer exist as backend commands)
- Keep the three `cef_overlay_*` stubs added previously

**Config — `src-tauri/tauri.conf.json`** (modify):
- Remove `ws://localhost:*` and `ws://127.0.0.1:*` from `csp.connect-src` (only noVNC needed them; CEF talks via libcef directly, not via a WS to the webview)

**Config — `package.json`** (modify):
- Remove `@novnc/novnc` from `dependencies`
- Run `pnpm install` to update `pnpm-lock.yaml`

**Docs — `CLAUDE.md`** (modify):
- In the "In-app Browser (CEF / libcef embedded Chromium — Windows spike)" section: drop the "(5) `browser_sidecar.rs` is still compiled..." pending bullet; update the architecture paragraph to mention the BrowserView + Window + Chrome runtime path
- Remove the "Rejected approaches" mention of `noVNC/Docker (... previously built on this branch — see git history at 58eee580)` — it's still valid history but the bullet can be tightened

## Reused Functions/Utilities

- **CEF Views API:** `browser_view_create`, `window_create_top_level`, `WindowDelegate`, `BrowserViewDelegate`, `ChromeToolbarType::NORMAL` — all exposed by the existing `cef-rs` path dep at `../../cef-rs/cef`. Reference: `E:\source\cef-rs\examples\cefsimple\src\shared\simple_app.rs:151-167` (the `use_views == true` branch).
- **Overlay machinery:** `OVERLAY_HWND` atomic, `PANEL_X/Y/W/H` atomics, `VISIBLE` atomic, `cef_overlay_set_panel_rect`/`show`/`hide` commands — all already in `browser_cef.rs`, reused as-is. Only `enum_child_cb`/`promote_to_overlay` change to use `EnumWindows` instead of `EnumChildWindows`.
- **Tauri command registration pattern:** mirror the `#[cfg(target_os = "windows")]`-gated `cef_overlay_*` entries already in `main.rs`.
- **Existing tests:** `src/lib/browser/{find,nav-state,zoom}.{ts,test.ts}` remain — engine-agnostic, useful for future Chrome-runtime keyboard routing / DevTools state.

## Verification

Manual smoke test (Playwright cannot see native CEF):

1. `pnpm lint && pnpm exec tsc --noEmit && pnpm test:run && PLAYWRIGHT_HEADLESS=1 pnpm e2e e2e/_demo.spec.ts` — all green.
2. `cd src-tauri && export CEF_PATH="$USERPROFILE/.local/share/cef" && export PATH="$CEF_PATH:$PATH" && cargo build` — compiles clean (modulo pre-existing dead-code warnings).
3. From repo root: `pnpm tauri dev`.
4. **Initial state (notes mode):** No browser visible. Notes/sidebar/editor render normally.
5. **Enter browser mode (click Globe):** Chrome 148 UI appears inside the browser panel — URL bar reading `https://www.google.com/`, back/forward/reload buttons, tab strip showing one tab, three-dot menu, all native Chromium pixels.
6. **Browse:** Type a URL → Enter → page navigates. Click links → page navigates. Back/forward buttons work. Refresh works.
7. **Keyboard shortcuts:** Ctrl+F opens find-in-page (Chrome's own UI). Ctrl+± zooms. F12 opens DevTools.
8. **Tabs:** Ctrl+T opens a new tab. Ctrl+W closes it. Ctrl+Tab switches.
9. **Leave browser mode (click Notebook):** Chrome UI vanishes; notes workspace returns instantly.
10. **Tracking:** Drag NoteGen across the desktop / resize it / drag the panel divider — Chrome UI follows the panel rect with no lag.
11. **No noVNC residue:** `git grep -i novnc` returns no matches; `git grep browser_sidecar` returns no matches; `tauri.conf.json` `connect-src` has no `ws://` entries; `package.json` has no `@novnc/novnc`.

Automated:
- `pnpm test:run` should still be 67/67 (the deleted noVNC modules had no live tests — only `vnc-url.test.ts` which goes away with its source).
- `pnpm e2e e2e/_demo.spec.ts` should still pass — the mock no longer stubs `browser_sidecar_*` because the commands no longer exist; the test exercises browser-mode entry, which now triggers the three `cef_overlay_*` calls that are stubbed.

## Out of Scope (Defer to Later Plans)

- Multi-tab persistence (Chrome handles single-session tabs; we don't restore them across NoteGen launches yet) — Phase C / D
- Cookie/cache persistence across NoteGen launches — needs explicit `RequestContext` with a `cache_path` — Phase D
- AI page-content extraction (CDP `Runtime.evaluate` / `DOM.getOuterHTML`) — Phase E
- Switching `../../cef-rs/cef` path dep to a published crate; bundling `libcef.dll` + resources via `tauri.conf.json` — Phase F
- macOS + Linux CEF integration — Phase G
- Real-GPU validation on RTX 5090 (SwiftShader flags already removed; current evidence is "renders correctly on this dev machine" — needs a second verification on the GPU machine)
