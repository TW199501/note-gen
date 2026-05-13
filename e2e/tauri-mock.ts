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
      browser_tabs_list: () => ({
        // Pre-seed two tabs so the TabStrip renders. Real flow seeds the
        // first tab after browser_create succeeds; in a mocked env the
        // create path no-ops so we have to fake the list here.
        tabs: [
          { id: 'mock-tab-1', url: 'https://example.com', title: 'Example', favicon: '' },
          { id: 'mock-tab-2', url: 'https://github.com', title: 'GitHub', favicon: '' },
        ],
        active_tab_id: 'mock-tab-1',
      }),
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

    // Default returns for whole plugin namespaces so getCurrentWindow().X(),
    // SQL queries, Store.load(), Path APIs all resolve to something harmless
    // instead of throwing. Specific commands above take precedence.
    function defaultForNamespace(cmd: string) {
      // plugin:window|is_maximized → false, plugin:window|listen → registers a no-op
      if (cmd.startsWith('plugin:window|')) {
        if (cmd.endsWith('|listen') || cmd.endsWith('|once')) return 1
        if (cmd.includes('is_')) return false
        if (cmd.includes('inner_size') || cmd.includes('outer_size')) return { width: 1360, height: 800 }
        if (cmd.includes('inner_position') || cmd.includes('outer_position')) return { x: 0, y: 0 }
        if (cmd.includes('scale_factor')) return 1
        return undefined
      }
      if (cmd.startsWith('plugin:event|')) return 1
      if (cmd.startsWith('plugin:webview|')) return undefined
      if (cmd.startsWith('plugin:sql|')) {
        if (cmd.endsWith('|load')) return 'sqlite:mock.db'
        if (cmd.endsWith('|select')) return []
        if (cmd.endsWith('|execute')) return [0, 0] // rowsAffected, lastInsertId
        return undefined
      }
      if (cmd.startsWith('plugin:store|')) {
        // plugin-store's Store.get destructures: const [value, exists] = await invoke(...)
        // So returning the wrong shape breaks every store consumer.
        if (cmd.endsWith('|get')) return [null, false]
        if (cmd.endsWith('|has')) return false
        if (cmd.endsWith('|keys')) return []
        if (cmd.endsWith('|entries')) return []
        if (cmd.endsWith('|values')) return []
        if (cmd.endsWith('|length')) return 0
        if (cmd.endsWith('|load') || cmd.endsWith('|get_store')) return 1 // resource id
        return undefined
      }
      if (cmd.startsWith('plugin:path|')) return '/tmp/mock-path'
      if (cmd.startsWith('plugin:fs|')) {
        if (cmd.endsWith('|exists')) return false
        if (cmd.endsWith('|read_dir')) return []
        return undefined
      }
      if (cmd.startsWith('plugin:shell|') || cmd.startsWith('plugin:opener|')) return undefined
      if (cmd.startsWith('plugin:app|')) {
        if (cmd.endsWith('|version')) return '1.0.8'
        if (cmd.endsWith('|name')) return 'NoteGen'
        if (cmd.endsWith('|tauri_version')) return '2.6.2'
        if (cmd.endsWith('|identifier')) return 'com.codexu.NoteGen'
        return undefined
      }
      if (cmd.startsWith('plugin:http|')) {
        // status must be in [200, 599] or Response throws. Body needs to be
        // valid JSON to satisfy callers that always .json() the response.
        // (cmd is plugin:http|fetch / fetch_send / fetch_read_body.)
        if (cmd.endsWith('|fetch_read_body')) {
          // Returns Uint8Array of body bytes.
          return new TextEncoder().encode('{}')
        }
        return { status: 200, statusText: 'OK', headers: {}, url: '', body: '{}' }
      }
      if (cmd.startsWith('plugin:os|')) {
        if (cmd.endsWith('|platform')) return 'macos'
        if (cmd.endsWith('|version')) return '14.0'
        if (cmd.endsWith('|family')) return 'unix'
        if (cmd.endsWith('|os_type')) return 'Darwin'
        if (cmd.endsWith('|arch')) return 'aarch64'
        if (cmd.endsWith('|locale')) return 'en-US'
        if (cmd.endsWith('|hostname')) return 'mock-host'
        if (cmd.endsWith('|eol')) return '\n'
        return undefined
      }
      return undefined
    }

    function invoke(cmd: string, args?: unknown) {
      ;(w.__mockInvokeCalls as any[]).push({ cmd, args })
      const handler = cannedResponses[cmd]
      try {
        const value = handler ? handler(args) : defaultForNamespace(cmd)
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

    // plugin-os reads these as sync globals (not via invoke).
    w.__TAURI_OS_PLUGIN_INTERNALS__ = {
      platform: 'macos',
      version: '14.0',
      family: 'unix',
      type: 'Darwin',
      arch: 'aarch64',
      locale: 'en-US',
      hostname: 'mock-host',
      eol: '\n',
    }
    w.__TAURI_PLUGIN_INTERNALS__ = {
      transformCallback,
      invoke,
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  })
}
