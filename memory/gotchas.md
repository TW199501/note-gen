# Gotchas — backstories

> Extracted from CLAUDE.md 2026-06-14. CLAUDE.md lists the **rules**; this file explains **why** each rule exists. Reading the why helps judge edge cases.

## LF line endings only

This repo expects Unix line endings. Windows tooling that introduces CRLF causes:

- Noisy diffs (every line shows as changed)
- Breakage in some Rust / shell scripts that parse line-by-line and don't strip `\r`

The `Edit` tool on Windows has leaked CRLF on multi-edit operations. Always `file <path> | grep CRLF` before commit, or use `dos2unix` / `sed -i 's/\r$//' <path>` to fix.

`.editorconfig` enforces this for compliant editors. Pre-commit hooks could go further but currently we rely on the audit-before-commit pattern.

## Dev port 31415 (π) — and why not 3456

`next dev` binds `0.0.0.0:31415` (for LAN access from a phone running Tauri-mobile dev builds). `next.config.ts` honors `TAURI_DEV_HOST` for `assetPrefix` so a phone on the same network can load static assets — set it before `pnpm tauri dev` for mobile testing.

**Why not the more conventional 3456?** VSCodium Insiders consistently grabs `127.0.0.1:3456` for its inspector utility worker — its Node `--inspect-port=0` falls through to a fixed default in the bundled Chromium build. The symptom we hit: Tauri WebView opened `http://localhost:3456` and got Codium's `{"error":"Not found"}` JSON 404 instead of Next.js. Root cause is Windows TCP stack's "specific IP wins over `0.0.0.0`" routing — Codium binds `127.0.0.1:3456`, Next.js binds `0.0.0.0:3456`, and Windows routes `localhost` requests to the more specific bind. Moved to π for memorability and to escape the conflict.

## "DB can't connect" in dev usually = zombie sidecar

Symptom: NoteGen dev launch errors with "database connection refused" / "port already in use" for the SQL plugin's helper sidecar.

Cause: Tauri's dev runner can leave Rust sidecar processes alive after a crash. The orphan holds the port; next launch fails because the port is occupied.

Fix: check `netstat -ano | findstr <port>` (or PowerShell `Get-NetTCPConnection -LocalPort <port>`), kill the orphan PID via Task Manager or `taskkill /PID <pid> /F`, then relaunch. Don't waste time debugging the DB code first — the symptom is misleading.

Common ports to check: 5555 (DB sidecar in some configurations), 31415 (Next.js dev). See `project_notegen_sidecar_port` for the original incident.

## Static export = no Next.js server features

`output: "export"` is set in `next.config.ts`. Consequence: anything that requires a Node.js runtime at request time is unavailable:

- Route handlers (`app/api/*/route.ts`)
- Server actions (`"use server"`)
- Dynamic API routes (`app/api/[id]/route.ts` with `dynamic = 'force-dynamic'`)
- Image optimization (next/image's loader server)

All backend logic must go through **Tauri commands** (`#[tauri::command]` in Rust, `invoke('cmd_name', args)` from React). The benefit is the static export can be embedded directly in Tauri's asset server with zero runtime overhead.

## `withGlobalTauri: true`

Set in `tauri.conf.json`, so `window.__TAURI__` is available globally in the WebView. Legacy convenience.

**For new code, prefer the typed imports**: `import { invoke } from '@tauri-apps/api/core'`. The global is here for `vendor-shim` situations where third-party scripts need to detect Tauri without imports.

## Don't open files under `.next/` / `out/` / `src-tauri/target/` / `src-tauri/gen/` in VSCode

And don't remove these entries from `tsconfig.json`'s `exclude`.

**Symptom:** Problems panel suddenly floods with 100+ phantom errors against minified build output that didn't exist seconds ago.

**Cause:** With `"allowJs": true` set in `tsconfig.json`, the TypeScript Language Server analyzes any opened `.js` / `.js.map` whose path isn't excluded. When someone opens a Next.js compiled chunk (e.g., `out/_next/static/chunks/...js`), TS Server type-checks the minified code and reports a flood of errors.

**Distinguishing tell:** CLI tools (`pnpm lint`, `pnpm exec tsc --noEmit`) only walk `include` (`**/*.ts(x)`), so they NEVER see this. Symptom is "Problems panel is full but the CLI is clean" — that's the signature.

**Fix:** Close the build-artifact tab. Run `TypeScript: Restart TS Server` from the command palette. Problems panel clears.
