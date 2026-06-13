---
name: test-driven-development-with-plan-docs
description: Workflow command scaffold for test-driven-development-with-plan-docs in note-gen.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-driven-development-with-plan-docs

Use this workflow when working on **test-driven-development-with-plan-docs** in `note-gen`.

## Goal

Add or expand test coverage for a component, guided by a written test plan, with mutation verification and review-driven iteration.

## Common Files

- `docs/superpowers/plans/*.md`
- `src/app/core/main/browser/*.test.tsx`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Write a test plan in docs/superpowers/plans/ describing test cases and mutation checks.
- Implement or expand tests in the relevant *.test.tsx file.
- Mutation-verify each test by temporarily breaking production code and confirming test failure.
- Address code review feedback by adding new test cases or tightening existing ones.
- Update the plan doc to reflect any changes or corrections in test coverage.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.