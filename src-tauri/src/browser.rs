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

pub struct BrowserState {
    webview_label: Mutex<Option<String>>,
    context_menu_labels: Mutex<Option<HashMap<String, String>>>,
    // Latest user-initiated nav action awaiting the next page-load Finished event.
    // Cleared on each Finished. Absent → in-page link click → treat as "navigate".
    pending_nav: Mutex<Option<PendingNav>>,
}

impl BrowserState {
    pub fn new() -> Self {
        Self {
            webview_label: Mutex::new(None),
            context_menu_labels: Mutex::new(None),
            pending_nav: Mutex::new(None),
        }
    }
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
pub async fn browser_open_devtools(app: AppHandle) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
    webview.open_devtools();
    Ok(())
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
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app.get_webview(BROWSER_LABEL).ok_or("Browser not created")?;
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
// ---- End private bridge commands -----------------------------------------------

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
