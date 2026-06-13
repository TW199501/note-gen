---
name: spec-plan-implementation-workflow
description: Workflow command scaffold for spec-plan-implementation-workflow in note-gen.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /spec-plan-implementation-workflow

Use this workflow when working on **spec-plan-implementation-workflow** in `note-gen`.

## Goal

Drive a major feature or architecture change from design spec, to implementation plan, to code, to documentation and archival of prior attempts.

## Common Files

- `docs/superpowers/specs/*.md`
- `docs/superpowers/plans/*.md`
- `docs/superpowers/specs/archive/*.md`
- `docs/superpowers/plans/archive/*.md`
- `src-tauri/src/*.rs`
- `src-tauri/tauri.windows.conf.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Write a design spec in docs/superpowers/specs/ (or specs/archive/ for historical context).
- Write an implementation plan in docs/superpowers/plans/ (or plans/archive/ for historical context).
- Implement code changes across src-tauri/, src/app/core/main/browser/, scripts/, etc.
- Update .gitignore or package.json if new scripts or resources are added.
- Bundle new resources/configs as needed (e.g., tauri.windows.conf.json).

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.