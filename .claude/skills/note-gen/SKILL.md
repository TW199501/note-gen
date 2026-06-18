```markdown
# note-gen Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns, coding conventions, and collaborative workflows used in the `note-gen` repository. The project is a TypeScript codebase built with Next.js, featuring a strong focus on test-driven development, conventional commits, and structured documentation for major features and testing plans. You'll learn how to contribute new features, expand test coverage, and respond to code review feedback using standardized processes and commands.

## Coding Conventions

### File Naming

- Use **kebab-case** for all file and directory names.
  - Example: `browser-panel.tsx`, `note-list.spec.ts`

### Import Style

- Use **alias-based imports** rather than relative paths.
  - Example:
    ```typescript
    import { BrowserPanel } from '@core/main/browser/browser-panel'
    ```

### Export Style

- Mixed usage of **named** and **default exports**.
  - Example (named export):
    ```typescript
    export function createNote() { ... }
    ```
  - Example (default export):
    ```typescript
    export default NoteList
    ```

### Commit Messages

- Use **Conventional Commits** with these prefixes: `docs`, `test`, `fix`, `build`, `feat`, `refactor`.
- Keep commit messages concise (average ~62 characters).
  - Example:
    ```
    feat: add browser panel state persistence
    fix: correct note sorting logic in list view
    ```

## Workflows

### spec-plan-implementation-workflow

**Trigger:** When introducing a major new feature or architectural change  
**Command:** `/new-major-feature`

1. **Write a design spec** in `docs/superpowers/specs/` (or archive in `specs/archive/` if superseded).
2. **Draft an implementation plan** in `docs/superpowers/plans/` (or archive in `plans/archive/` if superseded).
3. **Implement code changes** across relevant folders:
    - `src-tauri/`
    - `src/app/core/main/browser/`
    - `scripts/`
4. **Update configuration** as needed:
    - `.gitignore`
    - `package.json`
    - Add new resource/config files (e.g., `tauri.windows.conf.json`)
5. **Archive old specs/plans** in the corresponding `archive/` directories.

**Example Directory Structure:**
```
docs/superpowers/specs/my-feature.md
docs/superpowers/plans/my-feature-plan.md
src/app/core/main/browser/my-feature.tsx
```

---

### test-driven-development-with-plan-docs

**Trigger:** When adding or improving test coverage for a component  
**Command:** `/add-test-coverage`

1. **Write a test plan** in `docs/superpowers/plans/` describing test cases and mutation checks.
2. **Implement or expand tests** in the relevant `*.test.tsx` file.
    - Example:
      ```typescript
      // src/app/core/main/browser/browser-panel.test.tsx
      import { render } from '@testing-library/react'
      import { BrowserPanel } from './browser-panel'

      test('renders panel title', () => {
        const { getByText } = render(<BrowserPanel />)
        expect(getByText('Panel')).toBeInTheDocument()
      })
      ```
3. **Mutation-verify tests**: Temporarily break production code to confirm test failure.
4. **Address code review feedback**: Add or tighten tests as needed.
5. **Update the plan doc** to reflect any changes in test coverage.

---

### code-review-driven-fix-workflow

**Trigger:** When receiving code review feedback on a recent feature or test  
**Command:** `/apply-review-feedback`

1. **Review feedback** and identify actionable items.
2. **Apply fixes or improvements** to code (e.g., error handling, comments, guards).
3. **Update or add tests** to cover new or revised behavior.
4. **Update documentation or plan docs** if test coverage or implementation details change.

**Example:**
```typescript
// Before: missing null check
function getNoteTitle(note) {
  return note.title.trim()
}

// After: with guard
function getNoteTitle(note) {
  if (!note || !note.title) return ''
  return note.title.trim()
}
```

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test file pattern:** `*.spec.ts`
- **Location:** Tests are colocated with source files, especially under `src/app/core/main/browser/`.
- **Test plans:** Written in markdown under `docs/superpowers/plans/` to guide and document coverage.
- **Mutation verification:** Intentionally break code to ensure tests fail as expected.

**Example Test:**
```typescript
// src/app/core/main/browser/note-list.spec.ts
import { describe, it, expect } from 'vitest'
import { getSortedNotes } from './note-list'

describe('getSortedNotes', () => {
  it('sorts notes by date', () => {
    // test implementation
  })
})
```

## Commands

| Command                | Purpose                                                    |
|------------------------|------------------------------------------------------------|
| /new-major-feature     | Start the spec/plan/implementation workflow for big changes|
| /add-test-coverage     | Begin test-driven development with a written plan          |
| /apply-review-feedback | Apply code review-driven fixes and improvements            |
```
