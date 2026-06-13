# NoteGen noVNC In-App Browser — Stabilization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Get the noVNC-streamed CloakBrowser in-app browser to a stable, reviewed, committed state on branch `feat/browser-novnc`.

**Architecture:** NoteGen runs a local CloakBrowser-Manager Docker sidecar (`notegen-cloakbrowser`, KasmVNC + headful CloakBrowser + FastAPI on `127.0.0.1:8080`). The webview streams the browser via `@novnc/novnc` RFB over `/vnc` and (future) drives it via `/cdp`. The browser binary auto-downloads in-container (never bundled).

**Tech stack:** Tauri 2 / Rust sidecar (`browser_sidecar.rs`), Next.js 15 / React 19 frontend, `@novnc/novnc`, Docker.

**Hard constraints (RESEARCHED — out of scope, do NOT attempt):**
- Same-origin WebSocket to drop the CSP `connect-src ws://` requirement is **impossible in Tauri** (custom URI schemes don't do WS upgrades — tauri-apps/tauri#11953). The CSP line + (loopback) cross-origin are permanent.
- Bundling a real browser is **impossible** (CloakBrowser binary is no-redistribution). Docker is therefore a hard dependency; treat the browser as an optional/advanced feature.

---

## STATUS — changes already made this session (UNCOMMITTED — review & approve before commit)

All on `feat/browser-novnc`, working tree only. Verified at code level: `cargo check` ✅, `tsc --noEmit` ✅, `eslint` ✅, `vitest` 67/67 ✅, LF ✅. **NOT yet visually verified in the real Tauri+Docker app.**

1. **Resolution (DPR)** — `src/app/core/main/browser/browser-host.tsx`: remote desktop now sized in CSS px (dropped `* devicePixelRatio`). `src/lib/browser/manager-client.ts`: comment fixed.
2. **Right-click overlap** — `src/components/app-context-menu.tsx`: skip (but keep `preventDefault`) when target is inside `[data-app-browser]`; `browser-vnc.tsx`: added `data-app-browser`.
3. **Obsolete native-WebView hide/show removed** — `src/app/core/main/page.tsx` + `src/app/core/layout.tsx`.
4. **VNC robustness** — `browser-vnc.tsx`: bounded auto-reconnect on unclean 1006 (`MAX_AUTO_RETRIES=3`, budget refilled only after 5s stable) + `resizeSession = true`.
5. **Sidecar container dedup + stop-on-exit** — `src-tauri/src/browser_sidecar.rs` (`sweep_dormant_strays` / `remove_image_containers` / `stop_container`), wired into `main.rs` `RunEvent::Exit`.
6. **Phase 5 dead-code removal** — deleted 11 orphan frontend files + `src-tauri/src/browser.rs` + `capabilities/browser-bridge.json`; cleaned `main.rs`/`lib.rs`; decoupled `title-bar.tsx` from old `BrowserToolbar`.
7. **頂天 layout** — `core/layout.tsx` (drop 36px offset in browser mode), `title-bar.tsx` (right-hand control island), `page.tsx` (chat `pt-9`). Playwright-probe-verified `browserFrame.y` 36→0.

> Decision needed from user: keep all of the above and commit, or revert/adjust any item.

---

## Task 1: User live-verification in the real app (BLOCKING — needs Docker GUI, only the user can see it)

**Files:** none (manual).

- [ ] **Step 1:** Fully restart `pnpm tauri dev` (Rust changed → must recompile).
- [ ] **Step 2:** Enter browser mode. Confirm:
  - 頂天: the embedded browser reaches the very top on the left; only a right-hand control island remains.
  - Sizing: page/text matches the right chat panel's scale; whether the ~10px letterbox is gone (tells us if the Manager honours `resizeSession`/ExtendedDesktopSize).
  - Right-click in the browser shows ONLY the native Chrome menu (no NoteGen menu).
  - A transient 1006 auto-reconnects (no manual Retry).
- [ ] **Step 3:** Close NoteGen → `docker ps` shows NO `notegen-cloakbrowser` (stop-on-exit).
- [ ] **Step 4:** Report results. If the ~10px letterbox persists, `resizeSession` is unsupported by the Manager → see Task 4.

---

## Task 2: Remove the obsolete e2e spec for the deleted old chrome

**Files:**
- Delete: `e2e/browser-ui.spec.ts` (it drives the now-deleted native-WebView chrome: tab-strip, nav-bar, find-bar).

- [ ] **Step 1:** Confirm it only targets deleted UI: `grep -n "browser_tabs\|tab-strip\|nav-bar\|find-bar" e2e/browser-ui.spec.ts`.
- [ ] **Step 2:** `git rm e2e/browser-ui.spec.ts`.
- [ ] **Step 3:** Run `pnpm test:run` (vitest unaffected) → expect 67 passing. (`pnpm e2e` no longer has the obsolete spec.)
- [ ] **Step 4:** Commit: `git commit -m "test(browser): drop e2e spec for deleted native-WebView chrome"`.

---

## Task 3: Friendly no-Docker onboarding (optional — user to confirm if wanted)

**Files:**
- Modify: `src/app/core/main/browser/browser-host.tsx` (the `no-docker` branch message).
- Possibly add i18n keys in `messages/*.json`.

- [ ] **Step 1:** Replace the bare "Docker not running" string with a short explanation that the browser is an advanced feature needing Docker Desktop + a link, via i18n keys.
- [ ] **Step 2:** `pnpm exec tsc --noEmit && pnpm lint`.
- [ ] **Step 3:** Commit.

> Deferred unless the user asks — not blocking.

---

## Task 4: (Conditional) deterministic resize if `resizeSession` is unsupported

Only if Task 1 shows the letterbox persists on the real Manager.

**Files:** `src-tauri/src/browser_sidecar.rs`, `src/lib/browser/manager-client.ts`, `browser-host.tsx`.

- [ ] **Step 1:** Investigate the Manager API for a profile/desktop resize endpoint (read the CloakBrowser-Manager source in the cloned image, or `GET {BASE_URL}/openapi.json`).
- [ ] **Step 2:** If one exists, add a `browser_profile_resize` command + call it from a debounced ResizeObserver in `browser-host.tsx`.
- [ ] **Step 3:** If none exists, document the limitation; do NOT re-launch on drag (loses page state).

> No code written for this until Task 1 proves it's needed.

---

## Verification (run after each task's code changes)

```
pnpm exec tsc --noEmit
pnpm lint
pnpm test:run
cargo check --manifest-path src-tauri/Cargo.toml
```
Plus LF check on edited files (`grep -c $'\r' <file>` → 0). Visual/canvas checks are Task 1 (user-only — no Tauri GUI available to the agent; Playwright can measure layout boxes but not the noVNC canvas).

## Commit strategy

The STATUS changes (1–7) are cohesive. Recommend committing them as a small series once Task 1 confirms they work, e.g.:
- `fix(browser): size noVNC desktop in CSS px (kill dpr-shrink)`
- `fix(browser): native-only right-click + auto-reconnect + resizeSession`
- `feat(browser): sidecar container dedup + stop-on-exit`
- `refactor(browser): remove dead native-WebView stack (Phase 5)`
- `feat(browser): browser reaches window top (頂天) in browser mode`
