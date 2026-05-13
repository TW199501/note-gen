import type { Page } from '@playwright/test'

/**
 * Inject a minimal Tauri runtime shim into the page BEFORE any app code runs.
 * Playwright runs against the standalone Next.js dev server which has no real
 * Tauri runtime; without this stub, every `invoke()` call throws
 * "Cannot read properties of undefined (reading 'transformCallback')" and the
 * app hits its error boundary on first render.
 *
 * This is NOT a faithful runtime — it just lets the page boot so we can
 * exercise React UI (tab strip render, nav buttons, find bar) and snapshot it.
 * Anything that depends on actual file/SQL/webview behavior will still no-op
 * or return the canned answers below.
 */
export async function installTauriMock(page: Page) {
  await page.addInitScript(() => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any

    // Track invoke calls so tests can inspect what was called.
    w.__mockInvokeCalls = [] as Array<{ cmd: string; args: unknown }>

    function transformCallback(callback: ((arg: unknown) => unknown) | undefined, _once: boolean) {
      const id = Math.floor(Math.random() * 1_000_000_000)
      ;(w as any)[`_${id}`] = callback
      return id
    }

    // Canned return values per command. Keep this minimal — extend as tests demand.
    const cannedResponses: Record<string, (args: any) => any> = {
      browser_tabs_list: () => ({ tabs: [], active_tab_id: null }),
      browser_tabs_new: () => 'mock-tab-id-' + Math.random().toString(36).slice(2, 8),
      browser_tabs_switch: () => undefined,
      browser_tabs_close: () => undefined,
      browser_tabs_update_meta: () => undefined,
      browser_show: () => undefined,
      browser_hide: () => undefined,
      browser_resize: () => undefined,
      browser_extract_text: () => undefined,
      browser_capture: () => '/tmp/screenshot.png',
      browser_set_zoom: (args: any) => args?.level ?? 1.0,
      browser_find_start: () => undefined,
      browser_find_next: () => undefined,
      browser_find_prev: () => undefined,
      browser_find_close: () => undefined,
      browser_toggle_devtools: () => false,
      browser_clear_data: () => undefined,
      browser_open_devtools: () => undefined,
      browser_inject_context_menu: () => undefined,
      browser_navigate: () => undefined,
      browser_go_back: () => undefined,
      browser_go_forward: () => undefined,
      browser_reload: () => undefined,
      browser_create: () => undefined,
      browser_get_url: () => 'https://example.com',
      browser_get_title: () => 'Example',
      browser_get_selected_text: () => '',
      // SQL plugin commands map to no-ops returning sensible defaults.
      plugin: () => undefined,
    }

    function invoke(cmd: string, args?: unknown) {
      ;(w.__mockInvokeCalls as any[]).push({ cmd, args })
      const handler = cannedResponses[cmd]
      try {
        const value = handler ? handler(args) : undefined
        return Promise.resolve(value)
      } catch (e) {
        return Promise.reject(e)
      }
    }

    w.__TAURI_INTERNALS__ = {
      transformCallback,
      invoke,
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      runtime: 'web-mock',
      convertFileSrc: (filePath: string) => filePath,
      ipc: (_message: unknown) => {},
    }
    w.__TAURI_PLUGIN_INTERNALS__ = {
      transformCallback,
      invoke,
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })
}
