---
name: browser-feature-development
description: Workflow command scaffold for browser-feature-development in note-gen.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /browser-feature-development

Use this workflow when working on **browser-feature-development** in `note-gen`.

## Goal

Implements a new browser feature (e.g., find-in-page, zoom, devtools toggle, multi-tab, downloads) including backend (Rust), frontend (React/TypeScript), store, i18n, and tests.

## Common Files

- `src-tauri/src/browser.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/main.rs`
- `src/app/core/main/browser/*.tsx`
- `src/stores/browser.ts`
- `src/stores/browser.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add/modify Rust commands and event emitters in src-tauri/src/browser.rs (and sometimes src-tauri/src/lib.rs or src-tauri/src/main.rs)
- Update or create frontend React components in src/app/core/main/browser/*.tsx
- Update or add zustand store logic and tests in src/stores/browser.ts and src/stores/browser.test.ts
- Add/modify pure logic helpers and unit tests in src/lib/browser/*.ts and src/lib/browser/*.test.ts
- Update i18n keys in messages/*.json for new UI strings

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.