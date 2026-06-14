# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Deep-dive notes** live under `memory/` — see [`memory/INDEX.md`](memory/INDEX.md) for the list. Keep this file ≤ 200 lines; extract heavy content there.

## Project Overview

NoteGen is a cross-platform AI-powered note-taking app built with **Tauri 2** (Rust backend) + **Next.js 15** (React 19 frontend). It runs as a desktop app on Windows/macOS/Linux, ships an alpha Android build, and is buildable for iOS locally via `pnpm ios-build` (not currently published in the GitHub Releases distribution matrix). The core workflow: capture quick recordings/marks → organize into notes → enhance with AI dialogue.

This repo is a fork of [codexu/note-gen](https://github.com/codexu/note-gen) maintained at `TW199501/note-gen`. The upstream bundle identifier `com.codexu.NoteGen` is preserved intentionally (in `src-tauri/tauri.conf.json`); the updater endpoint points at this fork's GitHub releases.

## Development Commands

```
# Frontend dev server (Next.js + Turbopack, port 31415, bound to 0.0.0.0 for LAN)
pnpm dev

# Full Tauri desktop app (launches Rust backend + frontend together)
pnpm tauri dev

# Build frontend (Turbopack, static export to out/)
pnpm build

# Lint (flat ESLint config in eslint.config.mjs — not `next lint`)
pnpm lint

# Unit tests (Vitest + jsdom; picks up src/**/*.{test,vitest}.{ts,tsx})
pnpm test         # watch mode
pnpm test:run     # single run (use this for CI / agent verification)

# End-to-end tests (Playwright against the standalone Next.js dev server, NOT the Tauri shell)
pnpm e2e
pnpm e2e:ui

# Build the standalone docs/ subproject (VitePress, separate npm project — NOT the Tauri app)
pnpm docs:build

# Read version from src-tauri/tauri.conf.json and write it into the iOS Info.plist
# (CFBundleShortVersionString + CFBundleVersion). Does NOT touch package.json.
pnpm sync-version

# iOS build (runs sync-version, then opens Xcode)
pnpm ios-build
```

**Package manager:** pnpm (required — lockfile is pnpm-lock.yaml)

**Optional dev tooling — zread CLI:** `npm i -g zread_cli` installs the [`zread`](https://github.com/ZreadAI/zread_cli) doc-generator that the team-shared `.claude/skills/zread/` skill drives. Only required if you want Claude Code to generate / browse the wiki under `.zread/wiki/`. Skip if you only work on app code.

### Testing notes

*   **Vitest** (`vitest.config.ts`) runs jsdom-based unit tests under `src/`. Existing coverage is sparse — a handful of files under `src/db/`, `src/lib/browser/`, `src/stores/`. Add tests next to the file under test using the `.test.ts(x)` suffix
*   **Playwright** (`playwright.config.ts`) runs against the bare Next.js dev server on `:31415`, **not inside the Tauri shell**. Because there is no real Tauri runtime in a normal Chromium, `e2e/tauri-mock.ts` injects an IPC shim so `invoke()` calls don't blow up the React tree. The mock returns canned answers — anything that depends on real SQL / filesystem / WebView behavior will no-op. Real Tauri-shell e2e (back/forward state, Cmd+F, zoom, devtools) needs `tauri-driver` and isn't configured yet
*   Playwright defaults to **headed mode with 500ms slowMo** for visual review; set `PLAYWRIGHT_HEADLESS=1` (and optionally `PLAYWRIGHT_SLOWMO=0`) when running in the background or in CI

## Architecture

### Frontend (`src/`)

*   **Framework:** Next.js 15 with App Router, static export mode (`output: "export"`) for Tauri embedding
*   **Routing:** `src/app/` — main app lives under `src/app/core/` with `main/` (workspace) and `setting/` (configuration) sections
*   **State:** Zustand stores in `src/stores/` (~27 stores). `setting.ts` is the single source of truth for AI provider/model configuration — changes here flow into `src/lib/ai/*`. Most stores persist via `@tauri-apps/plugin-store`
*   **UI:** shadcn/ui (New York style, zinc base) + Radix primitives + Lucide icons. Components in `src/components/ui/`
*   **Editor:** Tiptap 3 with 20+ extensions (tables, code blocks, math/KaTeX, mermaid diagrams, etc.)
*   **Styling:** Tailwind CSS v4 with CSS variables for theming. `cn()` utility from `src/lib/utils.ts` merges clsx + tailwind-merge
*   **i18n:** next-intl with message files in `messages/` (en, zh, zh-TW, ja, pt-BR). Use `useTranslations()` hook
*   **Path alias:** `@/*` maps to `./src/*`
*   **Dev tooling:** SpecSnap (`@tw199501/specsnap-inspector-react`, `src/lib/specsnap/`, `src/components/specsnap/`) is a dev-only inspector overlay — not a runtime feature

### Backend (`src-tauri/`)

*   **Rust/Tauri 2** with plugins for: SQL (SQLite), filesystem, HTTP, shell, clipboard, dialog, global shortcuts, store, updater, window state
*   **Database:** SQLite via `tauri-plugin-sql` (file `sqlite:note.db`), initialized in `src/db/index.ts`. Tables: chats, conversations, marks, notes, tags, vector, memories, activity, bookmarks, browser-history, downloads (the last four back the in-app browser feature). The init order in `initAllDatabases()` is load-bearing: `initChatsDb` runs **before** `initConversationsDb` because the conversations init migrates/patches columns against the chats table — do not reorder casually
*   **Tauri commands** defined in Rust modules under `src-tauri/src/`: `ai.rs`, `app_menu.rs`, `app_setup.rs`, `backup.rs`, `browser_chromium.rs` (bundled-Chromium child-process + owner-overlay, Windows-only — see *In-app Browser* below), `device.rs`, `fuzzy_search.rs`, `keywords.rs`, `mcp.rs` + `mcp_runtime.rs` (command surface vs. long-lived runtime), `screenshot.rs`, `skills.rs`, `statusbar.rs`, `tray.rs`, `window.rs`
*   **Chinese text processing:** jieba-rs for segmentation (desktop only, not mobile)

### AI Integration (`src/lib/ai/`)

*   Uses both OpenAI SDK (`openai`) and Anthropic SDK (`@anthropic-ai/sdk`) with configurable providers/models. Provider routing is driven by `src/stores/setting.ts`
*   Key modules: `chat.ts` (completion), `completion.ts`, `embedding.ts` (vectors), `rewrite.ts`, `translate.ts`, `description.ts`. `tauri-client.ts` wraps Rust-side AI calls. Public surface is re-exported from `src/lib/ai/index.ts`
*   **RAG:** Vector embeddings + BM25 search in `src/lib/rag.ts` using SQLite vector table
*   **Agents:** ReAct pattern in `src/lib/agent/` with tool definitions in `src/lib/agent/tools/`
*   **MCP:** Model Context Protocol support in `src/lib/mcp/` with Rust runtime in `src-tauri/src/mcp_runtime.rs` (and command bindings in `mcp.rs`)

### Sync (`src/lib/sync/`)

Multiple sync backends: GitHub, GitLab, Gitea, Gitee, WebDAV, S3. Orchestrated via `sync-manager.ts` with a `sync-push-queue.ts` to serialize writes; conflict handling lives in `conflict-resolution.ts`. Configuration is in the settings store.

### In-app Browser (Bundled Chromium child process + owner-overlay — Windows)

Ships full ungoogled-chromium (BSD) and launches `chrome.exe` as a child process; native Chrome UI is glued into a `data-chromium-panel` div via Win32 owner-overlay (`GWLP_HWNDPARENT`). Lazy launch on `chromium_show`; `chromium_hide` parks offscreen; exit watcher auto-restarts once on crash. Windows-only (`#[cfg(target_os = "windows")]`). Dev requires `pnpm fetch-chromium` (177 MB) before first run.

**Full mechanics + history** in [`memory/browser-architecture.md`](memory/browser-architecture.md). **Don't re-propose** CDP / `SetParent` / WebView2 / CloakBrowser / noVNC / raw `browser_host` / CEF Views — all failed, reasons in [`memory/browser-rejected-approaches.md`](memory/browser-rejected-approaches.md). **v2 vision** (chat sidebar moves INSIDE Chromium via extension) in `docs/superpowers/specs/2026-06-14-browser-integrated-chat-vision.md`.

### Key Data Flow

1.  Tauri config (`src-tauri/tauri.conf.json`) defines `beforeDevCommand: "pnpm dev"` and `devUrl: "http://localhost:31415"`
2.  Next.js builds static HTML/JS to `out/` which Tauri serves as the app frontend
3.  Frontend communicates with Rust backend via Tauri's IPC (`@tauri-apps/api`)
4.  SQLite database stores all persistent data (chats, notes, vectors, etc.)
5.  Settings are persisted separately via `@tauri-apps/plugin-store`

## Conventions

*   Code comments and variable naming mix Chinese and English — this is intentional and expected
*   The `src/stores/setting.ts` store uses a pattern: each setting has a getter, setter, and persistence via Tauri Store
*   Database operations follow the pattern in `src/db/` — each module exports an `init*Db()` function and CRUD operations
*   Forms use react-hook-form + zod for validation
*   Tauri commands are invoked from frontend via `invoke()` from `@tauri-apps/api/core`

## Gotchas

Rules listed here; **backstories + why** in [`memory/gotchas.md`](memory/gotchas.md).

*   **LF line endings only.** Verify `file <path> | grep CRLF` before every commit; Edit tool on Windows can leak CRLF.
*   **Dev port is 31415 (π), not 3456.** VSCodium Insiders steals 3456; Windows TCP routing rule "specific IP wins over `0.0.0.0`" causes WebView to hit Codium's 404 instead of Next.js.
*   **"DB can't connect" in dev = zombie sidecar holding a port, NOT a real DB problem.** Check `netstat` / `Get-NetTCPConnection`, kill the orphan first.
*   **Static export (`output: "export"`) = no Next.js server features.** No route handlers, no server actions, no dynamic API routes. Backend logic goes through Tauri commands.
*   **`withGlobalTauri: true`** is set, so `window.__TAURI__` is available — but **prefer typed imports** from `@tauri-apps/api/core` for new code.
*   **Don't open files under `.next/`, `out/`, `src-tauri/target/`, or `src-tauri/gen/` in VSCode** — and don't remove those entries from `tsconfig.json`'s `exclude`. With `"allowJs": true`, opening a Next.js compiled chunk floods Problems panel with 100+ phantom errors (CLI lint stays clean — that's the tell). Close tab + `TypeScript: Restart TS Server`.

## Release Process

Pushing to the `release` branch triggers `.github/workflows/release.yml` which builds for Windows, macOS universal, Linux deb/rpm, and Android APK/AAB, and publishes successful artifacts **to GitHub Releases only**. (Upstream `codexu/note-gen` also pushes to a separate UpgradeLink CDN; that integration was dropped when this fork diverged. The workflow contains no `UPGRADE_LINK_*` secrets or upload step.) Version is sourced from `src-tauri/tauri.conf.json`.

**CI reality in this fork:** only the Windows and Linux jobs succeed reliably. The macOS×2 and Android jobs consistently fail because the Apple Developer ID signing cert and the Android release keystore secrets are not yet configured in the repository's GitHub Actions secrets. Don't treat those red Xs as code regressions unless the user explicitly asks — the workflow file is correct, the secrets just aren't set.