# noVNC Browser Responsiveness (relaunch-on-resize) — Plan

> Execute inline. Steps are checkboxes.

**Goal:** Kill the black letterbox by making the remote desktop track the panel size — recreate the profile at the new size when the container changes meaningfully.

**Root cause (verified):** The CloakBrowser-Manager API (`GET /openapi.json`) exposes NO resize endpoint — desktop size is fixed at `POST /api/profiles` creation time. So `resizeSession` (client-side ExtendedDesktopSize) is not honoured → a fixed-size desktop + `scaleViewport` letterboxes → `bg-black` shows. The old native-WebView was responsive via `ResizeObserver → browser_resize` (cheap reposition); noVNC's only equivalent is recreate-at-new-size (reloads the page — acceptable since the panel is near-fixed width).

**File:** `src/app/core/main/browser/browser-host.tsx` (only).

## Task 1: Recreate the profile on significant resize

- [ ] **Step 1:** Replace the module-level `launchPromise` singleton + permanent `launched` guard with a size-aware cache: keep `{ dims, promise }`; reuse the promise when the new dims are within tolerance, otherwise stop the old profile and launch a new one at the new dims.
- [ ] **Step 2:** Drive it from a debounced (300ms) ResizeObserver + initial measure; on each settle, measure the panel and call the size-aware ensure; update React state with the (possibly new) profileId so `BrowserVnc` reconnects to the resized desktop.
- [ ] **Step 3:** Tolerance = ignore changes < 8px on both axes (avoids thrash on sub-pixel reflow).

## Task 2: Verify (Playwright, integration-level)

- [ ] Temp probe `e2e/_resize-probe.spec.ts`: mock `browser_sidecar_*`, enter browser mode, record `browser_profile_launch` calls, resize the viewport, wait, assert `browser_profile_launch` fired AGAIN with the new width/height. (Canvas isn't real in dev, but this proves the relaunch-on-resize wiring.)
- [ ] `pnpm exec tsc --noEmit && pnpm lint && grep -c $'\r'` (LF) on the changed file. Delete the probe after.

**Honest limit:** the actual black-gone / pixel-fit can only be confirmed by the user in the real Tauri+Docker app (no canvas in dev).
