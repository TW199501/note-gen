use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager,
    webview::WebviewBuilder,
    LogicalPosition, LogicalSize, Emitter,
};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PendingNav {
    Back,
    Forward,
    Navigate,
    Reload,
}

impl PendingNav {
    fn as_event_kind(self) -> &'static str {
        match self {
            PendingNav::Back => "back",
            PendingNav::Forward => "forward",
            PendingNav::Navigate => "navigate",
            PendingNav::Reload => "reload",
        }
    }
}

// R1 (multi-tab): tab metadata stored in BrowserState so the frontend can
// query/restore tabs after reload. The actual WebView is shared by all tabs
// in this MVP — switching tabs just navigates the single webview. A future
// commit will spin up one WebView per tab and wire active_tab_id into the
// webview_label resolution.
#[derive(Clone, Debug, Serialize)]
pub struct Tab {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon: String,
}

pub struct BrowserState {
    webview_label: Mutex<Option<String>>,
    context_menu_labels: Mutex<Option<HashMap<String, String>>>,
    // Latest user-initiated nav action awaiting the next page-load Finished event.
    // Cleared on each Finished. Absent → in-page link click → treat as "navigate".
    pending_nav: Mutex<Option<PendingNav>>,
    // R1: tab list and the currently-focused tab id. tabs is ordered (left→right).
    tabs: Mutex<Vec<Tab>>,
    active_tab_id: Mutex<Option<String>>,
    // R1 phase 2: tab_id → webview label. First tab gets BROWSER_LABEL (backward
    // compat); subsequent tabs get "browser-tab-{uuid}". Tracked separately from
    // Tab so the metadata sent to frontend stays clean.
    tab_labels: Mutex<HashMap<String, String>>,
    // R1 phase 2: last visible position of the browser panel container.
    // Used to position newly-spawned tab webviews and to move switched-in
    // tabs back to view. Updated by browser_create and browser_resize.
    last_position: Mutex<Option<(f64, f64, f64, f64)>>, // (x, y, w, h)
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            webview_label: Mutex::new(None),
            context_menu_labels: Mutex::new(None),
            pending_nav: Mutex::new(None),
            tabs: Mutex::new(Vec::new()),
            active_tab_id: Mutex::new(None),
            tab_labels: Mutex::new(HashMap::new()),
            last_position: Mutex::new(None),
        }
    }
}

// Off-screen coordinates used to hide non-active tab webviews. Tauri's
// hide()/show() were unreliable across platforms (existing trick in
// browser_hide); positioning offscreen is the proven workaround.
const OFFSCREEN_X: f64 = -10000.0;
const OFFSCREEN_Y: f64 = -10000.0;

// Resolve the webview label of the currently-active tab. Falls back to the
// legacy BROWSER_LABEL if no tab is registered yet (browser_create's first
// call uses this path before the first tab is seeded).
fn active_webview_label(state: &tauri::State<'_, BrowserState>) -> String {
    let active_id = state.active_tab_id.lock().ok().and_then(|g| g.clone());
    if let Some(id) = active_id {
        if let Ok(labels) = state.tab_labels.lock() {
            if let Some(label) = labels.get(&id) {
                return label.clone();
            }
        }
    }
    BROWSER_LABEL.to_string()
}

#[derive(Serialize, Clone)]
pub struct TabsChangedPayload {
    pub tabs: Vec<Tab>,
    pub active_tab_id: Option<String>,
}


#[derive(Serialize, Clone)]
struct UrlPayload {
    url: String,
}

#[derive(Serialize, Clone)]
struct LoadingPayload {
    loading: bool,
}

#[derive(Serialize, Clone)]
struct ContentExtractedPayload {
    text: String,
    title: String,
    url: String,
}

#[derive(Serialize, Clone)]
struct TitleChangedPayload {
    title: String,
}

#[derive(Serialize, Clone)]
struct FaviconChangedPayload {
    favicon: String,
}

#[derive(Serialize, Clone)]
struct ContextActionPayload {
    action: String,
    text: String,
    url: String,
    title: String,
}

#[derive(Serialize, Clone)]
struct SelectedTextPayload {
    text: String,
}

#[derive(Serialize, Clone)]
struct NavEventPayload {
    kind: &'static str,
}

// R2: download events
#[derive(Serialize, Clone)]
struct DownloadStartedPayload {
    url: String,
    filename: String,
    destination: String,
}

#[derive(Serialize, Clone)]
struct DownloadFinishedPayload {
    url: String,
    path: Option<String>,
    success: bool,
}

#[derive(Serialize, Clone)]
struct DevtoolsStatePayload {
    open: bool,
}

#[derive(Serialize, Clone)]
struct ZoomChangedPayload {
    level: f64,
}

#[derive(Serialize, Clone)]
struct FindStatePayload {
    count: usize,
    index: i64,
}

#[derive(Serialize, Clone)]
struct FindRequestedPayload {
    initial_query: String,
}

const BROWSER_LABEL: &str = "browser-webview";

fn build_context_menu_js(labels: &HashMap<String, String>) -> String {
    let back_label = labels.get("back").map(|s| s.as_str()).unwrap_or("Back");
    let forward_label = labels.get("forward").map(|s| s.as_str()).unwrap_or("Forward");
    let reload_label = labels.get("reload").map(|s| s.as_str()).unwrap_or("Reload");
    let copy_label = labels.get("copy").map(|s| s.as_str()).unwrap_or("Copy");
    let paste_label = labels.get("paste").map(|s| s.as_str()).unwrap_or("Paste");
    let select_all_label = labels.get("selectAll").map(|s| s.as_str()).unwrap_or("Select All");
    let quote_label = labels.get("quote").map(|s| s.as_str()).unwrap_or("Quote to Chat");
    let translate_label = labels.get("translate").map(|s| s.as_str()).unwrap_or("Translate Selection");
    let screenshot_label = labels.get("screenshot").map(|s| s.as_str()).unwrap_or("Screenshot to AI");
    let bookmark_label = labels.get("bookmark").map(|s| s.as_str()).unwrap_or("Add to Bookmarks");
    let print_label = labels.get("print").map(|s| s.as_str()).unwrap_or("Print");
    let devtools_label = labels.get("devTools").map(|s| s.as_str()).unwrap_or("Developer Tools");
    format!(r#"(function(){{
        if(window.__noteGenContextMenu) return;
        window.__noteGenContextMenu=true;
        var style=document.createElement('style');
        style.textContent='#notegen-ctx-menu{{position:fixed;z-index:999999;background:var(--bg,#fff);border:1px solid var(--bd,#e0e0e0);border-radius:6px;padding:4px 0;box-shadow:0 2px 10px rgba(0,0,0,.18);font-family:system-ui,-apple-system,sans-serif;font-size:13px;min-width:200px;color:var(--fg,#222)}}#notegen-ctx-menu>div{{padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:8px}}#notegen-ctx-menu>div:hover{{background:var(--hv,#f0f0f0)}}#notegen-ctx-menu>.ctx-sep{{height:1px;background:var(--bd,#e0e0e0);margin:4px 8px;padding:0;cursor:default}}#notegen-ctx-menu>.ctx-sep:hover{{background:var(--bd,#e0e0e0)}}@media(prefers-color-scheme:dark){{#notegen-ctx-menu{{--bg:#2a2a2a;--bd:#444;--fg:#eee;--hv:#3a3a3a}}}}';
        document.head.appendChild(style);
        document.addEventListener('contextmenu',function(e){{
            e.preventDefault();
            var sel=window.getSelection().toString();
            var old=document.getElementById('notegen-ctx-menu');
            if(old)old.remove();
            var m=document.createElement('div');
            m.id='notegen-ctx-menu';
            function addItem(label,fn){{
                var d=document.createElement('div');
                d.textContent=label;
                d.onclick=function(){{fn();m.remove();}};
                m.appendChild(d);
            }}
            function addAction(label,action){{
                addItem(label,function(){{
                    window.__TAURI_INTERNALS__.invoke('__browser_context_action',{{
                        action:action,text:sel,url:window.location.href,title:document.title
                    }});
                }});
            }}
            function addSep(){{
                var s=document.createElement('div');
                s.className='ctx-sep';
                m.appendChild(s);
            }}
            addItem('{back}',function(){{window.history.back();}});
            addItem('{forward}',function(){{window.history.forward();}});
            addItem('{reload}',function(){{window.location.reload();}});
            addSep();
            if(sel){{
                addItem('{copy}',function(){{document.execCommand('copy');}});
            }}
            addItem('{paste}',function(){{document.execCommand('paste');}});
            addItem('{select_all}',function(){{document.execCommand('selectAll');}});
            addSep();
            if(sel){{
                addAction('{quote}','quote');
                addAction('{translate}','translate');
            }}
            addAction('{screenshot}','screenshot');
            addAction('{bookmark}','bookmark');
            addSep();
            addItem('{print}',function(){{window.print();}});
            addItem('{devtools}',function(){{
                window.__TAURI_INTERNALS__.invoke('__browser_context_action',{{
                    action:'devtools',text:'',url:window.location.href,title:document.title
                }});
            }});
            var x=e.clientX,y=e.clientY;
            m.style.left=x+'px';m.style.top=y+'px';
            document.body.appendChild(m);
            setTimeout(function(){{
                var rect=m.getBoundingClientRect();
                if(rect.right>window.innerWidth)m.style.left=(window.innerWidth-rect.width-4)+'px';
                if(rect.bottom>window.innerHeight)m.style.top=(window.innerHeight-rect.height-4)+'px';
            }},0);
            document.addEventListener('click',function h(){{m.remove();document.removeEventListener('click',h);}},{{once:true}});
        }});
    }})();"#,
        back = back_label,
        forward = forward_label,
        reload = reload_label,
        copy = copy_label,
        paste = paste_label,
        select_all = select_all_label,
        quote = quote_label,
        translate = translate_label,
        screenshot = screenshot_label,
        bookmark = bookmark_label,
        print = print_label,
        devtools = devtools_label,
    )
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    url: Option<String>,
) -> Result<(), String> {
    // R1 phase 2: remember the container position for future tab spawns.
    if let Ok(mut pos) = state.last_position.lock() {
        *pos = Some((x, y, width, height));
    }

    let mut label = state.webview_label.lock().map_err(|e| e.to_string())?;

    // If already exists, just show it
    if label.is_some() {
        if let Some(wv) = app.get_webview(BROWSER_LABEL) {
            wv.show().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    let window = app.get_window("main").ok_or("Main window not found")?;

    let app_handle = app.clone();
    let initial_url = url.unwrap_or_else(|| "https://www.google.com".to_string());
    // R3 (file upload) finding — no code change needed:
    //   - macOS WKWebView, Windows WebView2, Linux WebKitGTK all support
    //     <input type="file"> natively. The native control opens the OS
    //     file picker (NSOpenPanel / IFileOpenDialog / GtkFileChooserDialog).
    //   - The browser-bridge.json capability restriction only narrows the
    //     Tauri JS API (no fs:/sql:/store:). It does NOT affect HTML form
    //     controls, which are part of the WebView itself.
    //   - Verified by inspecting Tauri 2.x WebviewBuilder API surface and
    //     confirmed against wry/tao runtime defaults.
    //   - Mobile (iOS/Android) needs platform plugins for accessor APIs but
    //     basic <input type="file"> still works via system Photo/Document
    //     picker. Tracked as P2 in docs/BROWSER_WEBVIEW_SPEC.md.
    let builder = WebviewBuilder::new(
        BROWSER_LABEL,
        tauri::WebviewUrl::External(initial_url.parse().map_err(|e| format!("Invalid URL '{}': {}", initial_url, e))?),
    )
    .auto_resize()
    // Force same-window navigation: rewrite target="_blank" anchors and override
    // window.open() so links that would spawn a new browser window stay inside
    // this single child webview (Tauri 2 multi-webview is still unstable).
    // Runs before page JS on every navigation.
    .initialization_script(r#"(function(){
        if (window.__notegenSameWindowPatched) return;
        window.__notegenSameWindowPatched = true;
        window.open = function(url) {
            try { if (url) window.location.href = String(url); } catch(e) {}
            return null;
        };
        function strip(a) {
            try {
                if (a.getAttribute && a.getAttribute('target') === '_blank') a.removeAttribute('target');
                if (a.getAttribute && a.getAttribute('rel')) a.removeAttribute('rel');
            } catch(e) {}
        }
        var run = function() {
            try {
                document.querySelectorAll('a[target="_blank"]').forEach(strip);
                if (document.body) {
                    var mo = new MutationObserver(function(muts){
                        muts.forEach(function(m){
                            m.addedNodes && m.addedNodes.forEach(function(n){
                                if (n && n.nodeType === 1) {
                                    if (n.tagName === 'A') strip(n);
                                    if (n.querySelectorAll) n.querySelectorAll('a[target="_blank"]').forEach(strip);
                                }
                            });
                        });
                    });
                    mo.observe(document.body, { childList: true, subtree: true });
                }
            } catch(e) {}
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', run);
        } else {
            run();
        }
    })();"#)
    // R4: find-in-page. Helper functions installed on window; host invokes them via
    // wv.eval. Highlights matches by wrapping text-node fragments in <mark class=
    // "ng-find-hit">. Close() restores DOM by replacing marks with their text content.
    // Skips script/style/our own marks via TreeWalker filter. Ctrl/Cmd+F is captured
    // inside the WebView (host can't see child WebView keydown), forwarded via
    // __browser_find_requested so host can show the find bar and steal focus.
    .initialization_script(r#"(function(){
        if (window.__noteGenFindPatched) return;
        window.__noteGenFindPatched = true;
        var STYLE_ID = 'ng-find-style';
        var ATTR = 'data-ng-find';
        var ACTIVE_ATTR = 'data-ng-find-active';
        function ensureStyle(){
            if (document.getElementById(STYLE_ID)) return;
            var s = document.createElement('style');
            s.id = STYLE_ID;
            s.textContent = 'mark['+ATTR+']{background:#ffeb3b;color:#000;padding:0;border-radius:2px}mark['+ATTR+']['+ACTIVE_ATTR+']{background:#ff9800;outline:2px solid #f57c00}';
            (document.head || document.documentElement).appendChild(s);
        }
        function closeFind(){
            var hits = document.querySelectorAll('mark['+ATTR+']');
            for (var i=0; i<hits.length; i++){
                var m = hits[i];
                var p = m.parentNode;
                if (!p) continue;
                while (m.firstChild) p.insertBefore(m.firstChild, m);
                p.removeChild(m);
                p.normalize();
            }
            window.__noteGenFindState = null;
        }
        function shouldSkipParent(el){
            if (!el || !el.tagName) return true;
            var tag = el.tagName.toUpperCase();
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEXTAREA') return true;
            if (el.hasAttribute && el.hasAttribute(ATTR)) return true;
            return false;
        }
        function collectTextNodes(){
            var out = [];
            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
                acceptNode: function(node){
                    if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                    if (shouldSkipParent(node.parentElement)) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
            });
            var n;
            while ((n = walker.nextNode())) out.push(n);
            return out;
        }
        function startFind(query, caseSensitive){
            closeFind();
            if (!query) {
                report(0, -1);
                return;
            }
            ensureStyle();
            var nodes = collectTextNodes();
            var hits = [];
            for (var i=0; i<nodes.length; i++){
                var node = nodes[i];
                var text = node.nodeValue;
                var hay = caseSensitive ? text : text.toLowerCase();
                var ndl = caseSensitive ? query : query.toLowerCase();
                var positions = [];
                var idx = 0;
                while (idx <= hay.length - ndl.length){
                    var found = hay.indexOf(ndl, idx);
                    if (found === -1) break;
                    positions.push(found);
                    idx = found + ndl.length;
                }
                if (positions.length === 0) continue;
                // Split text node and wrap matches
                var parent = node.parentNode;
                if (!parent) continue;
                var cursor = 0;
                var frag = document.createDocumentFragment();
                for (var p=0; p<positions.length; p++){
                    var pos = positions[p];
                    if (pos > cursor) frag.appendChild(document.createTextNode(text.substring(cursor, pos)));
                    var mark = document.createElement('mark');
                    mark.setAttribute(ATTR, '');
                    mark.textContent = text.substring(pos, pos + ndl.length);
                    frag.appendChild(mark);
                    hits.push(mark);
                    cursor = pos + ndl.length;
                }
                if (cursor < text.length) frag.appendChild(document.createTextNode(text.substring(cursor)));
                parent.replaceChild(frag, node);
            }
            window.__noteGenFindState = { hits: hits, index: hits.length ? 0 : -1, query: query, caseSensitive: !!caseSensitive };
            if (hits.length) activate(0);
            report(hits.length, hits.length ? 0 : -1);
        }
        function activate(idx){
            var st = window.__noteGenFindState;
            if (!st || !st.hits.length) return;
            for (var i=0; i<st.hits.length; i++) st.hits[i].removeAttribute(ACTIVE_ATTR);
            var n = ((idx % st.hits.length) + st.hits.length) % st.hits.length;
            st.index = n;
            var el = st.hits[n];
            el.setAttribute(ACTIVE_ATTR, '');
            try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); } catch(e) {}
        }
        function nextFind(){
            var st = window.__noteGenFindState;
            if (!st || !st.hits.length) return;
            activate(st.index + 1);
            report(st.hits.length, st.index);
        }
        function prevFind(){
            var st = window.__noteGenFindState;
            if (!st || !st.hits.length) return;
            activate(st.index - 1);
            report(st.hits.length, st.index);
        }
        function report(count, index){
            try { window.__TAURI_INTERNALS__.invoke('__browser_find_state', { count: count, index: index }); } catch(e) {}
        }
        window.__noteGenFind = { start: startFind, next: nextFind, prev: prevFind, close: closeFind };
        // Ctrl/Cmd+F: forward to host so it can show find bar and focus its input.
        window.addEventListener('keydown', function(e){
            if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')){
                e.preventDefault();
                var sel = '';
                try { sel = String(window.getSelection() || ''); } catch(err) {}
                try { window.__TAURI_INTERNALS__.invoke('__browser_find_requested', { initial_query: sel }); } catch(err) {}
            }
        }, true);
    })();"#)
    // R6: zoom keyboard shortcuts. Tauri child WebView keydown events do NOT bubble to
    // the host window, so the listener has to live inside the WebView itself. Each
    // navigation gets a fresh window, so addEventListener once per page is safe — the
    // idempotent guard prevents double-registering inside the same page via SPA hash
    // changes (not strictly needed since hash changes don't trigger init_script, but
    // cheap insurance).
    .initialization_script(r#"(function(){
        if (window.__noteGenZoomPatched) return;
        window.__noteGenZoomPatched = true;
        var ZMIN = 0.25, ZMAX = 5.0, ZSTEP = 0.1, ZDEF = 1.0;
        function r2(v){ return Math.round(v * 100) / 100; }
        function clamp(v){ return r2(Math.max(ZMIN, Math.min(ZMAX, v))); }
        function apply(level){
            var l = clamp(level);
            try { document.documentElement.style.zoom = String(l); } catch(e) {}
            window.__noteGenZoomLevel = l;
            try { window.__TAURI_INTERNALS__.invoke('__browser_zoom_changed', { level: l }); } catch(e) {}
            return l;
        }
        window.__noteGenZoomApply = apply;
        window.addEventListener('keydown', function(e){
            if (!(e.ctrlKey || e.metaKey)) return;
            var cur = window.__noteGenZoomLevel || ZDEF;
            if (e.key === '=' || e.key === '+') {
                e.preventDefault(); apply(cur + ZSTEP);
            } else if (e.key === '-') {
                e.preventDefault(); apply(cur - ZSTEP);
            } else if (e.key === '0') {
                e.preventDefault(); apply(ZDEF);
            }
        }, true);
    })();"#)
    // R2: download handling — Tauri's WebView fires a Requested event when a
    // page triggers a download (Content-Disposition: attachment, <a download>,
    // or unhandled MIME). We let the WebView's native download path proceed
    // and just emit events so the host UI can show progress.
    //
    // Note: Tauri's on_download API only fires start/end events with no
    // intermediate progress callback — that's a wry limitation. For showing
    // bytes-progress we'd need to proxy through reqwest ourselves, which is
    // tracked as Phase 2 follow-up.
    .on_download({
        let app_handle = app.clone();
        move |_webview, event| {
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    let filename = destination
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("download")
                        .to_string();
                    let _ = app_handle.emit("browser-download-started", DownloadStartedPayload {
                        url: url.to_string(),
                        filename,
                        destination: destination.to_string_lossy().to_string(),
                    });
                    // Return true to proceed with the download. WebView handles writing.
                    true
                }
                tauri::webview::DownloadEvent::Finished { url, path, success } => {
                    let _ = app_handle.emit("browser-download-finished", DownloadFinishedPayload {
                        url: url.to_string(),
                        path: path.map(|p| p.to_string_lossy().to_string()),
                        success,
                    });
                    true
                }
                _ => true,
            }
        }
    })
    .on_page_load(move |wv, payload| {
        match payload.event() {
            tauri::webview::PageLoadEvent::Started => {
                let _ = app_handle.emit("browser-loading", LoadingPayload { loading: true });
            }
            tauri::webview::PageLoadEvent::Finished => {
                let _ = app_handle.emit("browser-loading", LoadingPayload { loading: false });
                // Determine nav action: take pending flag if set, else treat as in-page link click.
                let kind = if let Some(browser_state) = app_handle.try_state::<BrowserState>() {
                    if let Ok(mut pending) = browser_state.pending_nav.lock() {
                        pending.take().map(|p| p.as_event_kind()).unwrap_or("navigate")
                    } else {
                        "navigate"
                    }
                } else {
                    "navigate"
                };
                let _ = app_handle.emit("browser-nav-event", NavEventPayload { kind });
                // Get URL and title after load
                if let Ok(url) = wv.url() {
                    let _ = app_handle.emit("browser-url-changed", UrlPayload { url: url.to_string() });
                }
                // Inject script to get title - uses Tauri's webview.eval() API for JS injection
                let _ = wv.eval(
                    "window.__TAURI_INTERNALS__.invoke('__browser_title_changed', { title: document.title })"
                );
                // Inject script to get favicon
                let _ = wv.eval(r#"(function(){
                    var links = document.querySelectorAll('link[rel*="icon"]');
                    var favicon = '';
                    if (links.length > 0) {
                        var best = links[0]; var bestSize = 0;
                        links.forEach(function(l){
                            var s = l.getAttribute('sizes');
                            var sz = s ? parseInt(s.split('x')[0]) : 16;
                            if(sz > bestSize){ bestSize = sz; best = l; }
                        });
                        favicon = best.href;
                    } else {
                        favicon = window.location.origin + '/favicon.ico';
                    }
                    window.__TAURI_INTERNALS__.invoke('__browser_favicon_changed', { favicon: favicon });
                })();"#);
                // Re-inject context menu if labels are stored
                if let Some(browser_state) = app_handle.try_state::<BrowserState>() {
                    if let Ok(labels_guard) = browser_state.context_menu_labels.lock() {
                        if let Some(labels) = labels_guard.as_ref() {
                            let js = build_context_menu_js(labels);
                            let _ = wv.eval(&js);
                        }
                    }
                }
            }
        }
    });

    window.add_child(
        builder,
        LogicalPosition::new(x, y),
        LogicalSize::new(width, height),
    ).map_err(|e| e.to_string())?;

    *label = Some(BROWSER_LABEL.to_string());

    // R1 phase 2: register this webview against the active tab in tab_labels
    // so active_webview_label resolves correctly. Frontend's browser_tabs_new
    // seeds an "initial" tab right after browser_create succeeds; bind that
    // tab id to BROWSER_LABEL here if we can see it.
    if let Ok(active) = state.active_tab_id.lock() {
        if let Some(id) = active.as_ref() {
            if let Ok(mut labels) = state.tab_labels.lock() {
                labels.entry(id.clone()).or_insert_with(|| BROWSER_LABEL.to_string());
            }
        }
    }

    Ok(())
}

fn set_pending_nav(state: &tauri::State<'_, BrowserState>, action: PendingNav) {
    if let Ok(mut pending) = state.pending_nav.lock() {
        *pending = Some(action);
    }
}

#[tauri::command]
pub async fn browser_navigate(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    url: String,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let parsed_url = url::Url::parse(&url).map_err(|e| e.to_string())?;
    set_pending_nav(&state, PendingNav::Navigate);
    webview.navigate(parsed_url).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_go_back(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    set_pending_nav(&state, PendingNav::Back);
    // Tauri's webview.eval() API injects JS into the webview context
    webview.eval("window.history.back()").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_go_forward(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    set_pending_nav(&state, PendingNav::Forward);
    webview.eval("window.history.forward()").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_reload(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    set_pending_nav(&state, PendingNav::Reload);
    webview.eval("window.location.reload()").map_err(|e| e.to_string())?; // existing code
    Ok(())
}

#[tauri::command]
pub async fn browser_toggle_devtools(app: AppHandle) -> Result<bool, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let is_open = webview.is_devtools_open();
    if is_open {
        webview.close_devtools();
    } else {
        webview.open_devtools();
    }
    let new_state = !is_open;
    let _ = app.emit("browser-devtools-state", DevtoolsStatePayload { open: new_state });
    Ok(new_state)
}

#[tauri::command]
pub async fn browser_show(app: AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        webview.show().map_err(|e| e.to_string())?;
        // Position will be restored by frontend syncSize() call
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    // hide() + move offscreen for reliability — some platforms don't fully hide child webviews
    webview.hide().map_err(|e| e.to_string())?;
    webview.set_position(LogicalPosition::new(-10000.0, -10000.0)).map_err(|e| e.to_string())?;
    webview.set_size(LogicalSize::new(0.0, 0.0)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_resize(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    // R1 phase 2: record + apply to active tab's webview.
    if let Ok(mut pos) = state.last_position.lock() {
        *pos = Some((x, y, width, height));
    }
    let label = active_webview_label(&state);
    let webview = app.get_webview(&label).ok_or("Browser not created")?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- Private bridge commands ---------------------------------------------------
// 注入到 child webview 的 JS 透過 `window.__TAURI_INTERNALS__.invoke('__browser_*', ...)`
// 把資料送回 host。這些 command 只是橋接 — 收到 JS 端 payload 後 emit 對應的
// `browser-*` Tauri event 給 frontend 監聽。沒有這些 bridge，前端的所有 listen 都不會 fire。
#[tauri::command]
pub fn __browser_content_extracted(app: AppHandle, text: String, title: String, url: String) {
    let _ = app.emit("browser-content-extracted", ContentExtractedPayload { text, title, url });
}

#[tauri::command]
pub fn __browser_title_changed(app: AppHandle, title: String) {
    let _ = app.emit("browser-title-changed", TitleChangedPayload { title });
}

#[tauri::command]
pub fn __browser_favicon_changed(app: AppHandle, favicon: String) {
    let _ = app.emit("browser-favicon-changed", FaviconChangedPayload { favicon });
}

#[tauri::command]
pub fn __browser_context_action(app: AppHandle, action: String, text: String, url: String, title: String) {
    let _ = app.emit("browser-context-action", ContextActionPayload { action, text, url, title });
}

#[tauri::command]
pub fn __browser_title_result(app: AppHandle, title: String) {
    let _ = app.emit("browser-title-changed", TitleChangedPayload { title });
}

#[tauri::command]
pub fn __browser_selected_text(app: AppHandle, text: String) {
    let _ = app.emit("browser-selected-text", SelectedTextPayload { text });
}

#[tauri::command]
pub fn __browser_zoom_changed(app: AppHandle, level: f64) {
    let _ = app.emit("browser-zoom-changed", ZoomChangedPayload { level });
}

#[tauri::command]
pub fn __browser_find_state(app: AppHandle, count: usize, index: i64) {
    let _ = app.emit("browser-find-state", FindStatePayload { count, index });
}

#[tauri::command]
pub fn __browser_find_requested(app: AppHandle, initial_query: String) {
    let _ = app.emit("browser-find-requested", FindRequestedPayload { initial_query });
}
// ---- End private bridge commands -----------------------------------------------

fn escape_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

#[tauri::command]
pub async fn browser_find_start(
    app: AppHandle,
    query: String,
    case_sensitive: bool,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let js = format!(
        "(function(){{ if(window.__noteGenFind) window.__noteGenFind.start('{}', {}); }})();",
        escape_js_string(&query),
        case_sensitive
    );
    webview.eval(&js).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_find_next(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    webview
        .eval("(function(){ if(window.__noteGenFind) window.__noteGenFind.next(); })();")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_find_prev(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    webview
        .eval("(function(){ if(window.__noteGenFind) window.__noteGenFind.prev(); })();")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_find_close(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    webview
        .eval("(function(){ if(window.__noteGenFind) window.__noteGenFind.close(); })();")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, level: f64) -> Result<f64, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    // Defense in depth: clamp on Rust side even though frontend already clamps.
    let clamped = level.max(0.25).min(5.0);
    let js = format!(
        "(function(){{ if(typeof window.__noteGenZoomApply==='function') window.__noteGenZoomApply({0}); else {{ try{{document.documentElement.style.zoom=String({0});}}catch(e){{}} window.__noteGenZoomLevel={0}; try{{window.__TAURI_INTERNALS__.invoke('__browser_zoom_changed',{{level:{0}}});}}catch(e){{}} }} }})();",
        clamped
    );
    webview.eval(&js).map_err(|e| e.to_string())?;
    Ok(clamped)
}

#[tauri::command]
pub async fn browser_extract_text(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let url = webview.url().map_err(|e| e.to_string())?.to_string();

    // Inject script to extract page text and emit result via Tauri event
    let emit_url = url.replace('\\', "\\\\").replace('\'', "\\'");
    let js_code = format!(r#"(function(){{
        var text = document.body.innerText || '';
        var title = document.title || '';
        window.__TAURI_INTERNALS__.invoke('__browser_content_extracted', {{
            text: text.substring(0, 8000),
            title: title,
            url: '{}'
        }});
    }})();"#, emit_url);
    webview.eval(&js_code).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_get_url(app: AppHandle) -> Result<String, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let url = webview.url().map_err(|e| e.to_string())?;
    Ok(url.to_string())
}

#[tauri::command]
pub async fn browser_get_title(app: AppHandle) -> Result<String, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    // Inject JS via Tauri webview.eval() to retrieve document title
    webview.eval("window.__TAURI_INTERNALS__.invoke('__browser_title_result', { title: document.title })")
        .map_err(|e| e.to_string())?;
    Ok(String::new()) // Title comes via event
}

#[tauri::command]
pub async fn browser_get_selected_text(app: AppHandle) -> Result<String, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    // Inject JS via Tauri webview.eval() to get the current text selection
    let js_code = r#"
        (function() {
            var sel = window.getSelection();
            var text = sel ? sel.toString() : '';
            window.__TAURI_INTERNALS__.invoke('__browser_selected_text', { text: text });
        })();
    "#;
    webview.eval(js_code).map_err(|e| e.to_string())?;
    Ok(String::new())
}

#[allow(dead_code)]
#[tauri::command]
pub async fn browser_inject_context_menu(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    labels: HashMap<String, String>,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    let js = build_context_menu_js(&labels);
    webview.eval(&js).map_err(|e| e.to_string())?;
    // Store labels for re-injection on page load
    let mut stored = state.context_menu_labels.lock().map_err(|e| e.to_string())?;
    *stored = Some(labels);
    Ok(())
}

#[tauri::command]
pub async fn browser_clear_data(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(BROWSER_LABEL) {
        // Inject JS to clear client-side storage before closing
        let js_clear = r#"(function(){
            try { localStorage.clear(); } catch(e) {}
            try { sessionStorage.clear(); } catch(e) {}
            try {
                document.cookie.split(';').forEach(function(c) {
                    document.cookie = c.trim().split('=')[0] +
                        '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
                });
            } catch(e) {}
            try {
                if (window.caches) {
                    caches.keys().then(function(names) {
                        names.forEach(function(name) { caches.delete(name); });
                    });
                }
            } catch(e) {}
            try {
                if (window.indexedDB.databases) {
                    window.indexedDB.databases().then(function(dbs) {
                        dbs.forEach(function(db) { window.indexedDB.deleteDatabase(db.name); });
                    });
                }
            } catch(e) {}
        })();"#;
        let _ = webview.eval(js_clear);

        // Wait for JS to execute
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;

        // Close the webview
        webview.close().map_err(|e| e.to_string())?;
    }

    // Reset state so WebView can be recreated
    let mut label = state.webview_label.lock().map_err(|e| e.to_string())?;
    *label = None;
    if let Ok(mut pending) = state.pending_nav.lock() {
        *pending = None;
    }

    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
pub async fn browser_capture(app: AppHandle) -> Result<String, String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;

    let position = webview.position().map_err(|e| e.to_string())?;
    let size = webview.size().map_err(|e| e.to_string())?;

    // Use xcap to capture the screen region
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let screenshot_path = app_data.join("browser-screenshot.png");

    // Capture using xcap (already a project dependency)
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    if let Some(monitor) = monitors.first() {
        let image = monitor.capture_image().map_err(|e| e.to_string())?;

        // Crop to webview area
        let x = position.x as u32;
        let y = position.y as u32;
        let w = size.width.min(image.width().saturating_sub(x));
        let h = size.height.min(image.height().saturating_sub(y));

        let cropped = image::imageops::crop_imm(&image, x, y, w, h).to_image();
        cropped.save(&screenshot_path).map_err(|e| e.to_string())?;

        Ok(screenshot_path.to_string_lossy().to_string())
    } else {
        Err("No monitor found".to_string())
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
pub async fn browser_capture(_app: AppHandle) -> Result<String, String> {
    Err("Screenshot capture is not supported on mobile".to_string())
}

// ─────────────────────────────────────────────────────────────────────────────
// R1 (multi-tab): tab management commands
//
// MVP scope: tabs are metadata records (id/url/title/favicon) tracked in
// BrowserState. There is still a single underlying WebView; switching tabs
// navigates that WebView to the target tab's URL. A future commit will spin
// up per-tab WebView instances so back/forward and scroll position survive
// switching.
//
// All commands emit `browser-tabs-changed` after a mutation so the frontend
// store stays in sync without polling.

fn snapshot_tabs(state: &tauri::State<'_, BrowserState>) -> Result<TabsChangedPayload, String> {
    let tabs = state.tabs.lock().map_err(|e| e.to_string())?.clone();
    let active_tab_id = state.active_tab_id.lock().map_err(|e| e.to_string())?.clone();
    Ok(TabsChangedPayload { tabs, active_tab_id })
}

fn emit_tabs_changed(app: &AppHandle, state: &tauri::State<'_, BrowserState>) -> Result<(), String> {
    let payload = snapshot_tabs(state)?;
    let _ = app.emit("browser-tabs-changed", payload);
    Ok(())
}

#[tauri::command]
pub async fn browser_tabs_list(
    state: tauri::State<'_, BrowserState>,
) -> Result<TabsChangedPayload, String> {
    snapshot_tabs(&state)
}

// R1 phase 2: spawn a new tab's WebView and move all previously-active tabs
// off-screen. The first tab keeps BROWSER_LABEL (so legacy code paths using
// `app.get_webview(BROWSER_LABEL)` keep finding the active tab during the
// transition); subsequent tabs get unique labels.
//
// MVP limitation: new tabs do not yet inherit the same initialization_scripts
// (find-in-page, zoom override, same-window patch) and on_page_load handlers
// as the first tab. Phase 2b will extract `browser_create`'s ~300-line builder
// config into a reusable factory so every tab gets full feature parity.
#[tauri::command]
pub async fn browser_tabs_new(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    url: Option<String>,
) -> Result<String, String> {
    let url_str = url.unwrap_or_else(|| "https://www.google.com".to_string());
    let id = uuid::Uuid::new_v4().to_string();
    let tab = Tab {
        id: id.clone(),
        url: url_str.clone(),
        title: String::new(),
        favicon: String::new(),
    };

    // Decide label scheme: first tab reuses BROWSER_LABEL for backward compat,
    // additional tabs get fresh labels.
    let is_first = state.tabs.lock().map(|t| t.is_empty()).unwrap_or(true);
    let webview_label = if is_first {
        BROWSER_LABEL.to_string()
    } else {
        format!("browser-tab-{}", id)
    };

    // Record metadata BEFORE spawning so active_webview_label can resolve.
    let previous_active = {
        let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        tabs.push(tab);
        let mut labels = state.tab_labels.lock().map_err(|e| e.to_string())?;
        labels.insert(id.clone(), webview_label.clone());
        let mut active = state.active_tab_id.lock().map_err(|e| e.to_string())?;
        let prev = active.clone();
        *active = Some(id.clone());
        prev
    };

    // For the first tab we let frontend's BrowserWebView.init() call
    // browser_create which actually spawns. For subsequent tabs we spawn
    // directly here with a minimal builder.
    if !is_first {
        let position = state
            .last_position
            .lock()
            .ok()
            .and_then(|p| *p)
            .unwrap_or((0.0, 0.0, 800.0, 600.0));

        let parsed_url = url::Url::parse(&url_str).map_err(|e| e.to_string())?;
        let window = app.get_window("main").ok_or("Main window not found")?;
        let builder = WebviewBuilder::new(&webview_label, tauri::WebviewUrl::External(parsed_url))
            .auto_resize();
        window
            .add_child(
                builder,
                LogicalPosition::new(position.0, position.1),
                LogicalSize::new(position.2, position.3),
            )
            .map_err(|e| e.to_string())?;

        // Move the previously-active tab off-screen so the new one is visible.
        if let Some(prev_id) = previous_active {
            if let Some(prev_label) = state
                .tab_labels
                .lock()
                .ok()
                .and_then(|m| m.get(&prev_id).cloned())
            {
                if let Some(prev_wv) = app.get_webview(&prev_label) {
                    let _ = prev_wv.set_position(LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y));
                    let _ = prev_wv.set_size(LogicalSize::new(0.0, 0.0));
                }
            }
        }
    }

    emit_tabs_changed(&app, &state)?;
    Ok(id)
}

#[tauri::command]
pub async fn browser_tabs_switch(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    // Find target tab + previous active.
    let (target_url, target_label, previous_active_id) = {
        let tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        let tab = tabs.iter().find(|t| t.id == tab_id).ok_or("Tab not found")?;
        let labels = state.tab_labels.lock().map_err(|e| e.to_string())?;
        let label = labels
            .get(&tab_id)
            .cloned()
            .unwrap_or_else(|| BROWSER_LABEL.to_string());
        let active = state.active_tab_id.lock().map_err(|e| e.to_string())?;
        (tab.url.clone(), label, active.clone())
    };

    // No-op if already active.
    if previous_active_id.as_deref() == Some(tab_id.as_str()) {
        return Ok(());
    }

    // Update active pointer.
    {
        let mut active = state.active_tab_id.lock().map_err(|e| e.to_string())?;
        *active = Some(tab_id.clone());
    }

    // Move previous off-screen.
    if let Some(prev_id) = previous_active_id {
        if let Some(prev_label) = state
            .tab_labels
            .lock()
            .ok()
            .and_then(|m| m.get(&prev_id).cloned())
        {
            if let Some(prev_wv) = app.get_webview(&prev_label) {
                let _ = prev_wv.set_position(LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y));
                let _ = prev_wv.set_size(LogicalSize::new(0.0, 0.0));
            }
        }
    }

    // Bring target into view at the last known container position.
    let position = state
        .last_position
        .lock()
        .ok()
        .and_then(|p| *p)
        .unwrap_or((0.0, 0.0, 800.0, 600.0));

    if let Some(target_wv) = app.get_webview(&target_label) {
        // Existing webview — just reposition. URL state already preserved.
        let _ = target_wv.set_position(LogicalPosition::new(position.0, position.1));
        let _ = target_wv.set_size(LogicalSize::new(position.2, position.3));
    } else {
        // Webview not yet created (e.g. lazy-mount race). Fall back to
        // navigating BROWSER_LABEL for graceful degradation.
        if let Some(wv) = app.get_webview(BROWSER_LABEL) {
            if let Ok(parsed) = url::Url::parse(&target_url) {
                let _ = wv.navigate(parsed);
            }
        }
    }

    emit_tabs_changed(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub async fn browser_tabs_close(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
) -> Result<(), String> {
    // Close the webview for the tab being removed.
    let closed_label = state
        .tab_labels
        .lock()
        .ok()
        .and_then(|m| m.get(&tab_id).cloned());

    if let Some(label) = &closed_label {
        if label != BROWSER_LABEL {
            // Only close non-default webviews; BROWSER_LABEL is the durable
            // first tab and we rebuild via browser_create if needed.
            if let Some(wv) = app.get_webview(label) {
                let _ = wv.close();
            }
        } else {
            // For the default webview, move off-screen rather than close —
            // browser_create can't easily re-spawn at the same label after
            // close in some Tauri versions.
            if let Some(wv) = app.get_webview(label) {
                let _ = wv.set_position(LogicalPosition::new(OFFSCREEN_X, OFFSCREEN_Y));
                let _ = wv.set_size(LogicalSize::new(0.0, 0.0));
            }
        }
    }

    let next_active = {
        let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        let idx = tabs.iter().position(|t| t.id == tab_id).ok_or("Tab not found")?;
        tabs.remove(idx);

        let mut labels = state.tab_labels.lock().map_err(|e| e.to_string())?;
        labels.remove(&tab_id);

        let mut active = state.active_tab_id.lock().map_err(|e| e.to_string())?;
        if active.as_deref() == Some(tab_id.as_str()) {
            let new_active = tabs
                .get(idx)
                .or_else(|| tabs.get(idx.saturating_sub(1)))
                .or_else(|| tabs.first())
                .cloned();
            *active = new_active.as_ref().map(|t| t.id.clone());
            new_active.map(|t| (t.id.clone(), t.url.clone()))
        } else {
            None
        }
    };

    // If we closed the active one, bring the new active into view.
    if let Some((new_id, _new_url)) = next_active {
        let new_label = state
            .tab_labels
            .lock()
            .ok()
            .and_then(|m| m.get(&new_id).cloned())
            .unwrap_or_else(|| BROWSER_LABEL.to_string());

        let position = state
            .last_position
            .lock()
            .ok()
            .and_then(|p| *p)
            .unwrap_or((0.0, 0.0, 800.0, 600.0));

        if let Some(wv) = app.get_webview(&new_label) {
            let _ = wv.set_position(LogicalPosition::new(position.0, position.1));
            let _ = wv.set_size(LogicalSize::new(position.2, position.3));
        }
    }

    emit_tabs_changed(&app, &state)?;
    Ok(())
}

#[tauri::command]
pub async fn browser_tabs_update_meta(
    app: AppHandle,
    state: tauri::State<'_, BrowserState>,
    tab_id: String,
    url: Option<String>,
    title: Option<String>,
    favicon: Option<String>,
) -> Result<(), String> {
    {
        let mut tabs = state.tabs.lock().map_err(|e| e.to_string())?;
        if let Some(t) = tabs.iter_mut().find(|t| t.id == tab_id) {
            if let Some(u) = url { t.url = u; }
            if let Some(ti) = title { t.title = ti; }
            if let Some(fa) = favicon { t.favicon = fa; }
        } else {
            return Err("Tab not found".to_string());
        }
    }
    emit_tabs_changed(&app, &state)
}
