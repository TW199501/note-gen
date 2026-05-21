# Lint 清理計畫

> 範圍：清掉 `pnpm lint` 報的 27 個 warning（0 errors, 27 warnings）
> 最後更新：2026-05-21

---

## Context

`pnpm lint` 目前回報 27 個 warning，分布在 10 個檔案。沒有 error，但 warning 量大、雜訊干擾後續改動，也讓 CI/PR review 較難看出新引入的真實問題。

調查後三個根因都很明確、無爭議：

1. **配置與註解失同步**：[eslint.config.mjs:29-30](../eslint.config.mjs#L29-L30) 已把 `react-hooks/exhaustive-deps` 跟 `@typescript-eslint/no-explicit-any` 設為 `"off"`，但程式碼中還有 21 個對應的 `eslint-disable` directive 殘留。它們是規則被關掉之前的歷史殘留，現在全是 dead code。CLAUDE.md 的「Conventions」段落明確要求這兩條規則維持 off，所以**正確修法是刪 disable，不是改規則**。
2. **eslint 設定缺常規豁免**：`e2e/tauri-mock.ts` 為了符合 Tauri runtime 簽名，用 `_once`、`_message`、`_event`、`_eventId` 這種底線命名表示「故意未使用」，但 eslint 沒設 `argsIgnorePattern: "^_"`，所以還是被報 unused。
3. **兩個獨立小 bug**：[md-editor-wrapper.tsx:4](../src/app/core/main/editor/markdown/md-editor-wrapper.tsx#L4) 有真實未使用的 `useMemo` import；[eslint.config.mjs:12](../eslint.config.mjs#L12) 把陣列直接 `export default [...]`，觸發 `import/no-anonymous-default-export`。

預期成果：執行完後 `pnpm lint` 為 0 errors / 0 warnings。

---

## 修復步驟

### Step 1 — 改 eslint 設定（[eslint.config.mjs](../eslint.config.mjs)）

兩個改動，一次完成。

```diff
- export default [
+ const eslintConfig = [
    {
      ignores: [...],
    },
    ...compat.extends("next/core-web-vitals", "next/typescript"),
    {
      rules: {
        "react-hooks/exhaustive-deps": "off",
        "@typescript-eslint/no-explicit-any": "off",
+       "@typescript-eslint/no-unused-vars": ["warn", {
+         argsIgnorePattern: "^_",
+         varsIgnorePattern: "^_",
+         caughtErrorsIgnorePattern: "^_",
+       }],
      },
    },
- ]
+ ]
+
+ export default eslintConfig
```

**1a.** 改 anonymous default export → 修 `import/no-anonymous-default-export`。
**1b.** 加 `no-unused-vars` 底線豁免 → 解決 [tauri-mock.ts](../e2e/tauri-mock.ts) 的 4 個 warning（`_once`、`_message`、`_event`、`_eventId`）。這是業界標準作法，不影響既有非底線 unused vars 偵測。

> 注意：`next/typescript` 預設會 enable `@typescript-eslint/no-unused-vars`，我們在最後一個 rules block 覆寫設定，order 已經對。

### Step 2 — 跑 `pnpm lint --fix`

ESLint 報的 21 個 unused-disable warning 是 `--fix` 可自動處理的（lint 輸出明說 "21 warnings potentially fixable with the `--fix` option"，數字吻合）。預期會自動刪除以下 directive：

| 檔案 | 行號 | directive 類型 |
|---|---|---|
| [e2e/tauri-mock.ts](../e2e/tauri-mock.ts#L17) | 17 / 183 | `eslint-disable` / `eslint-enable` 一對 `@typescript-eslint/no-explicit-any` |
| [src/app/core/main/editor/markdown/ai-completion.tsx](../src/app/core/main/editor/markdown/ai-completion.tsx) | 110, 154, 156, 166 | 4× `eslint-disable-next-line @typescript-eslint/no-explicit-any` |
| [src/app/core/main/editor/markdown/markdown-input-rules.ts](../src/app/core/main/editor/markdown/markdown-input-rules.ts) | 20, 30, 40, 50, 60, 71, 82, 93 | 8× `@typescript-eslint/no-explicit-any` |
| [src/app/core/main/editor/markdown/tiptap-editor.tsx](../src/app/core/main/editor/markdown/tiptap-editor.tsx#L449) | 449 | `react-hooks/exhaustive-deps` |
| [src/app/core/main/mark/mark-list.tsx](../src/app/core/main/mark/mark-list.tsx#L46) | 46 | `react-hooks/exhaustive-deps` |
| [src/app/core/main/mark/tag-manage.tsx](../src/app/core/main/mark/tag-manage.tsx#L383) | 383 | `react-hooks/exhaustive-deps` |
| [src/components/title-bar-toolbars/sync-toggle.tsx](../src/components/title-bar-toolbars/sync-toggle.tsx#L3) | 3 | `@typescript-eslint/no-explicit-any` |
| [src/lib/sync/sync-push-queue.ts](../src/lib/sync/sync-push-queue.ts) | 54, 56, 58, 60 | 4× `@typescript-eslint/no-explicit-any` |

> ⚠️ 注意 [tauri-mock.ts](../e2e/tauri-mock.ts) 的 17/183 是 `disable`/`enable` 一對；ESLint 只報 17 行 unused。`--fix` 通常會把成對刪除，但**核准執行時要肉眼確認 183 行的 `eslint-enable` 也一起被移掉**，否則會有孤兒 `eslint-enable` 殘留。如果 `--fix` 沒清乾淨，手動刪 183 行。

### Step 3 — 手動修真實 dead import

[src/app/core/main/editor/markdown/md-editor-wrapper.tsx:4](../src/app/core/main/editor/markdown/md-editor-wrapper.tsx#L4) 移除 `useMemo`：

```diff
- import { useEffect, useState, useCallback, useRef, RefObject, useMemo } from 'react'
+ import { useEffect, useState, useCallback, useRef, RefObject } from 'react'
```

`--fix` 通常**不會自動刪未使用的 import**（避免破壞副作用 import），所以這步要手動。

---

## 不做的事 / 替代方案

- **不**重新打開 `react-hooks/exhaustive-deps` 或 `@typescript-eslint/no-explicit-any`。CLAUDE.md 規範明確要求維持 off，重新啟用會引入大量真實 error。
- **不**把 `tauri-mock.ts` 的 `_once`/`_message`/`_event`/`_eventId` 改名或刪掉，因為它們是 mock 函式為了對齊 Tauri runtime API 簽名而存在的、被外部呼叫的 callback 參數，刪掉會破壞 mock 行為（runtime 仍會傳這些引數進來）。在 eslint 加 `argsIgnorePattern` 才是對的修法。
- **不**用一行 `eslint-disable-next-line` 蓋掉 anonymous default export — 改成 named const 是更乾淨、不增加雜訊的作法。

---

## 驗證

1. `pnpm lint` → 預期 `0 errors, 0 warnings`
2. `pnpm test:run` → 確認單元測試沒被影響（特別是 [src/stores/browser.test.ts](../src/stores/browser.test.ts)、[src/lib/browser/](../src/lib/browser/) 跟使用 `tauri-mock` 的測試不會因為簽名變更而 break — 實際上 eslint 改動不會影響 runtime，但跑一遍最穩妥）
3. `PLAYWRIGHT_HEADLESS=1 pnpm e2e --reporter=line` → 驗證 e2e/tauri-mock.ts 改動後（17/183 disable pair 被刪）mock 仍正常運作。重點是 `error-audit.spec.ts` 要保持綠燈（recent commits 特別投入讓它無 warning / error，見 CLAUDE.md）。
4. 視覺確認 `git diff` 沒影響到任何實際邏輯，只動了 import、disable 註解、eslint 設定。

---

## 待修改檔案清單

- [eslint.config.mjs](../eslint.config.mjs)（手動，Step 1）
- [src/app/core/main/editor/markdown/md-editor-wrapper.tsx](../src/app/core/main/editor/markdown/md-editor-wrapper.tsx)（手動，Step 3）
- 以下由 `pnpm lint --fix` 自動處理（Step 2），核准執行時用 `git diff` 確認：
  - [e2e/tauri-mock.ts](../e2e/tauri-mock.ts)
  - [src/app/core/main/editor/markdown/ai-completion.tsx](../src/app/core/main/editor/markdown/ai-completion.tsx)
  - [src/app/core/main/editor/markdown/markdown-input-rules.ts](../src/app/core/main/editor/markdown/markdown-input-rules.ts)
  - [src/app/core/main/editor/markdown/tiptap-editor.tsx](../src/app/core/main/editor/markdown/tiptap-editor.tsx)
  - [src/app/core/main/mark/mark-list.tsx](../src/app/core/main/mark/mark-list.tsx)
  - [src/app/core/main/mark/tag-manage.tsx](../src/app/core/main/mark/tag-manage.tsx)
  - [src/components/title-bar-toolbars/sync-toggle.tsx](../src/components/title-bar-toolbars/sync-toggle.tsx)
  - [src/lib/sync/sync-push-queue.ts](../src/lib/sync/sync-push-queue.ts)
