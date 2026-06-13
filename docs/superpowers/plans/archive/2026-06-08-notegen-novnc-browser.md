# NoteGen noVNC Browser Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace NoteGen's in-app browser content surface with a live **noVNC** stream of a real **headful CloakBrowser** (run via a local **CloakBrowser-Manager** Docker sidecar), giving native input (mouse / right-click / copy / IME) + stealth + a CDP channel for AI extraction and the user's future web-scraping — all inside one NoteGen window / one taskbar icon.

**Architecture:**
- A **local Docker sidecar** reuses **CloakBrowser-Manager** (MIT) running **KasmVNC + headful CloakBrowser + FastAPI** on `127.0.0.1:8080`. FastAPI proxies two WebSockets per profile: `/api/profiles/{id}/vnc` (RFB) and `/api/profiles/{id}/cdp` (Chrome DevTools Protocol). CloakBrowser's stealth Chromium binary auto-downloads inside the container on first run (never bundled — binary license forbids redistribution).
- **NoteGen Rust** manages the sidecar lifecycle (detect Docker, pull/run/health-check/stop the container, create+launch+stop a profile via the Manager REST API) and surfaces the per-profile `vnc`/`cdp` endpoints to the frontend.
- **NoteGen frontend** left panel = `@novnc/novnc` RFB viewer bound to the Manager `/vnc` WebSocket. The existing hand-built nav-bar / tab-strip / bookmark / find / history / downloads UI is **kept** and re-wired to drive the browser over the Manager CDP. AI text-extraction and scraping use `/cdp`.
- The previous **CDP-screencast engine is retired** (`browser-screencast.tsx`, `cdp_screencast.rs`, `cdp_events.rs`, the `Input.*` synthesis commands) along with the abandoned headful/`SetParent` reparent experiment.

**Tech Stack:** Tauri 2 (Rust) · Next.js 15 / React 19 / TS · `@novnc/novnc` (RFB) · Docker (Desktop/WSL2 on Windows) · CloakBrowser-Manager (FastAPI + KasmVNC + SQLite) · CloakBrowser (stealth Chromium, Chromium 146).

---

## Architecture Decisions (locked, from the 2026-06-07/08 discussion)

1. **Reuse CloakBrowser-Manager (MIT) as the browser backend** — do not reinvent the VNC/CDP/profile stack. User directive: 「開源的,不然我怎麼會叫你做」.
2. **Deployment = local Docker sidecar** (Docker Desktop / WSL2 on Windows). CloakBrowser binary auto-downloads in-container; **never bundled** into a NoteGen release (binary is "free, no redistribution").
3. **v1 scope = single active profile** to match NoteGen's current one-browser UX. The Manager's multi-profile / fingerprint / proxy capability is retained and surfaced for the **future scraping** use case.
4. **Keep NoteGen's custom toolbar/tabs/bookmarks/find UI** (the「我們刻的」), re-wired to the Manager CDP — do not adopt KasmVNC/Chromium's own chrome.
5. **Why noVNC, not the rejected approaches:** VNC relays REAL input to a REAL headful browser → native IME/clipboard/right-click; the browser runs offscreen on a virtual display so only pixels stream in → one icon; it IS CloakBrowser → stealth preserved. (CDP-screencast had lossy input; `.exe`+SetParent = two icons; WebView2 = not a real browser; CEF/embed-CloakBrowser = binary is not embeddable.)

## Open Questions / Risks (resolve in Phase 0 spike; defaults noted)

- **Docker dependency for end users** is heavy for a note app. Default: acceptable for now (power-user feature, possibly feature-gated/optional later). Revisit before any public release.
- **CJK IME over VNC:** the Manager image ships no ibus/fcitx → 注音/中文 may not compose in-container. Default v1: add `fcitx`/`ibus` to the image **or** clipboard-paste fallback. Confirm in spike.
- **Windows ↔ container clipboard** sync correctness (the Manager uses `xclip` + a 2s CDP poll).
- **VNC latency / perf** acceptability at the panel size.
- **How NoteGen drives Docker** on the user's machine (docker CLI presence; image build vs pull; first-run binary download ~200MB).

## File Structure

**New (frontend):**
- `src/app/core/main/browser/browser-vnc.tsx` — `@novnc/novnc` RFB viewer; replaces `browser-screencast.tsx` as the content surface.
- `src/lib/browser/manager-client.ts` (+ `.test.ts`) — typed client for the Manager REST/WS API (status, create/launch/stop profile, build vnc/cdp URLs).
- `src/lib/browser/vnc-url.ts` (+ `.test.ts`) — pure helpers to build the `ws(s)://…/vnc` and `/cdp` URLs from host + profileId (unit-testable).

**New (Rust):**
- `src-tauri/src/browser_sidecar.rs` — Docker lifecycle: detect Docker, run/health-check/stop the Manager container, proxy/forward the Manager base URL + auth token to the frontend; tauri commands `browser_sidecar_status`, `browser_sidecar_ensure`, `browser_profile_launch`, `browser_profile_stop`.

**Modify:**
- `src/app/core/main/browser/index.tsx` — mount `browser-vnc` instead of `browser-webview`/screencast; wire status/restart to the sidecar.
- `src/app/core/main/browser/browser-webview.tsx` — repurpose into the sidecar-state host (preflight: Docker present? sidecar healthy? profile launched?) or fold into `index.tsx`.
- `src/app/core/main/browser/browser-nav-bar.tsx`, `src/lib/browser/nav-state.ts`, `src/lib/browser/find.ts`, `src/lib/browser/zoom.ts`, `tab-strip.tsx` — drive navigation/find/zoom/tabs via the Manager CDP instead of the old chromiumoxide commands.
- `src/stores/browser.ts` — replace engine* state with sidecar/profile state.
- `src-tauri/src/lib.rs` + `main.rs` — register the new sidecar commands; deregister retired engine/input commands.

**Retire / remove (after parity reached):**
- `src/app/core/main/browser/browser-screencast.tsx`
- `src-tauri/src/cdp_screencast.rs`, `src-tauri/src/cdp_events.rs`
- `src-tauri/src/browser_engine.rs` (download/reparent/headful helpers) — CloakBrowser now lives in the container.
- The `Input.*` synthesis + screencast + engine commands in `src-tauri/src/browser.rs`; the `browser_set_embed_rect`/reparent additions; the `windows` `Win32_UI_WindowsAndMessaging` feature; `chromiumoxide`/`sha2` deps if nothing else uses them.
- M1 engine-download UI: `src/app/core/setting/editor/browser-engine.tsx`, `src/lib/browser/engine-status.ts`, `engine-restart.ts`, `key-routing.ts` (+ tests) — superseded.

**Keep (re-wire data source only):**
- `tab-strip.tsx`, `bookmark-bar.tsx`, `bookmark-drawer.tsx`, `browser-drawer.tsx`, `browser-status-bar.tsx`, `downloads-drawer.tsx`, `find-bar.tsx`, `history-drawer.tsx`.

---

## Phase 0 — Branch, cleanup, and de-risking spike (DO THIS FIRST)

Native VNC/Docker behavior cannot be verified by code review — Phase 0 proves the whole stack on the user's actual Windows/WSL2 before any NoteGen integration is built. **STOP and report after the spike.**

### Task 0.1: Branch + discard the abandoned reparent changes
**Files:** git working tree.
- [ ] Create `feat/browser-novnc` from `main` (clean base; the CDP `feat/browser-cdp-engine` work stays on its own branch as history).
- [ ] Discard the uncommitted reparent/headful changes (Cargo `Win32_UI_WindowsAndMessaging`, `browser_engine.rs` headful + reparent helpers, `browser.rs` `embedded_hwnd`/`embed_rect`/`browser_set_embed_rect`).
- [ ] Verify `git status` clean; `cargo check` + `pnpm test:run` green on the fresh branch.

### Task 0.2: Run CloakBrowser-Manager locally and drive it
**Files:** none (manual spike on the user's machine).
- [ ] Confirm Docker Desktop/WSL2 is available (`docker version`).
- [ ] `git clone https://github.com/CloakHQ/CloakBrowser-Manager`, `docker compose up` (binds `127.0.0.1:8080`; CloakBrowser binary auto-downloads ~200MB on first launch).
- [ ] Open `http://localhost:8080`, create a profile, **Launch**, confirm the live browser renders via noVNC, **click + select text + right-click + scroll work natively**, and a Google search succeeds (stealth).
- [ ] From a terminal, `connect_over_cdp` to the proxied `/cdp` endpoint and read the page title — confirm the **same browser is scriptable** (the scraping path).
- [ ] Spike CJK IME: try typing 中文 in the VNC view. Record whether it composes; if not, note the ibus/fcitx image change needed.
- [ ] **Report findings** (works? latency? IME? clipboard?) before proceeding.

**Gate:** Only continue to Phase 1 if the spike shows the stack working acceptably on this machine.

---

## Phase 1 — noVNC viewer inside NoteGen

### Task 1.1: Add noVNC + URL helpers (TDD)
**Files:** Create `src/lib/browser/vnc-url.ts`, `src/lib/browser/vnc-url.test.ts`; `package.json`.
- [ ] Add dep: `pnpm add @novnc/novnc`.
- [ ] Write failing test for `buildVncWsUrl(base, profileId)` and `buildCdpHttpUrl(base, profileId)` (handles http→ws, https→wss, trailing slash).
- [ ] Run test → FAIL.
- [ ] Implement the pure helpers.
- [ ] Run test → PASS. Commit.

### Task 1.2: `browser-vnc.tsx` RFB viewer
**Files:** Create `src/app/core/main/browser/browser-vnc.tsx`.
- [ ] Component takes `{ wsUrl }`, dynamically `import('@novnc/novnc/core/rfb.js')`, mounts `new RFB(div, wsUrl, { wsProtocols: ['binary'] })` with `scaleViewport=true`, `resizeSession=false`; cleans up on unmount; handles disconnect/reconnect.
- [ ] Manual verify against the Phase-0 container: the live browser shows in the NoteGen panel with native mouse. Commit.

### Task 1.3: Mount it in the panel
**Files:** Modify `src/app/core/main/browser/index.tsx` (and/or `browser-webview.tsx`).
- [ ] Render `browser-vnc` (gated on sidecar-ready) where the screencast canvas was; keep nav-bar/tab-strip above.
- [ ] Manual verify: open the browser workspace → see the live stealth browser. Commit.

---

## Phase 2 — Sidecar lifecycle (Rust)

### Task 2.1: `browser_sidecar.rs` — detect + run + health
**Files:** Create `src-tauri/src/browser_sidecar.rs`; modify `lib.rs`/`main.rs`.
- [ ] `browser_sidecar_status` → `{ docker_present, running, base_url }` (shell out to `docker`; check `/api/status`).
- [ ] `browser_sidecar_ensure` → `docker compose up -d` (or `docker run`) the Manager image, poll `/api/status` until healthy; return base URL + auth token.
- [ ] Unit-test the pure parts (status parsing, URL building) with `cargo test`.
- [ ] Register commands. `cargo test` green. Commit.

### Task 2.2: profile launch/stop + endpoints
**Files:** `src-tauri/src/browser_sidecar.rs`; `src/lib/browser/manager-client.ts` (+ test).
- [ ] `browser_profile_launch` → Manager `POST /api/profiles` + `/launch`; return `{ vnc_ws_port, cdp_url }`.
- [ ] `browser_profile_stop` → Manager `/stop`; called on browser-workspace exit / app shutdown.
- [ ] Frontend `manager-client.ts` wraps these; `browser-vnc` consumes the returned vnc URL.
- [ ] Replace the old engine preflight/status/restart UI with sidecar status (Docker missing → actionable empty-state; starting → spinner). Commit.

---

## Phase 3 — Re-wire toolbar / nav / tabs / find / zoom to Manager CDP

### Task 3.1: CDP driver
**Files:** `src/lib/browser/manager-client.ts` (CDP over the proxied `/cdp` WS, or via the Manager's REST if it exposes nav).
- [ ] Implement navigate / back / forward / reload / get-url / get-title over CDP (`Page.navigate`, `Page.getNavigationHistory` + `navigateToHistoryEntry`).
- [ ] Re-point `browser-nav-bar.tsx` + `nav-state.ts` at it; keep the URL-bar-mirrors-active-tab behavior.

### Task 3.2: find-in-page + zoom + tabs
**Files:** `find.ts`, `zoom.ts`, `tab-strip.tsx`.
- [ ] Find via CDP; zoom via `Emulation`/`Page` or KasmVNC scale; tabs via Manager targets.
- [ ] Keep existing `find.test.ts`/`zoom.test.ts`/`nav-state.test.ts` green (adapt to the new driver). Commit per piece.

---

## Phase 4 — AI extraction, clipboard, IME

### Task 4.1: page-text extraction for AI
**Files:** `manager-client.ts`; AI call sites.
- [ ] Extract visible text / readable content via CDP (`Runtime.evaluate` / DOM snapshot) for「整理筆記/摘要」; verify the AI panel gets real page content.

### Task 4.2: clipboard 2-way
**Files:** `browser-vnc.tsx`.
- [ ] Port the Manager's approach: intercept Ctrl+V → `navigator.clipboard.readText()` → Manager `POST /clipboard` → send keystrokes; RFB `clipboard` event → `navigator.clipboard.writeText()`. Verify copy/paste both directions.

### Task 4.3: CJK IME (per Phase-0 finding)
**Files:** the Manager image (a `Dockerfile.notegen` overlay) or a clipboard-paste fallback.
- [ ] If the spike showed no in-container composition: add `fcitx`/`ibus` + a CJK font to the image, or implement compose-on-host → paste. Verify 注音 input works in the VNC browser. Commit.

---

## Phase 5 — Retire the CDP engine + housekeeping

### Task 5.1: delete dead code
**Files:** remove `browser-screencast.tsx`, `cdp_screencast.rs`, `cdp_events.rs`, `browser_engine.rs`; strip the `Input.*`/screencast/engine commands + reparent additions from `browser.rs`; drop `chromiumoxide`/`sha2`/`Win32_UI_WindowsAndMessaging` if unused; remove the M1 engine-download settings + `engine-status.ts`/`engine-restart.ts`/`key-routing.ts`.
- [ ] `cargo check` + `pnpm lint` + `pnpm test:run` green; no dead-code warnings. Commit.

### Task 5.2: tests + e2e mock
**Files:** `e2e/tauri-mock.ts`, `e2e/browser-ui.spec.ts`.
- [ ] Update the mock for the new sidecar/manager commands; adjust the browser-UI e2e to the noVNC panel. Commit.

---

## Phase 6 — Scraping surface (for the future use case)

### Task 6.1: expose CDP + profiles for scripting
**Files:** docs + a small helper.
- [ ] Document/connect: with the sidecar running, `connect_over_cdp(<manager>/api/profiles/{id}/cdp)` from Playwright (or `cloakserve` for headless multi-fingerprint). Surface profile/fingerprint/proxy management (the Manager already provides it) so the user can run multi-identity scraping against the same infrastructure.
- [ ] Note residential-proxy + `geoip` + `humanize` + pinned `--fingerprint` as the recommended anti-block config.

---

## Self-Review Notes

- **Spec coverage:** one-icon (sidecar, no second taskbar window) ✓; real browser + native input (noVNC RFB) ✓; stealth (CloakBrowser in-container) ✓; AI extraction + scraping (CDP) ✓; keep custom UI ✓; no-bundle license ✓ (auto-download in container).
- **Honesty:** Phases 1–6 have real unknowns (Docker on Windows, noVNC-in-Tauri-webview, IME) that **Phase 0 must de-risk first**; per-task code in Phases 3–4 will be finalized against the live container API during execution. This plan front-loads the spike rather than pretending the unknowns away.
- **LF only**; respect the no-bundle/no-mirror CloakBrowser constraint throughout.
