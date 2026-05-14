```markdown
# note-gen Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill covers the development patterns, coding conventions, and automated workflows used in the `note-gen` repository—a Next.js application written in TypeScript. The codebase features a hybrid frontend (React/TypeScript) and backend (Rust via Tauri), with a strong focus on browser feature development, robust testing, internationalization (i18n), and defensive coding practices. This guide will help you contribute efficiently and consistently by following established conventions and workflows.

## Coding Conventions

### File Naming

- **CamelCase** is used for file names:
  - Example: `findInPage.tsx`, `browserStore.ts`

### Import Style

- **Alias imports** are preferred for internal modules:
  ```ts
  import { useBrowserStore } from '@/stores/browser';
  import { findInPage } from '@/lib/browser/findInPage';
  ```

### Export Style

- **Mixed exports** are used (both default and named):
  ```ts
  // Named export
  export function findInPage() { ... }

  // Default export
  export default BrowserStore;
  ```

### Commit Patterns

- **Conventional commits** with the following prefixes:
  - `feat`: New feature
  - `fix`: Bug fix
  - `chore`: Maintenance
  - `docs`: Documentation
- **Average commit message length:** ~67 characters

  Example:
  ```
  feat(browser): add multi-tab support to browser store
  fix: handle null in findInPage helper
  ```

## Workflows

### Browser Feature Development

**Trigger:** When adding a new user-facing browser capability or enhancement  
**Command:** `/new-browser-feature`

1. Add or modify Rust commands and event emitters in `src-tauri/src/browser.rs` (and possibly `src-tauri/src/lib.rs` or `src-tauri/src/main.rs`).
2. Update or create frontend React components in `src/app/core/main/browser/*.tsx`.
3. Update or add zustand store logic and tests in `src/stores/browser.ts` and `src/stores/browser.test.ts`.
4. Add or modify pure logic helpers and unit tests in `src/lib/browser/*.ts` and `src/lib/browser/*.test.ts`.
5. Update i18n keys in `messages/*.json` for new UI strings.
6. Update or create database helpers and tests in `src/db/*.ts` if persistent data is needed.
7. Update capability JSONs if new permissions are required (`src-tauri/capabilities/*.json`).
8. Run and verify all tests (`vitest`, `cargo`, `tsc`, `eslint`, `playwright`).

**Example:**  
_Adding a "Find in Page" feature:_
- Implement Rust command in `src-tauri/src/browser.rs`
- Create `FindInPage.tsx` in `src/app/core/main/browser/`
- Update zustand store: `src/stores/browser.ts`
- Add helper: `src/lib/browser/findInPage.ts`
- Add i18n key: `messages/en.json`  
  ```json
  { "find_in_page": "Find in Page" }
  ```
- Run: `pnpm test`, `cargo test`, `pnpm lint`

---

### Test Infrastructure Upgrade

**Trigger:** When introducing or improving automated testing or migrating test tooling  
**Command:** `/upgrade-test-infra`

1. Install or upgrade test runner dependencies in `package.json` and `pnpm-lock.yaml`.
2. Add or update test config files (`vitest.config.ts`, `playwright.config.ts`, `vitest.setup.ts`).
3. Update `.gitignore` and ESLint config to handle new test artifacts.
4. Create or update test files (`e2e/*.spec.ts`, `src/lib/**/*.test.ts`, `src/stores/**/*.test.ts`).
5. Verify tests run and pass (`vitest`, `playwright`, etc.).

**Example:**  
_Adding Playwright e2e tests:_
- Install Playwright: `pnpm add -D @playwright/test`
- Create `playwright.config.ts`
- Add `.spec.ts` files in `e2e/`
- Update `.gitignore` for test artifacts

---

### i18n Keys Update

**Trigger:** When adding a new UI element or feature that requires user-facing text  
**Command:** `/update-i18n`

1. Add new keys or update existing ones in `messages/en.json`.
2. Propagate changes to all other locale files (`messages/zh.json`, `messages/zh-TW.json`, `messages/ja.json`, `messages/pt-BR.json`).
3. Reference new keys in React components or stores.

**Example:**  
_Adding a "Zoom In" button:_
- Add `"zoom_in": "Zoom In"` to `messages/en.json`
- Add translations to other locale files
- Use in component:
  ```tsx
  <Button>{t('zoom_in')}</Button>
  ```

---

### Defensive Bugfix and Mock Improvement

**Trigger:** When a test or audit reveals a runtime error, especially in mocked or test environments  
**Command:** `/fix-defensive-bug`

1. Identify and fix the bug in the relevant TypeScript or Rust file (e.g., add null checks).
2. Update or expand test mocks (`e2e/tauri-mock.ts`) to simulate missing plugin or runtime APIs.
3. Add or update error-audit or regression tests (`e2e/error-audit.spec.ts`).
4. Verify error count is reduced or eliminated in test runs.

**Example:**  
_Fixing a null reference in a store:_
```ts
if (browserTab) {
  // safe to proceed
} else {
  // handle missing tab
}
```
_Update `e2e/tauri-mock.ts` to mock new API_
_Add regression test to `e2e/error-audit.spec.ts`_

---

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test files:** Named with `.test.ts` suffix, located alongside source files or in relevant directories.
- **Test example:**
  ```ts
  // src/lib/browser/findInPage.test.ts
  import { findInPage } from './findInPage';

  test('finds text in page', () => {
    expect(findInPage('hello world', 'world')).toBe(6);
  });
  ```
- **Run all tests:**  
  ```
  pnpm test
  ```

## Commands

| Command                | Purpose                                                      |
|------------------------|--------------------------------------------------------------|
| /new-browser-feature   | Start a new browser feature development workflow             |
| /upgrade-test-infra    | Upgrade or add new test infrastructure                       |
| /update-i18n           | Add or update i18n translation keys                          |
| /fix-defensive-bug     | Fix defensive bugs and improve test mocks                    |
```