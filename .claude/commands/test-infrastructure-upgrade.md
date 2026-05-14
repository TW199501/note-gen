---
name: test-infrastructure-upgrade
description: Workflow command scaffold for test-infrastructure-upgrade in note-gen.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-infrastructure-upgrade

Use this workflow when working on **test-infrastructure-upgrade** in `note-gen`.

## Goal

Adds or upgrades test infrastructure (unit, integration, e2e), configures test runners, and updates ignore/config files.

## Common Files

- `package.json`
- `pnpm-lock.yaml`
- `vitest.config.ts`
- `vitest.setup.ts`
- `playwright.config.ts`
- `eslint.config.mjs`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Install or upgrade test runner dependencies in package.json and pnpm-lock.yaml
- Add or update test config files (e.g., vitest.config.ts, playwright.config.ts, vitest.setup.ts)
- Add or update .gitignore and ESLint config to handle new test artifacts
- Create or update test files (e2e/*.spec.ts, src/lib/**/*.test.ts, src/stores/**/*.test.ts)
- Verify tests run and pass (vitest, playwright, etc.)

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.