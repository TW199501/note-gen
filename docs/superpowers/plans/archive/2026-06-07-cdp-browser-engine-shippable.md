# CDP Browser Engine (Shippable) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `feat/browser-cdp-engine` WIP into a shippable in-app browser — external CloakBrowser Chromium driven over CDP (chromiumoxide), headless screencast into a `<canvas>`, plus engine delivery, IME, clipboard, crash recovery, security hardening, popup/context-menu/find/downloads, finishing & tests.

**Architecture:** Out-of-process headless Chromium <-> CDP via chromiumoxide; frames stream over a tauri `Channel` into a `<canvas>`; input is synthesized back over CDP. Tauri stays lean (no embedded browser).

**Tech Stack:** Rust + Tauri 2, chromiumoxide 0.9, tauri-plugin-store, Next.js 15 / React 19 / TypeScript, next-intl, vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-06-07-cdp-browser-engine-shippable-design.md`

---

## Cross-milestone surface contract

New Tauri commands and events introduced by this plan (keep names consistent across tasks):

| Kind | Name | Introduced by |
| --- | --- | --- |
| command | `browser_engine_download` | M1 |
| command | `browser_engine_set_path` | M1 |
| command | `browser_engine_status` | M1 |
| command | `browser_input_text` | M3 |
| command | `browser_inject_context_menu` | M4 |
| command | `browser_find_start` | M4 |
| command | `browser_find_next` | M4 |
| command | `browser_find_prev` | M4 |
| command | `browser_find_close` | M4 |
| event | `browser-engine-exited` | M2 |
| event | `browser-context-action` | M4 |
| event | `browser-find-state` | M4 |
| event | `browser-download-started` | M4 |
| event | `browser-download-finished` | M4 |
| event | `browser-favicon-changed` | M5 |

## Milestone 1: Engine delivery + status truthing

**Goal:** Make the in-app browser installable and honest on a clean machine — add a desktop-only CloakBrowser downloader (`browser_engine_download` with a `Channel<DownloadProgress>`), persist the BYO path, report a truthful engine `source` (never the fake `"system"`), surface all of it in a Settings "Browser Engine" section, and replace the blank-canvas-on-no-engine failure with a preflight empty-state card + create-failure error path.

---

### Task 1: Rust engine-download pure helpers

**Files:**
- Modify `src-tauri/Cargo.toml:49-66` (add `sha2` to the desktop-only deps block)
- Modify `src-tauri/src/browser_engine.rs` (append helpers + `#[cfg(test)] mod tests` after line 269; fix stale doc comment at lines 5-7)
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/browser_engine.rs`

- [ ] **Step 1: Add the failing tests.** Append to `src-tauri/src/browser_engine.rs` (after the final `}` of `cloak_cache_dir`, currently line 269):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn release_api_url_is_tag_endpoint() {
        assert_eq!(
            cloak_release_api_url("CloakHQ/CloakBrowser", "chromium-v146.0.7680.177.5"),
            "https://api.github.com/repos/CloakHQ/CloakBrowser/releases/tags/chromium-v146.0.7680.177.5"
        );
    }

    #[test]
    fn asset_name_per_platform() {
        assert_eq!(asset_name_for("windows", "x86_64").as_deref(), Some("cloakbrowser-windows-x64.zip"));
        assert_eq!(asset_name_for("linux", "x86_64").as_deref(), Some("cloakbrowser-linux-x64.zip"));
        assert_eq!(asset_name_for("macos", "x86_64").as_deref(), Some("cloakbrowser-macos-x64.zip"));
        assert_eq!(asset_name_for("freebsd", "x86_64"), None);
        assert_eq!(asset_name_for("windows", "arm"), None);
    }

    #[test]
    fn select_asset_reads_url_size_digest() {
        let json = serde_json::json!({
            "assets": [
                { "name": "other.zip", "browser_download_url": "https://x/other", "size": 1 },
                { "name": "cloakbrowser-windows-x64.zip",
                  "browser_download_url": "https://x/win.zip",
                  "size": 12345,
                  "digest": "sha256:abc123" }
            ]
        });
        let a = select_release_asset(&json, "cloakbrowser-windows-x64.zip").unwrap();
        assert_eq!(a.download_url, "https://x/win.zip");
        assert_eq!(a.size, 12345);
        assert_eq!(a.sha256.as_deref(), Some("abc123"));
        assert!(select_release_asset(&json, "missing.zip").is_none());
    }

    #[test]
    fn verify_sha256_matches_and_rejects() {
        // sha256("hello")
        let expected = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        assert!(verify_sha256(b"hello", expected).is_ok());
        assert!(verify_sha256(b"hello", "00").is_err());
        // case-insensitive hex
        assert!(verify_sha256(b"hello", &expected.to_uppercase()).is_ok());
    }

    #[test]
    fn sanitize_zip_entry_blocks_traversal() {
        assert_eq!(
            sanitize_zip_entry("cloakbrowser-windows-x64/chrome.exe"),
            Some(std::path::PathBuf::from("cloakbrowser-windows-x64").join("chrome.exe"))
        );
        assert_eq!(sanitize_zip_entry("../evil.txt"), None);
        assert_eq!(sanitize_zip_entry("/abs/path"), None);
        assert_eq!(sanitize_zip_entry(""), None);
    }
}
```

- [ ] **Step 2: Run the tests, expect FAIL.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect a COMPILE failure: `cannot find function `cloak_release_api_url` in this scope` (and the same for `asset_name_for`, `select_release_asset`, `verify_sha256`, `sanitize_zip_entry`, plus `cannot find type `ReleaseAsset``).

- [ ] **Step 3: Add `sha2` dependency.** In `src-tauri/Cargo.toml`, inside the `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]` block (the one containing `chromiumoxide = "0.9"` at line 65), add below `base64 = "0.22"`:
```toml
sha2 = "0.10"
```

- [ ] **Step 4: Implement the helpers.** In `src-tauri/src/browser_engine.rs`, first fix the stale doc comment at lines 5-7 — replace:
```rust
// P0 resolves the executable from (1) a user-supplied BYO path, (2) a
// downloaded CloakBrowser build (wired in P3), then (3) a system Chrome/Edge
// fallback so the engine can be smoke-tested before the downloader exists.
```
with:
```rust
// Resolves the executable from a user-supplied BYO path, the CLOAKBROWSER_BINARY_PATH
// env var, the in-app downloaded build (browser_engine_download), a dev ./engine
// folder, or the ~/.cloakbrowser cache. There is NO system-Chrome fallback —
// only the stealth CloakBrowser is acceptable.
```
Then insert these items immediately before the `#[cfg(test)] mod tests` block you added in Step 1:
```rust
/// Pinned CloakBrowser release (centrally configured per the spec). NoteGen never
/// mirrors/hosts the binary — it downloads straight from the CloakHQ release.
pub const CLOAK_REPO: &str = "CloakHQ/CloakBrowser";
pub const CLOAK_TAG: &str = "chromium-v146.0.7680.177.5";

/// Progress for the in-app engine download, streamed over a tauri Channel.
/// `phase` is one of "downloading" | "verifying" | "extracting" | "done".
#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub phase: String,
    pub received: u64,
    pub total: u64,
}

/// A single release asset selected from the GitHub release JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReleaseAsset {
    pub download_url: String,
    pub size: u64,
    /// sha256 hex from the asset `digest` field, if GitHub published one.
    pub sha256: Option<String>,
}

/// GitHub "release by tag" API endpoint.
pub fn cloak_release_api_url(repo: &str, tag: &str) -> String {
    format!("https://api.github.com/repos/{repo}/releases/tags/{tag}")
}

/// CloakBrowser archive file name for an (os, arch) pair, or None if unsupported.
pub fn asset_name_for(os: &str, arch: &str) -> Option<String> {
    let plat = match os {
        "windows" => "windows",
        "linux" => "linux",
        "macos" => "macos",
        _ => return None,
    };
    let a = match arch {
        "x86_64" | "x64" => "x64",
        _ => return None,
    };
    Some(format!("cloakbrowser-{plat}-{a}.zip"))
}

/// The asset name for the platform this build is running on.
pub fn current_asset_name() -> Option<String> {
    asset_name_for(std::env::consts::OS, std::env::consts::ARCH)
}

/// Find `name` in a GitHub release JSON's `assets` array.
pub fn select_release_asset(release_json: &serde_json::Value, name: &str) -> Option<ReleaseAsset> {
    let assets = release_json.get("assets")?.as_array()?;
    for a in assets {
        if a.get("name").and_then(|v| v.as_str()) == Some(name) {
            let download_url = a.get("browser_download_url")?.as_str()?.to_string();
            let size = a.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
            let sha256 = a
                .get("digest")
                .and_then(|v| v.as_str())
                .map(|d| d.strip_prefix("sha256:").unwrap_or(d).to_string());
            return Some(ReleaseAsset { download_url, size, sha256 });
        }
    }
    None
}

/// Verify `data` against an expected hex sha256 (case-insensitive).
pub fn verify_sha256(data: &[u8], expected_hex: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    let actual_hex: String = hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect();
    if actual_hex.eq_ignore_ascii_case(expected_hex.trim()) {
        Ok(())
    } else {
        Err(format!("sha256 mismatch: expected {expected_hex}, got {actual_hex}"))
    }
}

/// Normalize a zip entry name to a safe relative path (zip-slip guard). Returns
/// None for empty/absolute/parent-escaping entries so the caller skips them.
pub fn sanitize_zip_entry(name: &str) -> Option<PathBuf> {
    use std::path::Component;
    let mut out = PathBuf::new();
    for comp in Path::new(name).components() {
        match comp {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            _ => return None, // RootDir / ParentDir / Prefix → reject
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}
```

- [ ] **Step 5: Run the tests, expect PASS.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect `test result: ok.` covering `release_api_url_is_tag_endpoint`, `asset_name_per_platform`, `select_asset_reads_url_size_digest`, `verify_sha256_matches_and_rejects`, `sanitize_zip_entry_blocks_traversal`.

- [ ] **Step 6: Commit.**
```
git add src-tauri/Cargo.toml src-tauri/src/browser_engine.rs
git commit -m "feat(browser): add CloakBrowser download/verify pure helpers"
```

---

### Task 2: Rust `browser_engine_download` command + zip extraction

**Files:**
- Modify `src-tauri/src/browser_engine.rs` (add `extract_zip_bytes` + a test)
- Modify `src-tauri/src/browser.rs` (add `downloaded_engine_dir` near line 251; add `browser_engine_download` command after `browser_engine_status` at line 1047; add mobile stub after line 1328)
- Modify `src-tauri/src/lib.rs:22-34,68-101` and `src-tauri/src/main.rs:35-45,102-135` (register the command)
- Test: `extract_zip_roundtrip` in `src-tauri/src/browser_engine.rs` `mod tests`

- [ ] **Step 1: Add the failing extraction test.** Inside the `mod tests` block in `src-tauri/src/browser_engine.rs`, add:
```rust
    #[test]
    fn extract_zip_roundtrip_and_zip_slip_guard() {
        use std::io::Write;
        // Build an in-memory zip with one good entry and one traversal entry.
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts: zip::write::FileOptions<'_, ()> =
                zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            zw.start_file("cloakbrowser-windows-x64/chrome.exe", opts).unwrap();
            zw.write_all(b"ENGINE").unwrap();
            zw.start_file("../evil.txt", opts).unwrap();
            zw.write_all(b"PWNED").unwrap();
            zw.finish().unwrap();
        }
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dest = std::env::temp_dir().join(format!("notegen-zip-test-{n}"));
        extract_zip_bytes(&buf, &dest).unwrap();

        let good = dest.join("cloakbrowser-windows-x64").join("chrome.exe");
        assert!(good.is_file());
        assert_eq!(std::fs::read(&good).unwrap(), b"ENGINE");
        // Traversal entry must NOT escape `dest`.
        assert!(!dest.parent().unwrap().join("evil.txt").exists());

        let _ = std::fs::remove_dir_all(&dest);
    }
```

- [ ] **Step 2: Run, expect FAIL.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect a COMPILE failure: `cannot find function `extract_zip_bytes` in this scope`.

- [ ] **Step 3: Implement `extract_zip_bytes`.** In `src-tauri/src/browser_engine.rs`, add right before the `#[cfg(test)] mod tests` block:
```rust
/// Extract a zip (held entirely in memory) into `dest`, applying the zip-slip
/// guard from `sanitize_zip_entry`. Preserves the unix exec bit so `chrome` is
/// launchable.
pub fn extract_zip_bytes(zip_bytes: &[u8], dest: &Path) -> Result<(), String> {
    use std::io::{Cursor, Read, Write};
    let mut archive =
        zip::ZipArchive::new(Cursor::new(zip_bytes)).map_err(|e| format!("open zip: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("zip entry {i}: {e}"))?;
        let rel = match sanitize_zip_entry(entry.name()) {
            Some(p) => p,
            None => continue,
        };
        let out_path = dest.join(&rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|e| format!("mkdir {}: {e}", out_path.display()))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {}: {e}", parent.display()))?;
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut data)
            .map_err(|e| format!("read {}: {e}", rel.display()))?;
        let mut f = std::fs::File::create(&out_path)
            .map_err(|e| format!("create {}: {e}", out_path.display()))?;
        f.write_all(&data)
            .map_err(|e| format!("write {}: {e}", out_path.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = std::fs::set_permissions(&out_path, std::fs::Permissions::from_mode(mode));
            }
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Run, expect PASS.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect `extract_zip_roundtrip_and_zip_slip_guard ... ok` alongside the Task 1 tests.

- [ ] **Step 5: Add `downloaded_engine_dir` + the command (desktop).** In `src-tauri/src/browser.rs`, add immediately after `user_data_dir` (ends at line 254):
```rust
    /// Where browser_engine_download installs the engine: app_data/cloakbrowser/<tag>.
    fn downloaded_engine_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
        let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
        Ok(base
            .join("cloakbrowser")
            .join(browser_engine::CLOAK_TAG))
    }
```
Then add, right after the closing `}` of `browser_engine_status` (currently line 1047, before the `}` that closes `mod desktop`):
```rust
    #[tauri::command]
    pub async fn browser_engine_download(
        app: AppHandle,
        _state: tauri::State<'_, CdpState>,
        on_progress: Channel<browser_engine::DownloadProgress>,
    ) -> Result<String, String> {
        use browser_engine::DownloadProgress;

        let asset_name = browser_engine::current_asset_name()
            .ok_or_else(|| "no CloakBrowser build for this platform/arch".to_string())?;
        let api_url =
            browser_engine::cloak_release_api_url(browser_engine::CLOAK_REPO, browser_engine::CLOAK_TAG);

        let client = reqwest::Client::builder()
            .user_agent("NoteGen")
            .build()
            .map_err(|e| format!("http client: {e}"))?;

        let release: Value = client
            .get(&api_url)
            .send()
            .await
            .map_err(|e| format!("fetch release metadata: {e}"))?
            .error_for_status()
            .map_err(|e| format!("release metadata status: {e}"))?
            .json()
            .await
            .map_err(|e| format!("parse release metadata: {e}"))?;

        let asset = browser_engine::select_release_asset(&release, &asset_name).ok_or_else(|| {
            format!("asset {asset_name} not found in release {}", browser_engine::CLOAK_TAG)
        })?;

        let _ = on_progress.send(DownloadProgress {
            phase: "downloading".into(),
            received: 0,
            total: asset.size,
        });

        let resp = client
            .get(&asset.download_url)
            .send()
            .await
            .map_err(|e| format!("download: {e}"))?
            .error_for_status()
            .map_err(|e| format!("download status: {e}"))?;
        let total = resp.content_length().unwrap_or(asset.size);

        let mut stream = resp.bytes_stream();
        let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
        let mut received: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("download chunk: {e}"))?;
            bytes.extend_from_slice(&chunk);
            received += chunk.len() as u64;
            let _ = on_progress.send(DownloadProgress {
                phase: "downloading".into(),
                received,
                total,
            });
        }

        if asset.size != 0 && bytes.len() as u64 != asset.size {
            return Err(format!("size mismatch: expected {}, got {}", asset.size, bytes.len()));
        }
        let _ = on_progress.send(DownloadProgress {
            phase: "verifying".into(),
            received,
            total,
        });
        if let Some(expected) = asset.sha256.as_deref() {
            browser_engine::verify_sha256(&bytes, expected)?;
        }

        let _ = on_progress.send(DownloadProgress {
            phase: "extracting".into(),
            received,
            total,
        });
        let dest = downloaded_engine_dir(&app)?;
        std::fs::create_dir_all(&dest).map_err(|e| format!("create install dir: {e}"))?;
        browser_engine::extract_zip_bytes(&bytes, &dest)?;

        // Confirm the resolver can now find the freshly-installed executable.
        browser_engine::resolve_engine_executable(None, Some(&dest))
            .map_err(|e| format!("engine extracted but executable not found: {e}"))?;

        let _ = on_progress.send(DownloadProgress {
            phase: "done".into(),
            received,
            total,
        });
        Ok(dest.to_string_lossy().to_string())
    }
```

- [ ] **Step 6: Add the mobile stub.** In `src-tauri/src/browser.rs`, in the `mod mobile` block, add after `browser_engine_status` (the function ending at line 1328, before the closing `}` of `mod mobile`):
```rust
    #[tauri::command]
    pub async fn browser_engine_download(
        _app: tauri::AppHandle,
        _state: S<'_>,
        _on_progress: tauri::ipc::Channel<Value>,
    ) -> Result<String, String> {
        Err(UNSUPPORTED.into())
    }
```

- [ ] **Step 7: Register the command in both entry files.** In `src-tauri/src/lib.rs`, change line 32 from `browser_engine_set_path, browser_engine_status,` to:
```rust
    browser_engine_set_path, browser_engine_status, browser_engine_download,
```
and add `browser_engine_download,` after `browser_engine_status,` at line 101 in the `generate_handler!` list. Apply the identical two edits to `src-tauri/src/main.rs` (import line 44 and handler line 135).

- [ ] **Step 8: Build, expect PASS.** Run:
```
cargo build --manifest-path src-tauri/Cargo.toml
```
Expect a successful build (warnings allowed). Then re-run `cargo test --manifest-path src-tauri/Cargo.toml browser_engine` and expect all tests `ok`.

- [ ] **Step 9: Commit.**
```
git add src-tauri/src/browser_engine.rs src-tauri/src/browser.rs src-tauri/src/lib.rs src-tauri/src/main.rs
git commit -m "feat(browser): add browser_engine_download command with progress + zip install"
```

---

### Task 3: Truthful engine status + resolver source + BYO persistence

**Files:**
- Modify `src-tauri/src/browser_engine.rs` (add `EngineSource` + `resolve_engine_with_source` + `parse_stored_engine_path`; refactor `resolve_engine_executable:166-213`; add tests)
- Modify `src-tauri/src/browser.rs` (rewrite `browser_engine_status:1029-1047` + `browser_engine_set_path:1020-1027`; fix `ensure_engine:263-272`; add `load_persisted_byo_path` + store consts; update `EngineStatus` doc comment at 1015)
- Modify `src-tauri/src/app_setup.rs:28` (restore BYO path on startup)
- Test: `mod tests` in `src-tauri/src/browser_engine.rs`

- [ ] **Step 1: Add failing tests.** Inside the `mod tests` block of `src-tauri/src/browser_engine.rs`, add:
```rust
    fn unique_temp_dir(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("notegen-resolve-{tag}-{n}"))
    }

    fn exe_name() -> &'static str {
        if cfg!(windows) { "chrome.exe" } else { "chrome" }
    }

    #[test]
    fn byo_file_resolves_as_byo() {
        let dir = unique_temp_dir("byo");
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join(exe_name());
        std::fs::write(&exe, b"x").unwrap();
        let (p, src) = resolve_engine_with_source(Some(exe.to_str().unwrap()), None).unwrap();
        assert_eq!(p, exe);
        assert_eq!(src, EngineSource::Byo);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn downloaded_dir_resolves_as_downloaded() {
        let dir = unique_temp_dir("dl");
        let sub = dir.join("cloakbrowser-windows-x64");
        std::fs::create_dir_all(&sub).unwrap();
        let exe = sub.join(exe_name());
        std::fs::write(&exe, b"x").unwrap();
        let (p, src) = resolve_engine_with_source(None, Some(&dir)).unwrap();
        assert_eq!(p, exe);
        assert_eq!(src, EngineSource::Downloaded);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn byo_missing_path_errors() {
        let err = resolve_engine_with_source(Some("Z:/definitely/missing/chrome.exe"), None).unwrap_err();
        assert!(err.contains("does not exist"));
    }

    #[test]
    fn engine_source_strings_never_say_system() {
        assert_eq!(EngineSource::Byo.as_str(), "byo");
        assert_eq!(EngineSource::Env.as_str(), "env");
        assert_eq!(EngineSource::Downloaded.as_str(), "downloaded");
        assert_eq!(EngineSource::DevEngineDir.as_str(), "dev-engine-dir");
        assert_eq!(EngineSource::Cache.as_str(), "cache");
    }

    #[test]
    fn parse_stored_path_trims_and_filters() {
        assert_eq!(parse_stored_engine_path(&serde_json::json!("C:/x/chrome.exe")).as_deref(), Some("C:/x/chrome.exe"));
        assert_eq!(parse_stored_engine_path(&serde_json::json!("   ")), None);
        assert_eq!(parse_stored_engine_path(&serde_json::json!(null)), None);
        assert_eq!(parse_stored_engine_path(&serde_json::json!(123)), None);
    }
```

- [ ] **Step 2: Run, expect FAIL.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect COMPILE failure: `cannot find function `resolve_engine_with_source``, `cannot find type `EngineSource``, `cannot find function `parse_stored_engine_path``.

- [ ] **Step 3: Refactor the resolver + add the new items.** In `src-tauri/src/browser_engine.rs`, replace the entire body of `resolve_engine_executable` (lines 166-213, from `pub fn resolve_engine_executable(` through its closing `}`) with:
```rust
/// Engine source for truthful status reporting. NEVER reports a system browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineSource {
    Byo,
    Env,
    Downloaded,
    DevEngineDir,
    Cache,
}

impl EngineSource {
    pub fn as_str(self) -> &'static str {
        match self {
            EngineSource::Byo => "byo",
            EngineSource::Env => "env",
            EngineSource::Downloaded => "downloaded",
            EngineSource::DevEngineDir => "dev-engine-dir",
            EngineSource::Cache => "cache",
        }
    }
}

/// Resolve the CloakBrowser executable AND report which source it came from.
pub fn resolve_engine_with_source(
    byo_path: Option<&str>,
    downloaded_dir: Option<&Path>,
) -> Result<(PathBuf, EngineSource), String> {
    if let Some(byo) = byo_path {
        let p = PathBuf::from(byo);
        if p.is_file() {
            return Ok((p, EngineSource::Byo));
        }
        if p.is_dir() {
            return find_chromium_in_dir(&p)
                .map(|e| (e, EngineSource::Byo))
                .ok_or_else(|| format!("no Chromium executable found under: {byo}"));
        }
        return Err(format!("configured browser engine path does not exist: {byo}"));
    }

    if let Ok(env_path) = std::env::var("CLOAKBROWSER_BINARY_PATH") {
        let p = PathBuf::from(&env_path);
        if p.is_file() {
            return Ok((p, EngineSource::Env));
        }
    }

    if let Some(dir) = downloaded_dir {
        if let Some(exe) = find_chromium_in_dir(dir) {
            return Ok((exe, EngineSource::Downloaded));
        }
    }

    for rel in ["engine", "../engine"] {
        let p = PathBuf::from(rel);
        if p.is_dir() {
            if let Some(exe) = find_chromium_in_dir(&p) {
                return Ok((exe, EngineSource::DevEngineDir));
            }
        }
    }

    if let Some(cache) = cloak_cache_dir() {
        if let Some(exe) = find_chromium_in_dir(&cache) {
            return Ok((exe, EngineSource::Cache));
        }
    }

    Err("CloakBrowser not found — download it from Settings, set CLOAKBROWSER_BINARY_PATH, or extract it into ./engine".to_string())
}

/// Path-only resolution (delegates to `resolve_engine_with_source`).
pub fn resolve_engine_executable(
    byo_path: Option<&str>,
    downloaded_dir: Option<&Path>,
) -> Result<PathBuf, String> {
    resolve_engine_with_source(byo_path, downloaded_dir).map(|(p, _)| p)
}

/// Parse a persisted BYO path stored in tauri-plugin-store (a JSON string).
pub fn parse_stored_engine_path(v: &serde_json::Value) -> Option<String> {
    v.as_str()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
```

- [ ] **Step 4: Run, expect PASS.** Run:
```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine
```
Expect all tests `ok`, including the new `byo_file_resolves_as_byo`, `downloaded_dir_resolves_as_downloaded`, `byo_missing_path_errors`, `engine_source_strings_never_say_system`, `parse_stored_path_trims_and_filters`.

- [ ] **Step 5: Wire truthful status + persistence into browser.rs.** In `src-tauri/src/browser.rs`, add store constants just above the `EngineStatus` struct (line 1012):
```rust
    const ENGINE_STORE_FILE: &str = "browser-engine.json";
    const ENGINE_STORE_KEY: &str = "byo_path";
```
Update the `EngineStatus` doc comment at line 1015 from `/// "byo" | "downloaded" | "system" | "none"` to:
```rust
        /// "byo" | "env" | "downloaded" | "dev-engine-dir" | "cache" | "none"
```
Replace `browser_engine_set_path` (lines 1020-1027) with:
```rust
    #[tauri::command]
    pub async fn browser_engine_set_path(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
        path: Option<String>,
    ) -> Result<(), String> {
        use tauri_plugin_store::StoreExt;
        let cleaned = path.filter(|p| !p.trim().is_empty());
        *state.byo_path.lock().await = cleaned.clone();
        let store = app.store(ENGINE_STORE_FILE).map_err(|e| e.to_string())?;
        match &cleaned {
            Some(p) => store.set(ENGINE_STORE_KEY, serde_json::Value::String(p.clone())),
            None => {
                store.delete(ENGINE_STORE_KEY);
            }
        }
        store.save().map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Restore the persisted BYO path into CdpState on startup.
    pub async fn load_persisted_byo_path(app: &AppHandle, state: &CdpState) {
        use tauri_plugin_store::StoreExt;
        if let Ok(store) = app.store(ENGINE_STORE_FILE) {
            if let Some(v) = store.get(ENGINE_STORE_KEY) {
                if let Some(p) = browser_engine::parse_stored_engine_path(&v) {
                    *state.byo_path.lock().await = Some(p);
                }
            }
        }
    }
```
Replace `browser_engine_status` (lines 1029-1047) with:
```rust
    #[tauri::command]
    pub async fn browser_engine_status(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
    ) -> Result<EngineStatus, String> {
        let byo = state.byo_path.lock().await.clone();
        let downloaded = downloaded_engine_dir(&app).ok();
        match browser_engine::resolve_engine_with_source(byo.as_deref(), downloaded.as_deref()) {
            Ok((p, src)) => Ok(EngineStatus {
                installed: true,
                source: src.as_str().to_string(),
                exe_path: Some(p.to_string_lossy().to_string()),
            }),
            Err(_) => Ok(EngineStatus {
                installed: false,
                source: "none".to_string(),
                exe_path: None,
            }),
        }
    }
```

- [ ] **Step 6: Fix `ensure_engine` to use the downloaded dir.** In `src-tauri/src/browser.rs`, replace lines 263-272 (from `let byo = state.byo_path.lock().await.clone();` through the `let exe = browser_engine::resolve_engine_executable(...)?;`) with:
```rust
        let byo = state.byo_path.lock().await.clone();
        // The engine is never bundled (resources are icons-only); prefer the
        // in-app downloaded install dir, then the resolver's env/dev/cache fallbacks.
        let downloaded = downloaded_engine_dir(app).ok();
        let exe = browser_engine::resolve_engine_executable(byo.as_deref(), downloaded.as_deref())?;
```

- [ ] **Step 7: Restore BYO path on startup.** In `src-tauri/src/app_setup.rs`, insert before `Ok(())` at line 28:
```rust
    // Desktop-only: restore the persisted BYO browser-engine path so the in-app
    // browser can launch without re-selecting it each session.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::Manager;
        let state = app_handle.state::<crate::browser::CdpState>();
        tauri::async_runtime::block_on(crate::browser::load_persisted_byo_path(&app_handle, &state));
    }
```

- [ ] **Step 8: Build + test, expect PASS.** Run:
```
cargo build --manifest-path src-tauri/Cargo.toml
```
Expect a clean build. Manual smoke: with no engine present, `browser_engine_status` returns `{installed:false, source:"none"}` (never `"system"`); after a `browser_engine_set_path` to a real exe and an app restart, status returns `source:"byo"` with that path.

- [ ] **Step 9: Commit.**
```
git add src-tauri/src/browser_engine.rs src-tauri/src/browser.rs src-tauri/src/app_setup.rs
git commit -m "feat(browser): truthful engine status source + persist BYO path"
```

---

### Task 4: i18n keys for the engine UI (all 5 locales)

**Files:**
- Create `src/lib/browser/engine-i18n.test.ts`
- Modify `messages/en.json:422` and `messages/en.json:2070`
- Modify `messages/zh.json:420` and `messages/zh.json:2013`
- Modify `messages/zh-TW.json:366` and `messages/zh-TW.json:2106`
- Modify `messages/ja.json:366` and `messages/ja.json:2047`
- Modify `messages/pt-BR.json:372` and `messages/pt-BR.json:2101`

- [ ] **Step 1: Write the failing parity test.** Create `src/lib/browser/engine-i18n.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import en from '../../../messages/en.json'
import zh from '../../../messages/zh.json'
import zhTW from '../../../messages/zh-TW.json'
import ja from '../../../messages/ja.json'
import ptBR from '../../../messages/pt-BR.json'

const REQUIRED_KEYS = [
  'settings.editor.browserEngine',
  'settings.editor.browserEngineDesc',
  'settings.editor.engineStatusInstalled',
  'settings.editor.engineStatusNotInstalled',
  'settings.editor.engineSourceByo',
  'settings.editor.engineSourceEnv',
  'settings.editor.engineSourceDownloaded',
  'settings.editor.engineSourceDevEngineDir',
  'settings.editor.engineSourceCache',
  'settings.editor.engineSourceNone',
  'settings.editor.engineDownload',
  'settings.editor.engineDownloading',
  'settings.editor.engineVerifying',
  'settings.editor.engineExtracting',
  'settings.editor.engineDownloadSuccess',
  'settings.editor.engineDownloadFailed',
  'settings.editor.engineChoosePath',
  'settings.editor.enginePathPlaceholder',
  'browser.engine.notInstalledTitle',
  'browser.engine.notInstalledDesc',
  'browser.engine.downloadCta',
  'browser.engine.choosePathCta',
  'browser.engine.openSettings',
  'browser.engine.createFailedTitle',
  'browser.engine.createFailedDesc',
]

const locales: Record<string, unknown> = { en, zh, 'zh-TW': zhTW, ja, 'pt-BR': ptBR }

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k]
    return undefined
  }, obj)
}

describe('browser engine i18n keys', () => {
  for (const [name, msgs] of Object.entries(locales)) {
    for (const key of REQUIRED_KEYS) {
      it(`${name} has ${key}`, () => {
        const v = getPath(msgs, key)
        expect(typeof v).toBe('string')
        expect((v as string).length).toBeGreaterThan(0)
      })
    }
  }
})
```

- [ ] **Step 2: Run, expect FAIL.** Run:
```
pnpm test:run src/lib/browser/engine-i18n.test.ts
```
Expect failures like `en has settings.editor.browserEngine` → `expected 'undefined' to be 'string'` for all keys/locales.

- [ ] **Step 3: Add the `settings.editor` keys.** In `messages/en.json`, after `"browserHomepageDesc": ...,` (line 422), insert:
```json
      "browserEngine": "Browser Engine",
      "browserEngineDesc": "Download or select the CloakBrowser engine that powers the in-app browser.",
      "engineStatusInstalled": "Installed",
      "engineStatusNotInstalled": "Not installed",
      "engineSourceByo": "Custom path",
      "engineSourceEnv": "Environment variable",
      "engineSourceDownloaded": "Downloaded",
      "engineSourceDevEngineDir": "Dev engine folder",
      "engineSourceCache": "Cache",
      "engineSourceNone": "None",
      "engineDownload": "Download engine",
      "engineDownloading": "Downloading…",
      "engineVerifying": "Verifying…",
      "engineExtracting": "Extracting…",
      "engineDownloadSuccess": "Browser engine installed",
      "engineDownloadFailed": "Engine download failed",
      "engineChoosePath": "Choose path…",
      "enginePathPlaceholder": "Path to chrome(.exe)",
```
Apply the same block (translated) after `"browserHomepageDesc"` in each other locale — `messages/zh.json:420`:
```json
      "browserEngine": "浏览器引擎",
      "browserEngineDesc": "下载或选择驱动内置浏览器的 CloakBrowser 引擎。",
      "engineStatusInstalled": "已安装",
      "engineStatusNotInstalled": "未安装",
      "engineSourceByo": "自定义路径",
      "engineSourceEnv": "环境变量",
      "engineSourceDownloaded": "已下载",
      "engineSourceDevEngineDir": "开发引擎目录",
      "engineSourceCache": "缓存",
      "engineSourceNone": "无",
      "engineDownload": "下载引擎",
      "engineDownloading": "下载中…",
      "engineVerifying": "校验中…",
      "engineExtracting": "解压中…",
      "engineDownloadSuccess": "浏览器引擎已安装",
      "engineDownloadFailed": "引擎下载失败",
      "engineChoosePath": "选择路径…",
      "enginePathPlaceholder": "chrome(.exe) 路径",
```
`messages/zh-TW.json:366`:
```json
      "browserEngine": "瀏覽器引擎",
      "browserEngineDesc": "下載或選擇驅動內建瀏覽器的 CloakBrowser 引擎。",
      "engineStatusInstalled": "已安裝",
      "engineStatusNotInstalled": "未安裝",
      "engineSourceByo": "自訂路徑",
      "engineSourceEnv": "環境變數",
      "engineSourceDownloaded": "已下載",
      "engineSourceDevEngineDir": "開發引擎目錄",
      "engineSourceCache": "快取",
      "engineSourceNone": "無",
      "engineDownload": "下載引擎",
      "engineDownloading": "下載中…",
      "engineVerifying": "驗證中…",
      "engineExtracting": "解壓中…",
      "engineDownloadSuccess": "瀏覽器引擎已安裝",
      "engineDownloadFailed": "引擎下載失敗",
      "engineChoosePath": "選擇路徑…",
      "enginePathPlaceholder": "chrome(.exe) 路徑",
```
`messages/ja.json:366`:
```json
      "browserEngine": "ブラウザエンジン",
      "browserEngineDesc": "アプリ内ブラウザを動かす CloakBrowser エンジンをダウンロードまたは選択します。",
      "engineStatusInstalled": "インストール済み",
      "engineStatusNotInstalled": "未インストール",
      "engineSourceByo": "カスタムパス",
      "engineSourceEnv": "環境変数",
      "engineSourceDownloaded": "ダウンロード済み",
      "engineSourceDevEngineDir": "開発エンジンフォルダ",
      "engineSourceCache": "キャッシュ",
      "engineSourceNone": "なし",
      "engineDownload": "エンジンをダウンロード",
      "engineDownloading": "ダウンロード中…",
      "engineVerifying": "検証中…",
      "engineExtracting": "展開中…",
      "engineDownloadSuccess": "ブラウザエンジンをインストールしました",
      "engineDownloadFailed": "エンジンのダウンロードに失敗しました",
      "engineChoosePath": "パスを選択…",
      "enginePathPlaceholder": "chrome(.exe) のパス",
```
`messages/pt-BR.json:372`:
```json
      "browserEngine": "Mecanismo do navegador",
      "browserEngineDesc": "Baixe ou selecione o mecanismo CloakBrowser que executa o navegador interno.",
      "engineStatusInstalled": "Instalado",
      "engineStatusNotInstalled": "Não instalado",
      "engineSourceByo": "Caminho personalizado",
      "engineSourceEnv": "Variável de ambiente",
      "engineSourceDownloaded": "Baixado",
      "engineSourceDevEngineDir": "Pasta de desenvolvimento",
      "engineSourceCache": "Cache",
      "engineSourceNone": "Nenhum",
      "engineDownload": "Baixar mecanismo",
      "engineDownloading": "Baixando…",
      "engineVerifying": "Verificando…",
      "engineExtracting": "Extraindo…",
      "engineDownloadSuccess": "Mecanismo do navegador instalado",
      "engineDownloadFailed": "Falha ao baixar o mecanismo",
      "engineChoosePath": "Escolher caminho…",
      "enginePathPlaceholder": "Caminho para chrome(.exe)",
```

- [ ] **Step 4: Add the `browser.engine` block.** In `messages/en.json`, immediately after the line `"browser": {` (line 2070), insert:
```json
    "engine": {
      "notInstalledTitle": "Browser engine not installed",
      "notInstalledDesc": "Download the CloakBrowser engine or choose an existing one to start browsing.",
      "downloadCta": "Download engine",
      "choosePathCta": "Choose path",
      "openSettings": "Open settings",
      "createFailedTitle": "Couldn't start the browser engine",
      "createFailedDesc": "Check the engine in Settings and try again."
    },
```
Insert the translated equivalent after the `"browser": {` line in each other locale — `messages/zh.json:2013`:
```json
    "engine": {
      "notInstalledTitle": "浏览器引擎未安装",
      "notInstalledDesc": "下载 CloakBrowser 引擎，或选择已有引擎以开始浏览。",
      "downloadCta": "下载引擎",
      "choosePathCta": "选择路径",
      "openSettings": "打开设置",
      "createFailedTitle": "无法启动浏览器引擎",
      "createFailedDesc": "请在设置中检查引擎后重试。"
    },
```
`messages/zh-TW.json:2106`:
```json
    "engine": {
      "notInstalledTitle": "瀏覽器引擎未安裝",
      "notInstalledDesc": "下載 CloakBrowser 引擎，或選擇現有引擎以開始瀏覽。",
      "downloadCta": "下載引擎",
      "choosePathCta": "選擇路徑",
      "openSettings": "開啟設定",
      "createFailedTitle": "無法啟動瀏覽器引擎",
      "createFailedDesc": "請在設定中檢查引擎後重試。"
    },
```
`messages/ja.json:2047`:
```json
    "engine": {
      "notInstalledTitle": "ブラウザエンジンが未インストールです",
      "notInstalledDesc": "CloakBrowser エンジンをダウンロードするか、既存のエンジンを選択して閲覧を開始します。",
      "downloadCta": "エンジンをダウンロード",
      "choosePathCta": "パスを選択",
      "openSettings": "設定を開く",
      "createFailedTitle": "ブラウザエンジンを起動できませんでした",
      "createFailedDesc": "設定でエンジンを確認して再試行してください。"
    },
```
`messages/pt-BR.json:2101`:
```json
    "engine": {
      "notInstalledTitle": "Mecanismo do navegador não instalado",
      "notInstalledDesc": "Baixe o mecanismo CloakBrowser ou escolha um existente para começar a navegar.",
      "downloadCta": "Baixar mecanismo",
      "choosePathCta": "Escolher caminho",
      "openSettings": "Abrir configurações",
      "createFailedTitle": "Não foi possível iniciar o mecanismo do navegador",
      "createFailedDesc": "Verifique o mecanismo nas Configurações e tente novamente."
    },
```

- [ ] **Step 5: Run, expect PASS.** Run:
```
pnpm test:run src/lib/browser/engine-i18n.test.ts
```
Expect all `(5 locales × 25 keys)` assertions green. Then verify LF endings on the 5 files (no CRLF introduced by the edits).

- [ ] **Step 6: Commit.**
```
git add src/lib/browser/engine-i18n.test.ts messages/en.json messages/zh.json messages/zh-TW.json messages/ja.json messages/pt-BR.json
git commit -m "feat(i18n): add browser engine settings + empty-state keys (5 locales)"
```

---

### Task 5: Settings "Browser Engine" section

**Files:**
- Create `src/lib/browser/engine-status.ts`
- Create `src/lib/browser/engine-status.test.ts`
- Create `src/app/core/setting/editor/browser-engine.tsx`
- Modify `src/app/core/setting/editor/page.tsx:9,21`

- [ ] **Step 1: Write the failing pure-helper test.** Create `src/lib/browser/engine-status.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { downloadPercent, engineSourceLabelKey } from './engine-status'

describe('downloadPercent', () => {
  it('returns 0 when total is 0 or unknown', () => {
    expect(downloadPercent(0, 0)).toBe(0)
    expect(downloadPercent(50, 0)).toBe(0)
    expect(downloadPercent(10, Number.NaN)).toBe(0)
  })
  it('computes a rounded percent', () => {
    expect(downloadPercent(50, 100)).toBe(50)
    expect(downloadPercent(1, 3)).toBe(33)
  })
  it('clamps to 0..100', () => {
    expect(downloadPercent(150, 100)).toBe(100)
    expect(downloadPercent(-5, 100)).toBe(0)
  })
})

describe('engineSourceLabelKey', () => {
  it('maps known sources', () => {
    expect(engineSourceLabelKey('byo')).toBe('engineSourceByo')
    expect(engineSourceLabelKey('env')).toBe('engineSourceEnv')
    expect(engineSourceLabelKey('downloaded')).toBe('engineSourceDownloaded')
    expect(engineSourceLabelKey('dev-engine-dir')).toBe('engineSourceDevEngineDir')
    expect(engineSourceLabelKey('cache')).toBe('engineSourceCache')
  })
  it('falls back to none for unknown/system', () => {
    expect(engineSourceLabelKey('none')).toBe('engineSourceNone')
    expect(engineSourceLabelKey('system')).toBe('engineSourceNone')
    expect(engineSourceLabelKey('')).toBe('engineSourceNone')
  })
})
```

- [ ] **Step 2: Run, expect FAIL.** Run:
```
pnpm test:run src/lib/browser/engine-status.test.ts
```
Expect `Failed to resolve import "./engine-status"` (module does not exist yet).

- [ ] **Step 3: Implement the pure helper.** Create `src/lib/browser/engine-status.ts`:
```ts
export type EngineSource =
  | 'byo'
  | 'env'
  | 'downloaded'
  | 'dev-engine-dir'
  | 'cache'
  | 'none'

export interface EngineStatus {
  installed: boolean
  source: EngineSource
  exe_path: string | null
}

export interface DownloadProgress {
  phase: 'downloading' | 'verifying' | 'extracting' | 'done'
  received: number
  total: number
}

// 0–100 integer percent; 0 when total is unknown / non-positive.
export function downloadPercent(received: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const pct = Math.round((received / total) * 100)
  if (pct < 0) return 0
  if (pct > 100) return 100
  return pct
}

// Maps a Rust engine `source` to its i18n key under `settings.editor`.
export function engineSourceLabelKey(source: string): string {
  switch (source) {
    case 'byo': return 'engineSourceByo'
    case 'env': return 'engineSourceEnv'
    case 'downloaded': return 'engineSourceDownloaded'
    case 'dev-engine-dir': return 'engineSourceDevEngineDir'
    case 'cache': return 'engineSourceCache'
    default: return 'engineSourceNone'
  }
}
```

- [ ] **Step 4: Run, expect PASS.** Run:
```
pnpm test:run src/lib/browser/engine-status.test.ts
```
Expect both `describe` blocks green.

- [ ] **Step 5: Build the Settings section component.** Create `src/app/core/setting/editor/browser-engine.tsx`:
```tsx
'use client';
import { useCallback, useEffect, useState } from 'react'
import { invoke, Channel } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useTranslations } from 'next-intl'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '@/components/ui/item'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from '@/hooks/use-toast'
import {
  type EngineStatus,
  type DownloadProgress,
  downloadPercent,
  engineSourceLabelKey,
} from '@/lib/browser/engine-status'

export default function BrowserEngine() {
  const t = useTranslations('settings.editor')
  const [status, setStatus] = useState<EngineStatus | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)

  const refresh = useCallback(async () => {
    try {
      setStatus(await invoke<EngineStatus>('browser_engine_status'))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const onDownload = useCallback(async () => {
    setDownloading(true)
    setProgress({ phase: 'downloading', received: 0, total: 0 })
    const channel = new Channel<DownloadProgress>()
    channel.onmessage = (p) => setProgress(p)
    try {
      await invoke('browser_engine_download', { onProgress: channel })
      toast({ title: t('engineDownloadSuccess') })
      await refresh()
    } catch (e) {
      toast({ title: t('engineDownloadFailed'), description: String(e), variant: 'destructive' })
    } finally {
      setDownloading(false)
      setProgress(null)
    }
  }, [refresh, t])

  const onChoosePath = useCallback(async () => {
    const picked = await openDialog({ directory: false, multiple: false })
    if (typeof picked !== 'string') return
    try {
      await invoke('browser_engine_set_path', { path: picked })
      await refresh()
    } catch (e) {
      toast({ title: t('engineDownloadFailed'), description: String(e), variant: 'destructive' })
    }
  }, [refresh, t])

  const phaseLabel = (phase: DownloadProgress['phase']) => {
    if (phase === 'verifying') return t('engineVerifying')
    if (phase === 'extracting') return t('engineExtracting')
    return t('engineDownloading')
  }

  return (
    <Item variant="outline">
      <ItemContent>
        <ItemTitle>{t('browserEngine')}</ItemTitle>
        <ItemDescription>{t('browserEngineDesc')}</ItemDescription>
        <ItemDescription>
          {status?.installed
            ? `${t('engineStatusInstalled')} · ${t(engineSourceLabelKey(status.source))}${status.exe_path ? ` · ${status.exe_path}` : ''}`
            : t('engineStatusNotInstalled')}
        </ItemDescription>
        {downloading && progress && (
          <div className="mt-2 w-64">
            <Progress value={downloadPercent(progress.received, progress.total)} />
            <p className="mt-1 text-xs text-muted-foreground">
              {phaseLabel(progress.phase)} {downloadPercent(progress.received, progress.total)}%
            </p>
          </div>
        )}
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" onClick={onChoosePath} disabled={downloading}>
          {t('engineChoosePath')}
        </Button>
        <Button size="sm" onClick={onDownload} disabled={downloading}>
          {t('engineDownload')}
        </Button>
      </ItemActions>
    </Item>
  )
}
```

- [ ] **Step 6: Wire it into the editor settings page.** In `src/app/core/setting/editor/page.tsx`, add the import after line 9 (`import BrowserHomepage from './browser-homepage';`):
```tsx
import BrowserEngine from './browser-engine';
```
and render it after `<BrowserHomepage />` (line 21):
```tsx
      <BrowserHomepage />
      <BrowserEngine />
```

- [ ] **Step 7: Lint + verify, expect PASS.** Run:
```
pnpm lint
```
Expect no errors for the new files. Manual UI check: open Settings → Editor → "Browser Settings"; the "Browser Engine" item shows `Not installed` on a clean machine, the "Choose path…" button opens a file picker and (on a valid exe) flips status to `Installed · Custom path · <path>`, and "Download engine" shows a progress bar that advances through Downloading/Verifying/Extracting then toasts success.

- [ ] **Step 8: Commit.**
```
git add src/lib/browser/engine-status.ts src/lib/browser/engine-status.test.ts src/app/core/setting/editor/browser-engine.tsx src/app/core/setting/editor/page.tsx
git commit -m "feat(browser): add Browser Engine settings section with download + BYO picker"
```

---

### Task 6: BrowserWebView preflight empty-state + create-failure path

**Files:**
- Modify `src/stores/browser.ts:22-23,86-...` (add `engineInstalled` / `engineError` state)
- Modify `src/app/core/main/browser/browser-webview.tsx:1-34,65-89,221`
- Test: reuse `src/lib/browser/engine-status.test.ts` (no new pure logic); verification is build + manual

- [ ] **Step 1: Add store fields.** In `src/stores/browser.ts`, add to the `BrowserStore` interface (after the `setBrowserReady` declaration at line 23):
```ts
  // M1: 引擎安裝狀態。null = 尚未檢查；false = 未安裝（顯示空狀態卡）；true = 已安裝。
  engineInstalled: boolean | null
  setEngineInstalled: (v: boolean | null) => void
  // M1: browser_create 失敗時的錯誤訊息，供 UI/toast 使用。
  engineError: string | null
  setEngineError: (v: string | null) => void
```
and add to the store implementation (after the `setBrowserReady` entry at line 103):
```ts
  engineInstalled: null,
  setEngineInstalled: (engineInstalled) => set({ engineInstalled }),
  engineError: null,
  setEngineError: (engineError) => set({ engineError }),
```

- [ ] **Step 2: Update imports + destructure in BrowserWebView.** In `src/app/core/main/browser/browser-webview.tsx`, add after line 5 (`import { getCurrentWindow } from '@tauri-apps/api/window'`):
```tsx
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'
```
Add `engineInstalled`, `setEngineInstalled`, `setEngineError` to the `useBrowserStore()` destructure (within lines 22-33), and after the existing `const t = useTranslations('browser.contextMenu')` (line 35) add:
```tsx
  const te = useTranslations('browser.engine')
  const router = useRouter()
```

- [ ] **Step 3: Preflight status + handle create failure.** In the `init()` function (lines 66-88), replace the `try { ... } catch { ... }` block (lines 73-87) with:
```tsx
      try {
        // M1: preflight — never open a blank canvas when the engine is missing.
        const engine = await invoke<{ installed: boolean }>('browser_engine_status')
        if (!engine.installed) {
          useBrowserStore.getState().setEngineInstalled(false)
          initStartedRef.current = false // allow retry once the engine is installed
          return
        }
        useBrowserStore.getState().setEngineInstalled(true)
        // Headless: x/y are ignored; width/height seed the initial viewport until
        // <BrowserScreencast>'s ResizeObserver corrects it via browser_set_viewport.
        await invoke('browser_create', {
          x: 0,
          y: 0,
          width: 1280,
          height: 800,
          url: browserHomepage,
        })
        setBrowserReady(true)
        await injectContextMenu()
      } catch (error) {
        const msg = String(error)
        useBrowserStore.getState().setEngineError(msg)
        toast({ title: te('createFailedTitle'), description: te('createFailedDesc'), variant: 'destructive' })
        router.push('/core/setting/editor')
      }
```

- [ ] **Step 4: Render the empty-state card.** In `src/app/core/main/browser/browser-webview.tsx`, replace the final `return <BrowserScreencast />` (line 221) with:
```tsx
  if (engineInstalled === false) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
          <h3 className="text-lg font-semibold">{te('notInstalledTitle')}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{te('notInstalledDesc')}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => router.push('/core/setting/editor')}>{te('downloadCta')}</Button>
            <Button variant="outline" onClick={() => router.push('/core/setting/editor')}>
              {te('choosePathCta')}
            </Button>
          </div>
        </div>
      </div>
    )
  }
  return <BrowserScreencast />
```
The unused-warning fix: `setEngineInstalled`/`setEngineError` are referenced via `useBrowserStore.getState()` inside `init()`; remove them from the destructure if ESLint flags them as unused there (keep only `engineInstalled` in the destructure for rendering).

- [ ] **Step 5: Lint + tests, expect PASS.** Run:
```
pnpm lint
pnpm test:run
```
Expect lint clean and the full vitest suite green (engine-status + engine-i18n + the pre-existing browser tests). Manual check: temporarily clear the BYO path (`browser_engine_set_path` with empty) and ensure no engine resolves → switching the workspace to browser shows the empty-state card (not a blank canvas), and clicking either CTA navigates to Settings → Editor. With an engine installed, the screencast renders as before.

- [ ] **Step 6: Commit.**
```
git add src/stores/browser.ts src/app/core/main/browser/browser-webview.tsx
git commit -m "feat(browser): preflight engine status + empty-state card and create-failure path"
```

---

### Task 7: Docs + bundling reality (engine/README.md, resources icons-only)

**Files:**
- Modify `engine/README.md` (full rewrite)
- Verify `src-tauri/tauri.conf.json:37-39` stays `["icons"]` (no code change expected)

- [ ] **Step 1: Confirm resources are already icons-only.** Run:
```
git --no-pager grep -n "resources" -- src-tauri/tauri.conf.json
```
Expect the `"resources": [` block to contain only `"icons"` (lines 37-39). If `"../engine/**"` is present, remove it so the block is exactly `["icons"]`. (As read, it is already correct — no edit needed.)

- [ ] **Step 2: Rewrite the README.** Replace the entire contents of `engine/README.md` with:
```markdown
# Local browser engine

NoteGen's in-app browser is an **external CloakBrowser pre-patched Chromium**
driven over CDP (chromiumoxide). This folder is a convenience location for a
dev-supplied build; in production the engine is **downloaded on first use** from
the official CloakHQ release — NoteGen never bundles or mirrors the binary.

**Everything in this folder except this README is git-ignored** — the Chromium
build is large and is "free to use, no redistribution", so it must never be
committed or shipped inside a public release.

## How the engine is delivered

`src-tauri/tauri.conf.json` keeps `resources` as `["icons"]` only — no engine is
bundled. The resolver looks for the executable in this order (see
`src-tauri/src/browser_engine.rs::resolve_engine_with_source`):

1. **BYO path** — set in Settings → Editor → Browser Engine ("Choose path…").
2. **`CLOAKBROWSER_BINARY_PATH`** env var (CloakBrowser's own convention).
3. **Downloaded build** — `Settings → Download engine` installs it into
   `app_data/cloakbrowser/<tag>/` and the resolver finds it there.
4. **Dev `./engine` (or `../engine`)** folder — this directory (depth ≤ 3 scan).
5. **`~/.cloakbrowser`** cache.

There is **no system Chrome/Edge fallback**: only the stealth CloakBrowser is
acceptable, and the engine status reports the real source (one of
`byo`/`env`/`downloaded`/`dev-engine-dir`/`cache`/`none`) — never `system`.

## In-app download (recommended)

Open **Settings → Editor → Browser Engine → Download engine**. NoteGen fetches
the pinned release directly from
`https://github.com/CloakHQ/CloakBrowser/releases/tag/chromium-v146.0.7680.177.5`,
verifies size + sha256 against the release asset metadata, extracts it into
`app_data/cloakbrowser/chromium-v146.0.7680.177.5/`, and the browser becomes
usable immediately.

## Dev / BYO setup

1. Download the CloakBrowser build from the release link above.
2. Extract it anywhere under this folder. Typical layout (depth ≤ 3, the resolver
   scans recursively and matches the platform executable):
   - Windows: `engine/windows/cloakbrowser-windows-x64/chrome.exe`
   - Linux:   `engine/linux/cloakbrowser-linux-x64/chrome`
   - macOS:   `engine/macos/.../Chromium.app/Contents/MacOS/Chromium`
3. Or point NoteGen at any location via Settings → Editor → Browser Engine →
   "Choose path…". The selected path persists across restarts (stored in
   `browser-engine.json`).

## CI / release

CI must **not** fetch or bundle the engine (doing so would redistribute it).
Releases keep `resources = ["icons"]`; users get the engine via the in-app
downloader on first use.
```

- [ ] **Step 3: Verify the docs match reality.** Run:
```
git --no-pager grep -n "system Chrome" -- engine/README.md
git --no-pager grep -n "engine/\*\*" -- engine/README.md
```
Expect BOTH to return no matches (the stale "system Chrome/Edge fallback" claim and the `["icons", "../engine/**"]` bundling claim are gone). Confirm the file uses LF endings.

- [ ] **Step 4: Commit.**
```
git add engine/README.md
git commit -m "docs(browser): rewrite engine README for icons-only + download-on-first-use"
```

> **Assumptions & notes for this milestone:**
> - browser_engine_download streams a tauri Channel<DownloadProgress{phase,received,total}> exactly as named in the SHARED CONTRACT; M-none consume it but the frontend Settings section (this milestone) does.
> - Engine integrity is verified against GitHub release asset metadata (size + the asset `digest` sha256 field) instead of a hardcoded hash, because the real CloakBrowser sha256 is unknowable at plan time and the spec only requires 'size + sha256 verification', not a pinned literal. Version/repo ARE pinned consts (CLOAK_REPO, CLOAK_TAG) matching the README's chromium-v146.0.7680.177.5.
> - resolve_engine_executable is refactored to delegate to a new resolve_engine_with_source so the truthful EngineStatus.source and the launch path share one code path (no drift). The fake 'system' source is removed; sources are byo/env/downloaded/dev-engine-dir/cache/none.
> - ensure_engine (browser.rs:258) currently probes resource_dir for a bundled engine; this milestone repoints it at the app_data downloaded dir because resources stay icons-only (no bundled binary).
> - BYO path now persists to tauri-plugin-store file browser-engine.json and is restored in app_setup::setup_app (desktop-cfg-gated), keeping the mobile command surface identical.
> - Mobile stubs: browser_engine_set_path/status are unchanged (AppHandle is auto-injected only on desktop); only a new browser_engine_download mobile stub is added so the invoke_handler lists stay symmetric.
> - Two ship-blockers from the spec are closed here: a clean machine can install via Settings, and BrowserWebView preflights status to render an empty-state card instead of a permanent blank canvas.


---

## Milestone 2: Crash auto-restart (reliability ship-blocker)

**Goal:** When the external CloakBrowser engine dies or disconnects, the Rust IO handler must detect it (with a PID-reuse-safe identity guard so a stale `engine.pid` can never kill an unrelated process), emit `browser-engine-exited`, and reset `CdpState`; the frontend listens, resets its init guards, and auto-recreates the engine with exponential backoff + a "restarting" indicator, falling back to the M1 error card after a max retry count.

---

### Task 1: Rust engine-identity guard (PID-reuse-safe kill)

Files:
- Modify `src-tauri/src/browser_engine.rs:38-43` (stale-PID read/kill in `launch_chromium`)
- Modify `src-tauri/src/browser_engine.rs:93-95` (PID write-back in `launch_chromium`)
- Modify `src-tauri/src/browser_engine.rs:269` (append pure fns + `process_start_time` + `#[cfg(test)] mod tests`)
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/browser_engine.rs`

- [ ] **Step 1: Write the failing tests.** Append this test module to the end of `src-tauri/src/browser_engine.rs` (after `cloak_cache_dir`, which ends at line 269):

```rust

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_record_two_line() {
        assert_eq!(
            parse_engine_record("1234\n130012345678"),
            Some((1234, Some("130012345678".to_string())))
        );
    }

    #[test]
    fn parse_record_legacy_single_line() {
        assert_eq!(parse_engine_record("1234"), Some((1234, None)));
        assert_eq!(parse_engine_record("1234\n"), Some((1234, None)));
    }

    #[test]
    fn parse_record_garbage() {
        assert_eq!(parse_engine_record(""), None);
        assert_eq!(parse_engine_record("not-a-pid"), None);
    }

    #[test]
    fn format_record_roundtrips() {
        let s = format_engine_record(42, Some("999"));
        assert_eq!(parse_engine_record(&s), Some((42, Some("999".to_string()))));
        assert_eq!(format_engine_record(42, None), "42");
    }

    #[test]
    fn kill_legacy_record_always() {
        // No identity recorded → preserve old always-kill zombie reaping.
        assert_eq!(should_kill_engine(Some((10, None)), None), Some(10));
        assert_eq!(should_kill_engine(Some((10, None)), Some("anything")), Some(10));
    }

    #[test]
    fn kill_only_on_matching_identity() {
        assert_eq!(
            should_kill_engine(Some((10, Some("abc".into()))), Some("abc")),
            Some(10)
        );
    }

    #[test]
    fn skip_kill_on_pid_reuse() {
        // Live process has a different start time → PID was reused → DON'T kill.
        assert_eq!(should_kill_engine(Some((10, Some("abc".into()))), Some("xyz")), None);
    }

    #[test]
    fn skip_kill_when_identity_unknown() {
        // Can't read the live start time → don't kill (could be unrelated or dead).
        assert_eq!(should_kill_engine(Some((10, Some("abc".into()))), None), None);
    }

    #[test]
    fn nothing_to_kill_when_no_record() {
        assert_eq!(should_kill_engine(None, Some("abc")), None);
    }

    #[test]
    fn process_start_time_of_self_is_some() {
        // The current test process is alive, so its start-time must resolve on
        // every supported platform (Windows GetProcessTimes / Linux /proc / macOS ps).
        assert!(process_start_time(std::process::id()).is_some());
    }
}
```

- [ ] **Step 2: Run the test, expect FAIL.** Run:

```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine::tests
```

Expected: compile error, e.g. `error[E0425]: cannot find function `parse_engine_record` in this scope` (also for `format_engine_record`, `should_kill_engine`, `process_start_time`).

- [ ] **Step 3: Implement the pure record + decision functions.** Append immediately ABOVE the `#[cfg(test)] mod tests` you just added (i.e. after `cloak_cache_dir`):

```rust

/// Serialize the engine PID plus its OS start-time token into the sidecar body.
/// Two lines when we have an identity token, a single PID line otherwise.
fn format_engine_record(pid: u32, start_time: Option<&str>) -> String {
    match start_time {
        Some(st) => format!("{pid}\n{st}"),
        None => pid.to_string(),
    }
}

/// Parse the `engine.pid` sidecar. Returns `(pid, Some(start_time))` for the
/// current two-line format, `(pid, None)` for a legacy single-line file, or `None`
/// when the body has no parseable PID.
fn parse_engine_record(contents: &str) -> Option<(u32, Option<String>)> {
    let mut lines = contents.lines();
    let pid = lines.next()?.trim().parse::<u32>().ok()?;
    let start = lines
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Some((pid, start))
}

/// Decide whether the previously-recorded engine should be killed before relaunch.
/// PID-reuse guard: only kill when we can confirm the live process is the same one
/// we recorded (matching OS start-time), or when the record predates the identity
/// guard (legacy single-line file → preserve the old always-kill behavior).
/// Returns `Some(pid)` to kill, `None` to skip.
fn should_kill_engine(
    recorded: Option<(u32, Option<String>)>,
    live_start_time: Option<&str>,
) -> Option<u32> {
    let (pid, recorded_start) = recorded?;
    match recorded_start {
        None => Some(pid), // legacy record without identity: keep old behavior
        Some(rec) => match live_start_time {
            Some(live) if live == rec => Some(pid), // confirmed same process
            _ => None, // mismatch or unknown: do NOT kill an unrelated/dead PID
        },
    }
}

/// OS-specific stable identity token for a running process: its creation time.
/// `None` if the process is gone or its start-time cannot be read. The token is
/// only compared for equality, so any per-process-unique, launch-stable string works.
#[cfg(windows)]
fn process_start_time(pid: u32) -> Option<String> {
    use windows::Win32::Foundation::{CloseHandle, FALSE, FILETIME};
    use windows::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid) else {
            return None;
        };
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let got = GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user);
        let _ = CloseHandle(handle);
        got.ok()?;
        let ticks =
            ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        (ticks != 0).then(|| ticks.to_string())
    }
}

/// Linux: `/proc/<pid>/stat` field 22 (starttime in clock ticks since boot). The
/// `comm` field (2) is parenthesised and may contain spaces, so split after the
/// last ')': the remainder starts at field 3 (state), making starttime index 19.
#[cfg(all(unix, not(target_os = "macos")))]
fn process_start_time(pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let rparen = stat.rfind(')')?;
    let rest = stat.get(rparen + 2..)?; // skip ") "
    rest.split_whitespace().nth(19).map(|s| s.to_string())
}

/// macOS: `ps -o lstart=` prints the absolute (launch-stable) start timestamp.
#[cfg(target_os = "macos")]
fn process_start_time(pid: u32) -> Option<String> {
    let out = std::process::Command::new("ps")
        .args(["-o", "lstart=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run:

```
cargo test --manifest-path src-tauri/Cargo.toml browser_engine::tests
```

Expected: all 10 tests pass (`test result: ok. 10 passed`).

- [ ] **Step 5: Wire the guard into `launch_chromium` (read side).** Replace lines 38-43 of `src-tauri/src/browser_engine.rs`:

```rust
    let pid_file = user_data_dir.join("engine.pid");
    if let Ok(prev) = std::fs::read_to_string(&pid_file) {
        if let Ok(prev_pid) = prev.trim().parse::<u32>() {
            kill_pid_tree(prev_pid);
        }
    }
```

with:

```rust
    let pid_file = user_data_dir.join("engine.pid");
    if let Ok(prev) = std::fs::read_to_string(&pid_file) {
        // Identity guard: only reap the previous engine if the live process with
        // that PID is provably the same one we spawned (matching OS start-time).
        // A reused PID belonging to an unrelated process is left untouched.
        let recorded = parse_engine_record(&prev);
        let live = recorded
            .as_ref()
            .and_then(|(prev_pid, _)| process_start_time(*prev_pid));
        if let Some(stale_pid) = should_kill_engine(recorded, live.as_deref()) {
            kill_pid_tree(stale_pid);
        }
    }
```

- [ ] **Step 6: Wire the guard into `launch_chromium` (write side).** Replace lines 93-95 of `src-tauri/src/browser_engine.rs`:

```rust
    if let Some(pid) = child.id() {
        let _ = std::fs::write(&pid_file, pid.to_string());
    }
```

with:

```rust
    if let Some(pid) = child.id() {
        let start = process_start_time(pid);
        let _ = std::fs::write(&pid_file, format_engine_record(pid, start.as_deref()));
    }
```

- [ ] **Step 7: Verify build + tests, then commit.** Run:

```
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml browser_engine::tests
```

Expected: clean build, 10 tests pass. Ensure the file stays LF (`git add --renormalize` if needed). Then:

```
git add src-tauri/src/browser_engine.rs
git commit -m "feat(browser): add PID-reuse-safe engine identity guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Rust crash detection — reset CdpState + emit browser-engine-exited

Files:
- Modify `src-tauri/src/browser.rs:238` (add `reset_after_exit` to `impl CdpState`, after `shutdown`)
- Modify `src-tauri/src/browser.rs:249` (add `handle_engine_exit` free fn, after `emit_tabs_changed`)
- Modify `src-tauri/src/browser.rs:284-290` (rewire `handler_task` in `ensure_engine`)
- Test: `#[cfg(test)] mod tests` inside `mod desktop` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing test.** Insert this test module inside `mod desktop`, immediately BEFORE its closing brace at line 1048 (i.e. after `browser_engine_status` ends at line 1047):

```rust

    #[cfg(test)]
    mod tests {
        use super::*;

        #[tokio::test]
        async fn reset_after_exit_clears_in_memory_state() {
            let state = CdpState::new();
            state.tabs.lock().await.push(Tab {
                id: "t1".into(),
                url: "https://example.com".into(),
                title: "Example".into(),
                favicon: String::new(),
            });
            *state.active_tab_id.lock().await = Some("t1".into());
            state.set_pending_nav("t1", PendingNav::Navigate).await;
            *state.screencast_target.lock().await = Some("t1".into());

            state.reset_after_exit().await;

            assert!(state.tabs.lock().await.is_empty());
            assert!(state.active_tab_id.lock().await.is_none());
            assert!(state.pending_nav.lock().await.is_empty());
            assert!(state.pages.lock().await.is_empty());
            assert!(state.browser.lock().await.is_none());
            assert!(state.screencast_target.lock().await.is_none());
        }
    }
```

- [ ] **Step 2: Run the test, expect FAIL.** Run:

```
cargo test --manifest-path src-tauri/Cargo.toml reset_after_exit
```

Expected: compile error `error[E0599]: no method named `reset_after_exit` found for reference `&CdpState``.

- [ ] **Step 3: Implement `reset_after_exit`.** In `src-tauri/src/browser.rs`, add this method to `impl CdpState`, inserting it after the `shutdown` method's closing brace (line 238) and before the `impl` block's closing brace (line 239). Anchor on the tail of `shutdown`:

Replace:

```rust
        *self.screencast_target.lock().await = None;
        *self.frame_channel.lock().await = None;
    }
}
```

with:

```rust
        *self.screencast_target.lock().await = None;
        *self.frame_channel.lock().await = None;
    }

    /// Reset after the engine process exited/disconnected. Called from the handler
    /// task itself, so unlike `shutdown` it does NOT kill a process (it already
    /// exited) and does NOT abort the handler task (we are running inside it). The
    /// next `browser_create`/`ensure_engine` sees `browser == None` and relaunches.
    pub async fn reset_after_exit(&self) {
        if let Some(h) = self.screencast_task.lock().await.take() {
            h.abort();
        }
        {
            let mut ls = self.listeners.lock().await;
            for (_, handles) in ls.drain() {
                for h in handles {
                    h.abort();
                }
            }
        }
        self.pages.lock().await.clear();
        *self.browser.lock().await = None;
        // Drop the (already-dead) Child; kill_on_drop reaps the top process harmlessly.
        *self.child.lock().await = None;
        self.tabs.lock().await.clear();
        *self.active_tab_id.lock().await = None;
        self.pending_nav.lock().await.clear();
        *self.screencast_target.lock().await = None;
        *self.frame_channel.lock().await = None;
    }
}
```

- [ ] **Step 4: Run the reset test, expect PASS.** Run:

```
cargo test --manifest-path src-tauri/Cargo.toml reset_after_exit
```

Expected: `test result: ok. 1 passed`.

- [ ] **Step 5: Add `handle_engine_exit`.** In `src-tauri/src/browser.rs`, insert this free function immediately after the `emit_tabs_changed` function (which ends at line 249). Anchor on `emit_tabs_changed`:

Replace:

```rust
    pub async fn emit_tabs_changed(app: &AppHandle, state: &CdpState) {
        let (tabs, active_tab_id) = state.snapshot().await;
        let _ = app.emit(
            "browser-tabs-changed",
            json!({ "tabs": tabs, "active_tab_id": active_tab_id }),
        );
    }
```

with:

```rust
    pub async fn emit_tabs_changed(app: &AppHandle, state: &CdpState) {
        let (tabs, active_tab_id) = state.snapshot().await;
        let _ = app.emit(
            "browser-tabs-changed",
            json!({ "tabs": tabs, "active_tab_id": active_tab_id }),
        );
    }

    /// Called from the chromiumoxide handler task when the engine disconnects or its
    /// IO loop ends (crash / external kill). Resets CdpState FIRST (so the frontend's
    /// auto-restart sees a clean slate and `ensure_engine` will relaunch), THEN
    /// notifies the UI so it can begin its backoff relaunch.
    async fn handle_engine_exit(app: AppHandle, reason: String) {
        let state = app.state::<CdpState>();
        state.reset_after_exit().await;
        let _ = app.emit("browser-engine-exited", json!({ "reason": reason }));
        emit_tabs_changed(&app, state.inner()).await;
    }
```

- [ ] **Step 6: Rewire the handler task to detect exit.** In `ensure_engine`, replace lines 284-290 of `src-tauri/src/browser.rs`:

```rust
        let handler_task = tokio::spawn(async move {
            while let Some(h) = handler.next().await {
                if h.is_err() {
                    break;
                }
            }
        });
```

with:

```rust
        let app_for_handler = app.clone();
        let handler_task = tokio::spawn(async move {
            let reason = loop {
                match handler.next().await {
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => break format!("CDP handler error: {e}"),
                    None => break "engine disconnected".to_string(),
                }
            };
            // Reached only on real disconnect/error. An intentional shutdown()
            // .abort()s this task before this point, so no spurious event fires.
            handle_engine_exit(app_for_handler, reason).await;
        });
```

- [ ] **Step 7: Verify build + tests, then commit.** Run:

```
cargo build --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml reset_after_exit
```

Expected: clean build (confirms `handle_engine_exit`/handler rewire compile, including `State` being `Send` across the `.await` in the spawned task), reset test passes. Ensure LF. Then:

```
git add src-tauri/src/browser.rs
git commit -m "feat(browser): emit browser-engine-exited and reset CdpState on engine crash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend pure auto-restart backoff policy

Files:
- Create `src/lib/browser/engine-restart.ts`
- Test: Create `src/lib/browser/engine-restart.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/lib/browser/engine-restart.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  nextRestartDelay,
  shouldGiveUp,
  MAX_ENGINE_RESTART_ATTEMPTS,
  ENGINE_RESTART_BASE_DELAY_MS,
  ENGINE_RESTART_MAX_DELAY_MS,
} from './engine-restart'

describe('nextRestartDelay', () => {
  it('starts at the base delay for attempt 0', () => {
    expect(nextRestartDelay(0)).toBe(ENGINE_RESTART_BASE_DELAY_MS)
  })

  it('doubles each attempt (exponential)', () => {
    expect(nextRestartDelay(1)).toBe(ENGINE_RESTART_BASE_DELAY_MS * 2)
    expect(nextRestartDelay(2)).toBe(ENGINE_RESTART_BASE_DELAY_MS * 4)
    expect(nextRestartDelay(3)).toBe(ENGINE_RESTART_BASE_DELAY_MS * 8)
  })

  it('caps at the max delay', () => {
    expect(nextRestartDelay(100)).toBe(ENGINE_RESTART_MAX_DELAY_MS)
  })

  it('treats negative attempts as 0', () => {
    expect(nextRestartDelay(-5)).toBe(ENGINE_RESTART_BASE_DELAY_MS)
  })
})

describe('shouldGiveUp', () => {
  it('keeps retrying below the limit', () => {
    expect(shouldGiveUp(0)).toBe(false)
    expect(shouldGiveUp(MAX_ENGINE_RESTART_ATTEMPTS - 1)).toBe(false)
  })

  it('gives up at and beyond the limit', () => {
    expect(shouldGiveUp(MAX_ENGINE_RESTART_ATTEMPTS)).toBe(true)
    expect(shouldGiveUp(MAX_ENGINE_RESTART_ATTEMPTS + 3)).toBe(true)
  })

  it('honours a custom max', () => {
    expect(shouldGiveUp(2, 2)).toBe(true)
    expect(shouldGiveUp(1, 2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL.** Run:

```
pnpm test:run src/lib/browser/engine-restart.test.ts
```

Expected: `Failed to resolve import "./engine-restart"` (module does not exist yet).

- [ ] **Step 3: Implement the policy module.** Create `src/lib/browser/engine-restart.ts`:

```ts
// Auto-restart policy for the external CDP browser engine. Pure helpers so the
// backoff/give-up decision is unit-testable independently of the React component
// and the Tauri runtime. Consumed by BrowserWebView on `browser-engine-exited`.

/** Max number of automatic relaunch attempts before falling back to the error card. */
export const MAX_ENGINE_RESTART_ATTEMPTS = 5

/** Base delay (ms) for the first retry. */
export const ENGINE_RESTART_BASE_DELAY_MS = 500

/** Hard ceiling (ms) so high attempt counts don't back off into minutes. */
export const ENGINE_RESTART_MAX_DELAY_MS = 10_000

/**
 * Exponential backoff delay for a 0-based attempt index, capped at
 * ENGINE_RESTART_MAX_DELAY_MS. attempt 0 -> 500ms, 1 -> 1000ms, 2 -> 2000ms, ...
 */
export function nextRestartDelay(attempt: number): number {
  const n = attempt < 0 ? 0 : attempt
  const delay = ENGINE_RESTART_BASE_DELAY_MS * 2 ** n
  return Math.min(delay, ENGINE_RESTART_MAX_DELAY_MS)
}

/**
 * Whether the retry budget is exhausted. `attempt` is the number of attempts
 * ALREADY made (0 before the first retry).
 */
export function shouldGiveUp(
  attempt: number,
  max: number = MAX_ENGINE_RESTART_ATTEMPTS,
): boolean {
  return attempt >= max
}
```

- [ ] **Step 4: Run the test, expect PASS.** Run:

```
pnpm test:run src/lib/browser/engine-restart.test.ts
```

Expected: all tests pass (`Test Files 1 passed`).

- [ ] **Step 5: Commit.** Ensure both files are LF, then:

```
git add src/lib/browser/engine-restart.ts src/lib/browser/engine-restart.test.ts
git commit -m "feat(browser): add pure engine auto-restart backoff policy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend auto-restart wiring + restarting indicator + i18n

Files:
- Modify `src/stores/browser.ts:23` (add `engineRestarting`/`engineRestartFailed` to interface)
- Modify `src/stores/browser.ts:103` (add their state + setters)
- Modify `src/app/core/main/browser/browser-webview.tsx` (full rewrite of the event-hub component)
- Modify `messages/en.json:2134`, `messages/zh.json:2077`, `messages/zh-TW.json:2170`, `messages/ja.json:2111`, `messages/pt-BR.json:2165` (add `browser.engine` keys)
- Verification: `pnpm lint` + manual kill test (Tauri shell)

- [ ] **Step 1: Add store fields (interface).** In `src/stores/browser.ts`, replace lines 22-23:

```ts
  browserReady: boolean
  setBrowserReady: (ready: boolean) => void
```

with:

```ts
  browserReady: boolean
  setBrowserReady: (ready: boolean) => void

  // M2: 引擎崩潰自動重啟狀態。engineRestarting=true → 顯示「重啟中」指示；
  // 重試上限後 engineRestartFailed=true → 落回 M1 的引擎錯誤狀態卡。
  engineRestarting: boolean
  setEngineRestarting: (restarting: boolean) => void
  engineRestartFailed: boolean
  setEngineRestartFailed: (failed: boolean) => void
```

- [ ] **Step 2: Add store fields (implementation).** In `src/stores/browser.ts`, replace lines 102-103:

```ts
  browserReady: false,
  setBrowserReady: (browserReady) => set({ browserReady }),
```

with:

```ts
  browserReady: false,
  setBrowserReady: (browserReady) => set({ browserReady }),

  engineRestarting: false,
  setEngineRestarting: (engineRestarting) => set({ engineRestarting }),
  engineRestartFailed: false,
  setEngineRestartFailed: (engineRestartFailed) => set({ engineRestartFailed }),
```

- [ ] **Step 3: Rewrite the event-hub component.** Overwrite `src/app/core/main/browser/browser-webview.tsx` with the complete file below (preserves every existing listener; adds `createEngine`, `scheduleRestart`, the `browser-engine-exited` listener, timer cleanup, and the restarting/failed overlays):

```tsx
'use client'

import { useEffect, useRef, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useTranslations } from 'next-intl'
import useBrowserStore from '@/stores/browser'
import useSettingStore from '@/stores/setting'
import useBrowserChatStore from '@/stores/browser-chat'
import emitter from '@/lib/emitter'
import { BrowserScreencast } from './browser-screencast'
import { nextRestartDelay, shouldGiveUp } from '@/lib/browser/engine-restart'

// The browser runs as an EXTERNAL CloakBrowser Chromium (headless), streamed into
// <BrowserScreencast> via CDP. This component is the EVENT HUB: it creates the
// engine, listens to all `browser-*` events, bridges page content into the AI chat,
// and (M2) auto-restarts the engine with exponential backoff when it crashes.
export function BrowserWebView() {
  // StrictMode-safe lock: prevents init() from running twice when React 18
  // double-invokes the mount effect in development.
  const initStartedRef = useRef(false)
  // M2: 崩潰自動重啟的退避狀態。restartAttemptRef 記錄已嘗試次數；restartTimerRef
  // 持有 pending 的 setTimeout，unmount 時清除。
  const restartAttemptRef = useRef(0)
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const {
    setBrowserReady,
    setBrowserUrl,
    setBrowserTitle,
    setBrowserLoading,
    setBrowserFavicon,
    applyNavEvent,
    setDevtoolsOpen,
    setZoomLevel,
    incrementDownloadCount,
    decrementDownloadCount,
    engineRestarting,
    setEngineRestarting,
    engineRestartFailed,
    setEngineRestartFailed,
  } = useBrowserStore()
  const { browserHomepage } = useSettingStore()
  const t = useTranslations('browser.contextMenu')
  const tEngine = useTranslations('browser.engine')
  // M1: 區分 auto-extract（page load 觸發，寫進 currentPageContext）和 manual extract
  // （user 按按鈕，當 quote 進 chat-input）。
  const pendingAutoExtractRef = useRef(false)
  // M1: debounce 用，避免頁面 loading=false 後 SPA 再渲染又重抓
  const autoExtractTimerRef = useRef<NodeJS.Timeout | null>(null)

  const injectContextMenu = useCallback(async () => {
    try {
      await invoke('browser_inject_context_menu', {
        labels: {
          back: t('back'),
          forward: t('forward'),
          reload: t('reload'),
          copy: t('copy'),
          paste: t('paste'),
          selectAll: t('selectAll'),
          quote: t('quoteToChat'),
          translate: t('translate'),
          screenshot: t('screenshotToAI'),
          bookmark: t('addBookmark'),
          print: t('print'),
          devTools: t('devTools'),
        }
      })
    } catch {
      // engine may not be ready yet
    }
  }, [t])

  // M2: 建立（或重建）引擎。回傳是否成功，讓呼叫端決定要不要排程重試。
  const createEngine = useCallback(async (): Promise<boolean> => {
    try {
      // Headless: x/y are ignored; width/height seed the initial viewport until
      // <BrowserScreencast>'s ResizeObserver corrects it via browser_set_viewport.
      await invoke('browser_create', {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
        url: browserHomepage,
      })
      setBrowserReady(true)
      await injectContextMenu()
      return true
    } catch (error) {
      console.error('[Browser] Failed to create engine:', error)
      return false
    }
  }, [browserHomepage, injectContextMenu, setBrowserReady])

  // M2: 以指數退避排程引擎重建；超過上限則落回錯誤狀態卡（M1）。
  const scheduleRestart = useCallback(() => {
    const attempt = restartAttemptRef.current
    if (shouldGiveUp(attempt)) {
      setEngineRestarting(false)
      setEngineRestartFailed(true)
      return
    }
    setEngineRestarting(true)
    restartAttemptRef.current = attempt + 1
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
    restartTimerRef.current = setTimeout(() => {
      // 重置 StrictMode/remount 守門員，讓全新引擎得以建立。
      initStartedRef.current = false
      void createEngine().then((ok) => {
        if (ok) {
          restartAttemptRef.current = 0
          setEngineRestarting(false)
          setEngineRestartFailed(false)
        } else {
          scheduleRestart()
        }
      })
    }, nextRestartDelay(attempt))
  }, [createEngine, setEngineRestarting, setEngineRestartFailed])

  useEffect(() => {
    async function init() {
      // 兩層守門員：initStartedRef 擋同一 instance 的 StrictMode 二次呼叫；
      // browserReady（Zustand，跨 mount 保留）擋切回 notes 再切回 browser 的 remount。
      if (initStartedRef.current) return
      initStartedRef.current = true
      if (useBrowserStore.getState().browserReady) return
      const ok = await createEngine()
      if (!ok) scheduleRestart()
    }

    init()

    // Listen for browser events
    const window = getCurrentWindow()
    const listeners = [
      window.listen<{ url: string }>('browser-url-changed', (event) => {
        setBrowserUrl(event.payload.url)
        // M1: URL 變了，舊頁的 extracted context 不再 valid — 立刻清，等 loading=false 後重新 extract
        useBrowserChatStore.getState().setCurrentPageContext(null)
        // R1: 把新 URL 鏡像到當前 active tab 的 metadata。
        const activeId = useBrowserStore.getState().activeTabId
        if (activeId) {
          invoke('browser_tabs_update_meta', { tabId: activeId, url: event.payload.url }).catch(() => {})
        }
      }),
      window.listen<{ title: string }>('browser-title-changed', (event) => {
        setBrowserTitle(event.payload.title)
        const activeId = useBrowserStore.getState().activeTabId
        if (activeId) {
          invoke('browser_tabs_update_meta', { tabId: activeId, title: event.payload.title }).catch(() => {})
        }
      }),
      window.listen<{ loading: boolean }>('browser-loading', (event) => {
        setBrowserLoading(event.payload.loading)
        // M1: 頁面載入完成後 1.5s（讓 SPA 後續渲染穩定）→ 自動抽 text 寫進 currentPageContext
        if (!event.payload.loading) {
          // R6: 新頁面 zoom 會重設，立刻把使用者選的 zoom 套回去（若非預設 1.0）。
          const currentZoom = useBrowserStore.getState().zoomLevel
          if (currentZoom !== 1.0) {
            invoke('browser_set_zoom', { level: currentZoom }).catch(() => {})
          }
          if (autoExtractTimerRef.current) clearTimeout(autoExtractTimerRef.current)
          autoExtractTimerRef.current = setTimeout(() => {
            pendingAutoExtractRef.current = true
            invoke('browser_extract_text').catch((err) => {
              console.warn('[Browser] auto-extract failed:', err)
              pendingAutoExtractRef.current = false
            })
          }, 1500)
        }
      }),
      window.listen<{ favicon: string }>('browser-favicon-changed', (event) => {
        setBrowserFavicon(event.payload.favicon)
        const activeId = useBrowserStore.getState().activeTabId
        if (activeId) {
          invoke('browser_tabs_update_meta', { tabId: activeId, favicon: event.payload.favicon }).catch(() => {})
        }
      }),
      // R5: 上下頁狀態。每個 page-load Finished Rust 端會 emit 此 event。
      window.listen<{ kind: 'navigate' | 'back' | 'forward' | 'reload' }>('browser-nav-event', (event) => {
        applyNavEvent(event.payload.kind)
      }),
      // R8: DevTools 開關狀態。Rust toggle 後 emit。
      window.listen<{ open: boolean }>('browser-devtools-state', (event) => {
        setDevtoolsOpen(event.payload.open)
      }),
      // R6: zoom 層級。
      window.listen<{ level: number }>('browser-zoom-changed', (event) => {
        setZoomLevel(event.payload.level)
      }),
      // R2: 下載事件。
      window.listen<{ url: string; filename: string; destination: string }>('browser-download-started', async (event) => {
        const { url, filename, destination } = event.payload
        try {
          const { insertDownloadStarted } = await import('@/db/downloads')
          await insertDownloadStarted(url, filename, destination)
          incrementDownloadCount()
        } catch (e) {
          console.error('[Browser] download started insert failed:', e)
        }
      }),
      window.listen<{ url: string; path: string | null; success: boolean }>('browser-download-finished', async (event) => {
        const { url, path, success } = event.payload
        try {
          const { markDownloadFinished } = await import('@/db/downloads')
          await markDownloadFinished(url, path, success)
          decrementDownloadCount()
        } catch (e) {
          console.error('[Browser] download finished update failed:', e)
        }
      }),
      // Extracted text from browser_extract_text
      window.listen<{ text: string; title: string; url: string }>('browser-content-extracted', (event) => {
        const { text, title, url } = event.payload
        if (!text) return
        // M1: auto-extract 走 currentPageContext；manual extract 走 quote 流程
        if (pendingAutoExtractRef.current) {
          pendingAutoExtractRef.current = false
          const browserState = useBrowserStore.getState()
          useBrowserChatStore.getState().setCurrentPageContext({
            url: url || browserState.browserUrl,
            title: title || browserState.browserTitle || url || browserState.browserUrl,
            content: text,
          })
        } else {
          emitter.emit('browser-quote-text' as any, { text, url, title })
        }
      }),
      // Context menu actions
      window.listen<{ action: string; text: string; url: string; title: string }>('browser-context-action', (event) => {
        const { action, text, url, title } = event.payload
        switch (action) {
          case 'quote':
            emitter.emit('browser-quote-text' as any, { text, url, title })
            break
          case 'screenshot':
            invoke<string>('browser_capture').then((path) => {
              emitter.emit('browser-screenshot' as any, { path })
            }).catch((err) => console.error('[Browser] Screenshot failed:', err))
            break
          case 'bookmark':
            emitter.emit('browser-add-bookmark' as any, { url, title })
            break
          case 'translate':
            emitter.emit('browser-translate-text' as any, { text })
            break
          case 'devtools':
            invoke('browser_toggle_devtools').catch((err: unknown) => console.error('[Browser] DevTools toggle failed:', err))
            break
        }
      }),
      // M2: 引擎崩潰/斷線。Rust 已重置 CdpState；前端重置守門員 + navState，
      // 重置 attempt 計數，啟動退避重啟。
      window.listen<{ reason: string }>('browser-engine-exited', () => {
        setBrowserReady(false)
        useBrowserStore.getState().resetNavState()
        initStartedRef.current = false
        restartAttemptRef.current = 0
        setEngineRestartFailed(false)
        scheduleRestart()
      }),
    ]

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current)
      listeners.forEach(async (listener) => {
        const unlisten = await listener
        unlisten()
      })
    }
  }, [])

  return (
    <div className="relative flex flex-1 w-full overflow-hidden">
      <BrowserScreencast />
      {engineRestarting && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-3 py-1.5 text-sm text-white">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
          {tEngine('restarting')}
        </div>
      )}
      {engineRestartFailed && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95 p-6 text-center">
          <p className="text-sm text-muted-foreground">{tEngine('restartFailed')}</p>
          <button
            type="button"
            onClick={() => {
              restartAttemptRef.current = 0
              setEngineRestartFailed(false)
              void createEngine().then((ok) => {
                if (!ok) scheduleRestart()
              })
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
          >
            {tEngine('retry')}
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add i18n keys to all 5 locales.** Insert a `browser.engine` block before the `newTab` key in each file (the `"newTab"` line is unique per file).

In `messages/en.json` replace `    "newTab": "New tab",` with:

```json
    "engine": {
      "restarting": "Browser engine restarting…",
      "restartFailed": "Browser engine stopped and could not be restarted.",
      "retry": "Retry"
    },
    "newTab": "New tab",
```

In `messages/zh.json` replace `    "newTab": "新分页",` with:

```json
    "engine": {
      "restarting": "浏览器引擎重启中…",
      "restartFailed": "浏览器引擎已停止且无法重新启动。",
      "retry": "重试"
    },
    "newTab": "新分页",
```

In `messages/zh-TW.json` replace `    "newTab": "新分頁",` with:

```json
    "engine": {
      "restarting": "瀏覽器引擎重新啟動中…",
      "restartFailed": "瀏覽器引擎已停止且無法重新啟動。",
      "retry": "重試"
    },
    "newTab": "新分頁",
```

In `messages/ja.json` replace `    "newTab": "新規タブ",` with:

```json
    "engine": {
      "restarting": "ブラウザエンジンを再起動しています…",
      "restartFailed": "ブラウザエンジンが停止し、再起動できませんでした。",
      "retry": "再試行"
    },
    "newTab": "新規タブ",
```

In `messages/pt-BR.json` replace `    "newTab": "Nova aba",` with:

```json
    "engine": {
      "restarting": "Reiniciando o mecanismo do navegador…",
      "restartFailed": "O mecanismo do navegador parou e não pôde ser reiniciado.",
      "retry": "Tentar novamente"
    },
    "newTab": "Nova aba",
```

- [ ] **Step 5: Verify lint + existing tests.** Run:

```
pnpm lint
pnpm test:run
```

Expected: lint passes (note `react-hooks/exhaustive-deps` is `off` in `eslint.config.mjs:29`, so the `[]`-dep effect referencing `createEngine`/`scheduleRestart` is fine); all unit tests pass including the new `engine-restart.test.ts`. Confirm all 5 JSON files parse (lint will fail on malformed JSON via the build/test step; if needed run `node -e "require('./messages/zh-TW.json')"` per file).

- [ ] **Step 6: Manual integration verification (Tauri shell).** With a working engine (Task 1/2 built), run `pnpm tauri dev`, open the browser panel, then from a terminal kill the external CloakBrowser process tree (Windows: `taskkill /IM chrome.exe /T /F` targeting the headless engine PID; cross-check the PID in `<app_data>/cloakbrowser/profile/engine.pid`). Confirm: (a) an amber "restarting" banner appears at the top of the canvas, (b) within a few seconds the page reloads and is interactive again, (c) the canvas is NOT frozen on the last frame, (d) no App restart was needed. To exercise the give-up path, point the engine path at an invalid location (M1 Settings BYO) before killing, and confirm after 5 attempts the failed card with a Retry button appears.

- [ ] **Step 7: Commit.** Ensure all touched files are LF (`git add --renormalize` on the JSON + tsx if Windows introduced CRLF), then:

```
git add src/stores/browser.ts src/app/core/main/browser/browser-webview.tsx messages/en.json messages/zh.json messages/zh-TW.json messages/ja.json messages/pt-BR.json
git commit -m "feat(browser): auto-restart CDP engine with backoff and restarting UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Assumptions & notes for this milestone:**
> - Rust pure fns added to existing browser_engine.rs (not new files): format_engine_record / parse_engine_record / should_kill_engine (PID-reuse identity guard) + cfg-split process_start_time (Windows GetProcessTimes via the already-present `windows` crate w/ Win32_System_Threading+Win32_Foundation features; Linux /proc/<pid>/stat field 22; macOS `ps -o lstart=`). All verified against installed windows-0.58 source: OpenProcess/GetProcessTimes/CloseHandle are generic over P0 (pass FALSE and HANDLE directly), FILETIME has dwLowDateTime/dwHighDateTime + Default.
> - engine.pid file format changes from single-line `<pid>` to two-line `<pid>\n<start_time>`; parse_engine_record stays backward-compatible with legacy single-line files (treated as identity-unknown -> preserves old always-kill zombie-reaping behavior).
> - M2 reset ordering is load-bearing: handle_engine_exit calls reset_after_exit() BEFORE emit(browser-engine-exited), so by the time the frontend hears the event and calls browser_create, CdpState.browser is already None and ensure_engine will relaunch cleanly.
> - reset_after_exit (new on CdpState) deliberately does NOT abort handler_task (it runs inside that task) and does NOT kill_pid_tree (the engine already exited); intentional shutdown() still aborts handler_task before the exit branch, so no spurious browser-engine-exited fires on browser_clear_data.
> - STORE CONTRACT for cross-milestone consistency: M2 ADDS store fields engineRestarting + setEngineRestarting and engineRestartFailed + setEngineRestartFailed to src/stores/browser.ts. M1's empty/error-state card should read engineRestartFailed to render its richer error UX (M2 ships a minimal inline failed banner + Retry as a self-contained fallback that M1 supersedes). These are zustand store fields, not commands/events, so they are not in introduces/consumes.
> - Security note: M2 does NOT touch the --remote-allow-origins=* arg in launch_chromium; that origin-tightening is a separate (security) milestone per the spec, even though it lives in the same function.
> - Did NOT add browser-engine-exited to e2e/tauri-mock.ts — that mock update belongs to M6 (test scaffold).
> - BrowserWebView return changed from bare <BrowserScreencast/> to a `relative flex flex-1 w-full overflow-hidden` wrapper so the absolutely-positioned overlays have a positioned ancestor while preserving BrowserScreencast's flex-1 sizing.


---

## Milestone 3: Input correctness — IME + clipboard

**Goal:** Make the headless CDP browser usable for the Traditional-Chinese user: host the OS IME composition in a hidden focusable proxy and commit the whole composed string through a new `browser_input_text` (CDP `Input.insertText`), and bridge copy/paste two-way (engine selection → OS clipboard via Ctrl+C; OS clipboard → engine via Ctrl+V) instead of forwarding raw Ctrl+C/Ctrl+V keys to the page.

---

### Task 1: Rust `browser_input_text` command (desktop impl + mobile stub + registration)

**Files:**
- Modify `src-tauri/src/browser.rs:33` (add `InsertTextParams` to the `input` import)
- Modify `src-tauri/src/browser.rs:723` (insert helper + desktop command after `browser_input_key`)
- Modify `src-tauri/src/browser.rs:1047` (add `#[cfg(test)] mod tests` before the desktop module close at line 1048)
- Modify `src-tauri/src/browser.rs:1315` (insert mobile stub after the mobile `browser_input_key`)
- Modify `src-tauri/src/lib.rs:31` and `src-tauri/src/lib.rs:99`
- Modify `src-tauri/src/main.rs:43` and `src-tauri/src/main.rs:133`
- Test: `#[cfg(test)] mod tests` inside `mod desktop` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing test.** Add this test module immediately before the closing `}` of `mod desktop` (the `}` on `src-tauri/src/browser.rs:1048`). Anchor the Edit on the tail of `browser_engine_status`:

  Replace:
  ```rust
            Err(_) => Ok(EngineStatus {
                installed: false,
                source: "none".to_string(),
                exe_path: None,
            }),
        }
    }
}
  ```
  with:
  ```rust
            Err(_) => Ok(EngineStatus {
                installed: false,
                source: "none".to_string(),
                exe_path: None,
            }),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{insert_text_params, InsertTextParams};

        #[test]
        fn insert_text_params_preserves_text_verbatim() {
            // IME commit / paste must round-trip exactly: no trim, keep spaces + CJK.
            let p = insert_text_params("  測試 a b  ".to_string());
            assert_eq!(p.text, "  測試 a b  ");
        }

        #[test]
        fn insert_text_params_targets_input_insert_text() {
            // Pin the CDP method so a refactor can't silently switch off insertText.
            assert_eq!(InsertTextParams::IDENTIFIER, "Input.insertText");
        }
    }
}
  ```

- [ ] **Step 2: Run the test, expect FAIL.**
  ```
  cargo test --manifest-path src-tauri/Cargo.toml insert_text_params
  ```
  Expected failure: a compile error `error[E0432]: unresolved import ... insert_text_params` / `cannot find function \`insert_text_params\` in module \`super\`` (the helper does not exist yet) and `InsertTextParams` not in scope.

- [ ] **Step 3: Add the `InsertTextParams` import.** Edit `src-tauri/src/browser.rs:33`. Replace:
  ```rust
    use chromiumoxide::cdp::browser_protocol::input::{
        DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams,
        DispatchMouseEventType, MouseButton,
    };
  ```
  with:
  ```rust
    use chromiumoxide::cdp::browser_protocol::input::{
        DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams,
        DispatchMouseEventType, InsertTextParams, MouseButton,
    };
  ```

- [ ] **Step 4: Implement the helper + desktop command.** Insert directly after the end of `browser_input_key` (the function closing at `src-tauri/src/browser.rs:723`), before `browser_clear_data`. Anchor the Edit on the boundary between the two functions. Replace:
  ```rust
        let params = builder.build().map_err(|e| format!("key event build: {e}"))?;
        page.execute(params)
            .await
            .map_err(|e| e.to_string())
            .map(|_| ())
    }

    #[tauri::command]
    pub async fn browser_clear_data(
  ```
  with:
  ```rust
        let params = builder.build().map_err(|e| format!("key event build: {e}"))?;
        page.execute(params)
            .await
            .map_err(|e| e.to_string())
            .map(|_| ())
    }

    // Build the CDP Input.insertText payload. Extracted so the verbatim
    // pass-through (no trimming) can be unit-tested without a live engine.
    fn insert_text_params(text: String) -> InsertTextParams {
        InsertTextParams::new(text)
    }

    // Inserts text that does not come from a key press (IME commit, clipboard
    // paste). Ordinary printable keystrokes stay on the DispatchKeyEvent path.
    #[tauri::command]
    pub async fn browser_input_text(
        state: tauri::State<'_, CdpState>,
        text: String,
    ) -> Result<(), String> {
        let page = state.active_page().await.ok_or("No active tab")?;
        page.execute(insert_text_params(text))
            .await
            .map_err(|e| e.to_string())
            .map(|_| ())
    }

    #[tauri::command]
    pub async fn browser_clear_data(
  ```

- [ ] **Step 5: Add the mobile stub.** Keep the command surface identical on iOS/Android. Insert after the mobile `browser_input_key` (closing at `src-tauri/src/browser.rs:1315`). Replace:
  ```rust
    #[tauri::command]
    pub async fn browser_input_key(
        _state: S<'_>,
        _kind: String,
        _key: String,
        _code: String,
        _windows_virtual_key_code: i64,
        _text: Option<String>,
        _modifiers: i64,
        _location: Option<i64>,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    #[tauri::command]
    pub async fn browser_engine_set_path(
  ```
  with:
  ```rust
    #[tauri::command]
    pub async fn browser_input_key(
        _state: S<'_>,
        _kind: String,
        _key: String,
        _code: String,
        _windows_virtual_key_code: i64,
        _text: Option<String>,
        _modifiers: i64,
        _location: Option<i64>,
    ) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    #[tauri::command]
    pub async fn browser_input_text(_state: S<'_>, _text: String) -> Result<(), String> {
        Err(UNSUPPORTED.into())
    }

    #[tauri::command]
    pub async fn browser_engine_set_path(
  ```

- [ ] **Step 6: Register the command in `lib.rs`.** Edit `src-tauri/src/lib.rs:31`, replace:
  ```rust
    browser_input_mouse, browser_input_wheel, browser_input_key,
  ```
  with:
  ```rust
    browser_input_mouse, browser_input_wheel, browser_input_key, browser_input_text,
  ```
  Then edit `src-tauri/src/lib.rs:99`, replace:
  ```rust
            browser_input_key,
  ```
  with:
  ```rust
            browser_input_key,
            browser_input_text,
  ```

- [ ] **Step 7: Register the command in `main.rs`.** Edit `src-tauri/src/main.rs:43`, replace:
  ```rust
    browser_input_mouse, browser_input_wheel, browser_input_key,
  ```
  with:
  ```rust
    browser_input_mouse, browser_input_wheel, browser_input_key, browser_input_text,
  ```
  Then edit `src-tauri/src/main.rs:133`, replace:
  ```rust
            browser_input_key,
  ```
  with:
  ```rust
            browser_input_key,
            browser_input_text,
  ```

- [ ] **Step 8: Run the test, expect PASS.**
  ```
  cargo test --manifest-path src-tauri/Cargo.toml insert_text_params
  ```
  Expected: `test desktop::tests::insert_text_params_preserves_text_verbatim ... ok` and `test desktop::tests::insert_text_params_targets_input_insert_text ... ok`. Then confirm the whole crate still builds:
  ```
  cargo build --manifest-path src-tauri/Cargo.toml
  ```
  Expected: `Finished` with no errors.

- [ ] **Step 9: Verify LF and commit.** Ensure the edited Rust files are LF (no CRLF) before committing.
  ```
  git add src-tauri/src/browser.rs src-tauri/src/lib.rs src-tauri/src/main.rs
  git commit -m "feat(browser): add browser_input_text (CDP Input.insertText) command

Introduces the Rust command for IME commit and clipboard paste; registers it
in both invoke handlers and keeps the mobile stub surface identical.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 2: Pure keydown router helper (`key-routing.ts`)

**Files:**
- Create `src/lib/browser/key-routing.ts`
- Test: `src/lib/browser/key-routing.test.ts`

This pure function is the heart of M3 correctness: it decides whether a keydown is an IME-suppressed key (do not forward), a copy, a paste, or a normal key to forward to CDP.

- [ ] **Step 1: Write the failing test.** Create `src/lib/browser/key-routing.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { classifyKeyDown } from './key-routing'

  // Minimal event-shape factory matching what classifyKeyDown reads.
  const ev = (
    key: string,
    mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
  ) => ({
    key,
    ctrlKey: !!mods.ctrlKey,
    metaKey: !!mods.metaKey,
    altKey: !!mods.altKey,
    shiftKey: !!mods.shiftKey,
  })

  describe('classifyKeyDown', () => {
    it('ignores every key while composing (so IME half-formed chars never forward)', () => {
      expect(classifyKeyDown(ev('a'), { composing: true })).toBe('ignore')
      expect(classifyKeyDown(ev('c', { ctrlKey: true }), { composing: true })).toBe('ignore')
      expect(classifyKeyDown(ev('Enter'), { composing: true })).toBe('ignore')
    })

    it('routes Ctrl+C and Cmd+C to copy', () => {
      expect(classifyKeyDown(ev('c', { ctrlKey: true }), { composing: false })).toBe('copy')
      expect(classifyKeyDown(ev('C', { ctrlKey: true }), { composing: false })).toBe('copy')
      expect(classifyKeyDown(ev('c', { metaKey: true }), { composing: false })).toBe('copy')
    })

    it('routes Ctrl+V and Cmd+V to paste', () => {
      expect(classifyKeyDown(ev('v', { ctrlKey: true }), { composing: false })).toBe('paste')
      expect(classifyKeyDown(ev('v', { metaKey: true }), { composing: false })).toBe('paste')
    })

    it('forwards plain printable and non-copy/paste accelerators to the page', () => {
      expect(classifyKeyDown(ev('a'), { composing: false })).toBe('forward')
      expect(classifyKeyDown(ev('a', { ctrlKey: true }), { composing: false })).toBe('forward') // select-all stays in page
      expect(classifyKeyDown(ev('Enter'), { composing: false })).toBe('forward')
    })

    it('does not hijack Ctrl+Shift+C / Ctrl+Alt+V (leaves them as forward)', () => {
      expect(classifyKeyDown(ev('c', { ctrlKey: true, shiftKey: true }), { composing: false })).toBe('forward')
      expect(classifyKeyDown(ev('v', { ctrlKey: true, altKey: true }), { composing: false })).toBe('forward')
    })
  })
  ```

- [ ] **Step 2: Run the test, expect FAIL.**
  ```
  pnpm test:run src/lib/browser/key-routing.test.ts
  ```
  Expected failure: `Failed to resolve import "./key-routing"` (module does not exist yet), so the suite errors out before any assertion runs.

- [ ] **Step 3: Implement the helper.** Create `src/lib/browser/key-routing.ts`:
  ```ts
  // Pure routing for the browser canvas keydown. The host intercepts copy/paste
  // (handled via the OS clipboard + CDP) and suppresses ALL keys during IME
  // composition; everything else is forwarded to the headless page.

  export type KeyAction = 'copy' | 'paste' | 'forward' | 'ignore'

  export interface KeyContext {
    /** True while an OS IME composition is in progress. */
    composing: boolean
  }

  export interface KeyLike {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    shiftKey: boolean
  }

  export function classifyKeyDown(e: KeyLike, ctx: KeyContext): KeyAction {
    // While composing, never forward raw keys (avoids half-formed CJK chars).
    if (ctx.composing) return 'ignore'

    const accel = e.ctrlKey || e.metaKey
    // Only the bare accelerator (no Shift/Alt) maps to our clipboard bridge.
    if (accel && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase()
      if (k === 'c') return 'copy'
      if (k === 'v') return 'paste'
    }
    return 'forward'
  }
  ```

- [ ] **Step 4: Run the test, expect PASS.**
  ```
  pnpm test:run src/lib/browser/key-routing.test.ts
  ```
  Expected: all 5 tests pass (`Test Files 1 passed`, `Tests 5 passed`).

- [ ] **Step 5: Verify LF and commit.** Confirm both new files are LF.
  ```
  git add src/lib/browser/key-routing.ts src/lib/browser/key-routing.test.ts
  git commit -m "feat(browser): add pure keydown router for IME suppression + copy/paste

Classifies a canvas keydown into copy/paste/forward/ignore so composition
keys are never forwarded and Ctrl/Cmd+C/V go through the clipboard bridge.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

### Task 3: Wire IME proxy + two-way clipboard bridge into `browser-screencast.tsx`

**Files:**
- Modify `src/app/core/main/browser/browser-screencast.tsx:3` (imports)
- Modify `src/app/core/main/browser/browser-screencast.tsx:43` (refs)
- Modify `src/app/core/main/browser/browser-screencast.tsx:160` (focus the IME proxy at the click point)
- Modify `src/app/core/main/browser/browser-screencast.tsx:224` (replace `onKeyDown`/`onKeyUp`; add copy/paste/compositionEnd)
- Modify `src/app/core/main/browser/browser-screencast.tsx:255` (JSX: move key handlers to the hidden textarea, add the textarea)
- Test: integration of DOM composition + Tauri `invoke` + OS clipboard cannot be unit-tested in jsdom; verification is `pnpm lint` + `pnpm exec tsc --noEmit` + the Task 2 unit test (covers the routing logic) + the manual checklist in Step 7.

- [ ] **Step 1: Add imports.** Replace `src/app/core/main/browser/browser-screencast.tsx:3-6`:
  ```tsx
  import { useEffect, useRef } from 'react'
  import { invoke, Channel } from '@tauri-apps/api/core'
  import { useTranslations } from 'next-intl'
  import useBrowserStore from '@/stores/browser'
  ```
  with:
  ```tsx
  import { useEffect, useRef } from 'react'
  import { invoke, Channel } from '@tauri-apps/api/core'
  import { readText, writeText } from 'tauri-plugin-clipboard-api'
  import { useTranslations } from 'next-intl'
  import useBrowserStore from '@/stores/browser'
  import { classifyKeyDown } from '@/lib/browser/key-routing'
  ```

- [ ] **Step 2: Add the IME refs.** Replace `src/app/core/main/browser/browser-screencast.tsx:41-43`:
  ```tsx
    // rAF-coalesced pointer move
    const pendingMoveRef = useRef<{ x: number; y: number; buttons: number; modifiers: number } | null>(null)
    const rafRef = useRef<number | null>(null)
  ```
  with:
  ```tsx
    // rAF-coalesced pointer move
    const pendingMoveRef = useRef<{ x: number; y: number; buttons: number; modifiers: number } | null>(null)
    const rafRef = useRef<number | null>(null)
    // Visually-hidden textarea that hosts the OS IME composition so the candidate
    // window has a DOM anchor; we never forward raw keys while composing.
    const imeRef = useRef<HTMLTextAreaElement>(null)
    const composingRef = useRef(false)
  ```

- [ ] **Step 3: Focus the IME proxy at the click point.** Replace `src/app/core/main/browser/browser-screencast.tsx:160-163`:
  ```tsx
    const onPointerDown = (e: React.PointerEvent) => {
      wrapRef.current?.focus()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const { x, y } = coords(e.clientX, e.clientY)
  ```
  with:
  ```tsx
    const onPointerDown = (e: React.PointerEvent) => {
      const { x, y } = coords(e.clientX, e.clientY)
      // Park the hidden IME proxy at the click point so the OS candidate window
      // anchors near where the user is typing, then focus it to receive keys.
      const ime = imeRef.current
      if (ime) {
        ime.style.left = `${x}px`
        ime.style.top = `${y}px`
        ime.focus()
      }
      e.currentTarget.setPointerCapture?.(e.pointerId)
  ```

- [ ] **Step 4: Replace key handlers with copy/paste + composition logic.** Replace `src/app/core/main/browser/browser-screencast.tsx:224-249`:
  ```tsx
    const onKeyDown = (e: React.KeyboardEvent) => {
      e.preventDefault()
      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey
      invoke('browser_input_key', {
        kind: 'down',
        key: e.key,
        code: e.code,
        windowsVirtualKeyCode: e.keyCode,
        text: printable ? e.key : null,
        modifiers: mods(e),
        location: e.location,
      }).catch(() => {})
    }

    const onKeyUp = (e: React.KeyboardEvent) => {
      e.preventDefault()
      invoke('browser_input_key', {
        kind: 'up',
        key: e.key,
        code: e.code,
        windowsVirtualKeyCode: e.keyCode,
        text: null,
        modifiers: mods(e),
        location: e.location,
      }).catch(() => {})
    }
  ```
  with:
  ```tsx
    // Copy: pull the engine-side selection and write it to the OS clipboard.
    const handleCopy = async () => {
      try {
        const text = await invoke<string>('browser_get_selected_text')
        if (text) await writeText(text)
      } catch (err) {
        console.error('[browser] copy failed:', err)
      }
    }

    // Paste: read the OS clipboard and inject it via CDP Input.insertText.
    const handlePaste = async () => {
      try {
        const text = await readText()
        if (text) await invoke('browser_input_text', { text })
      } catch (err) {
        console.error('[browser] paste failed:', err)
      }
    }

    // IME committed: send the whole composed string at once, then clear the proxy.
    const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      composingRef.current = false
      const composed = e.data
      e.currentTarget.value = ''
      if (composed) {
        invoke('browser_input_text', { text: composed }).catch(() => {})
      }
    }

    const onKeyDown = (e: React.KeyboardEvent) => {
      const composing = composingRef.current || e.nativeEvent.isComposing
      const action = classifyKeyDown(e, { composing })
      if (action === 'ignore') {
        // Composition in progress: let the proxy host it; never forward raw keys
        // and do NOT preventDefault (that would break the OS IME).
        return
      }
      e.preventDefault()
      if (action === 'copy') {
        void handleCopy()
        return
      }
      if (action === 'paste') {
        void handlePaste()
        return
      }
      const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey
      invoke('browser_input_key', {
        kind: 'down',
        key: e.key,
        code: e.code,
        windowsVirtualKeyCode: e.keyCode,
        text: printable ? e.key : null,
        modifiers: mods(e),
        location: e.location,
      }).catch(() => {})
    }

    const onKeyUp = (e: React.KeyboardEvent) => {
      if (composingRef.current || e.nativeEvent.isComposing) return
      e.preventDefault()
      invoke('browser_input_key', {
        kind: 'up',
        key: e.key,
        code: e.code,
        windowsVirtualKeyCode: e.keyCode,
        text: null,
        modifiers: mods(e),
        location: e.location,
      }).catch(() => {})
    }
  ```

- [ ] **Step 5: Move key handlers onto the hidden textarea + render it.** Replace `src/app/core/main/browser/browser-screencast.tsx:255-274`:
  ```tsx
    return (
      <div
        ref={wrapRef}
        tabIndex={0}
        className="relative flex-1 w-full overflow-hidden bg-white outline-none dark:bg-zinc-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {browserLoading && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {t('loading')}
          </div>
        )}
      </div>
    )
  ```
  with:
  ```tsx
    return (
      <div
        ref={wrapRef}
        tabIndex={0}
        className="relative flex-1 w-full overflow-hidden bg-white outline-none dark:bg-zinc-900"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
        {/* Visually-hidden, focusable proxy that hosts the OS IME composition.
            Keys are handled here because pointerdown focuses this element. */}
        <textarea
          ref={imeRef}
          tabIndex={-1}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="absolute z-10 h-px w-px resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent caret-transparent outline-none"
          style={{ left: 0, top: 0 }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={onCompositionEnd}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
        />
        {browserLoading && (
          <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
            {t('loading')}
          </div>
        )}
      </div>
    )
  ```

- [ ] **Step 6: Run automated gates, expect PASS.**
  ```
  pnpm exec tsc --noEmit
  pnpm lint
  pnpm test:run src/lib/browser/key-routing.test.ts
  ```
  Expected: `tsc` exits 0 (the new `imeRef`/handlers type-check), `pnpm lint` reports no errors for `browser-screencast.tsx`, and the routing test still passes. If `tsc` flags `e.nativeEvent.isComposing`, confirm `lib.dom` is in `tsconfig.json` (it is — `KeyboardEvent.isComposing` is standard DOM).

- [ ] **Step 7: Manual verification (real Tauri shell, IME + clipboard need a real engine).** Run `pnpm tauri dev`, open the in-app browser, then:
  1. Navigate to a page with a text input (e.g. `https://www.google.com`). Click the search box, switch the OS keyboard to Traditional Chinese (Bopomofo/注音 or Pinyin), and type. **Expected:** a candidate window appears anchored near the click point; selecting a candidate inserts the committed CJK string into the page field (one `Input.insertText` per commit), with no stray Latin letters from the raw keys.
  2. Select some text on the page, press **Ctrl+C** (Cmd+C on macOS), then paste into a NoteGen note/chat input. **Expected:** the web selection appears in the note (engine selection → OS clipboard).
  3. Copy text from another app, click a web form field, press **Ctrl+V** (Cmd+V). **Expected:** the external text is inserted into the web field via `browser_input_text`.
  4. Type plain English in a web field. **Expected:** characters still appear (the existing keydown path is untouched for non-composed, non-copy/paste keys).

- [ ] **Step 8: Verify LF and commit.** Confirm `browser-screencast.tsx` is LF (the Edit tool can leak CRLF on Windows across multiple edits — check before committing).
  ```
  git add src/app/core/main/browser/browser-screencast.tsx
  git commit -m "feat(browser): host IME composition + bridge clipboard in screencast canvas

Adds a hidden focusable textarea anchored at the click point to host OS IME
composition (committed via browser_input_text), and intercepts Ctrl/Cmd+C/V
to bridge engine selection and OS clipboard instead of forwarding raw keys.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> **Assumptions & notes for this milestone:**
> - browser_input_text is registered in BOTH src-tauri/src/lib.rs and src-tauri/src/main.rs invoke_handler lists and defined in BOTH the desktop impl and the mobile stub module of browser.rs (mobile returns the UNSUPPORTED error) so the command surface stays identical across platforms.
> - Verified against the installed crate: chromiumoxide::cdp::browser_protocol::input::InsertTextParams::new(text) (chromiumoxide_cdp-0.9.1/src/cdp.rs:62723-62731); IDENTIFIER == 'Input.insertText'. No spike needed.
> - M3 depends on the already-shipped (main-trunk) command browser_get_selected_text (src-tauri/src/browser.rs:929) for copy — it is NOT introduced by another milestone, so it is intentionally not listed under consumes.
> - Clipboard uses tauri-plugin-clipboard-api (readText/writeText), the established project convention (see src/app/core/main/chat/message-control/copy-control.tsx and clipboard-listener.tsx); package present in package.json:132.
> - No new i18n keys are added in M3: the IME proxy is a non-content composition shim with no visible/labeled text, and the context-menu copy/paste strings already exist (messages/*.json browser.contextMenu). M1 owns the new engine-related i18n keys.
> - The hidden textarea uses tabIndex={-1} and is focused programmatically on pointerdown; text-transparent + caret-transparent hide the inline composition preview while the OS candidate window still anchors to it. display:none is intentionally NOT used because it cannot receive focus.
> - onKeyDown/onKeyUp were intentionally moved OFF the wrapper div onto the textarea to avoid double-handling (keys bubble from the focused textarea); the wrapper keeps tabIndex={0} only for its focus ring. The ordinary printable-key DispatchKeyEvent path is preserved unchanged.
> - The M3 frontend wiring (DOM composition events + Tauri invoke + OS clipboard) cannot be unit-tested in jsdom; the routing decision is covered by the pure key-routing.test.ts unit test, and end-to-end IME/clipboard behavior is covered by the manual checklist in Task 3 Step 7 plus pnpm lint + tsc gates.
> - browser_input_text is also consumed later by M4 (context-menu paste) per the shared contract; M3 introduces it.


---

## Milestone 4: P2 features — popup capture + context menu + find-in-page + file downloads

**Goal:** Close the four remaining "real browser" gaps on the CDP engine — adopt `window.open`/`target=_blank` popups as tabs, ship a real localized right-click menu over a `Runtime.addBinding` bridge, implement TreeWalker find-in-page with a fixed Ctrl+F focus-routing conflict, and wire `Browser.setDownloadBehavior` + per-page download events into the existing downloads DB/UI.

---

### Task 1: Popup / new-target capture (Rust)

Adopt new CDP page targets (popups, `target=_blank`) as tabs and drop destroyed ones, via a browser-level `EventTargetCreated`/`EventTargetDestroyed` listener.

**Files:**
- Modify: `src-tauri/src/browser.rs:30` (add `target` event imports), `src-tauri/src/browser.rs:284-296` (`ensure_engine` — spawn target listeners + set download behavior later), add new `desktop`-mod fns + a `#[cfg(test)] mod tests`
- Test: `#[cfg(test)] mod tests` inside the `desktop` module of `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing unit test for the adoption predicate.** Add this test module at the end of `mod desktop` in `src-tauri/src/browser.rs` (just before the closing `}` of `mod desktop` at line 1048):
```rust
    #[cfg(test)]
    mod tests {
        use super::should_adopt_target;

        #[test]
        fn adopts_new_page_target() {
            assert!(should_adopt_target("page", "T1", &[]));
        }

        #[test]
        fn ignores_non_page_targets() {
            assert!(!should_adopt_target("service_worker", "T1", &[]));
            assert!(!should_adopt_target("iframe", "T2", &[]));
            assert!(!should_adopt_target("browser", "T3", &[]));
        }

        #[test]
        fn ignores_already_tracked_page() {
            let known = vec!["T1".to_string()];
            assert!(!should_adopt_target("page", "T1", &known));
        }
    }
```

- [ ] **Step 2: Run the test, expect FAIL.** `cargo test --manifest-path src-tauri/Cargo.toml should_adopt_target` → fails to compile: `error[E0432]: unresolved import `super::should_adopt_target``.

- [ ] **Step 3: Add the pure predicate.** Insert in `mod desktop` right after `fn target_id_str` (after line 390) in `src-tauri/src/browser.rs`:
```rust
    /// Decide whether a freshly-created CDP target should be adopted as a tab. Only
    /// top-level pages (type == "page") we are not already tracking qualify; service
    /// workers, iframes and the browser target itself are ignored.
    pub fn should_adopt_target(target_type: &str, target_id: &str, known_ids: &[String]) -> bool {
        target_type == "page" && !known_ids.iter().any(|id| id == target_id)
    }
```

- [ ] **Step 4: Run the test, expect PASS.** `cargo test --manifest-path src-tauri/Cargo.toml should_adopt_target` → `test result: ok. 3 passed`.

- [ ] **Step 5: Add the target-event imports.** In `src-tauri/src/browser.rs`, after the `input::{...}` use block (line 33-36) add:
```rust
    use chromiumoxide::cdp::browser_protocol::target::{EventTargetCreated, EventTargetDestroyed};
```

- [ ] **Step 6: Add the screencast-move + adopt + remove helpers.** Insert in `mod desktop` after `fn target_id_str` / `should_adopt_target` (after line 390):
```rust
    /// Move the active screencast onto whatever tab is currently active (used when a
    /// popup is adopted and becomes the visible tab). No-op when not streaming.
    async fn move_screencast_to_active(app: &AppHandle, state: &CdpState) {
        if state.screencast_task.lock().await.is_none() {
            return;
        }
        if let Some(h) = state.screencast_task.lock().await.take() {
            h.abort();
        }
        let old = state.screencast_target.lock().await.clone();
        if let Some(old) = old {
            if let Some(op) = state.page_for(&old).await {
                cdp_screencast::stop(&op).await;
            }
        }
        let (Some(page), Some(tid)) = (state.active_page().await, state.active_target().await) else {
            return;
        };
        let (w, h, dpr) = state.viewport.lock().await.unwrap_or((1280, 800, 1.0));
        let _ = set_device_metrics(&page, w, h, dpr).await;
        if let Ok(handle) = cdp_screencast::start(
            app.clone(),
            page.clone(),
            tid.clone(),
            (w as f64 * dpr) as u32,
            (h as f64 * dpr) as u32,
        )
        .await
        {
            *state.screencast_task.lock().await = Some(handle);
            *state.screencast_target.lock().await = Some(tid);
        }
    }

    /// Adopt a newly-created page target as a tab: locate its `Page` (retrying because
    /// chromiumoxide's Handler populates `pages()` shortly AFTER targetCreated fires),
    /// register it + per-page listeners + context menu, make it active, and stream it.
    pub async fn adopt_target(app: &AppHandle, state: &CdpState, target_id: &str) {
        if state.pages.lock().await.contains_key(target_id) {
            return;
        }
        let mut found: Option<Page> = None;
        for _ in 0..20 {
            {
                let guard = state.browser.lock().await;
                if let Some(browser) = guard.as_ref() {
                    if let Ok(pages) = browser.pages().await {
                        found = pages.into_iter().find(|p| target_id_str(p) == target_id);
                    }
                }
            }
            if found.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        let Some(page) = found else {
            return;
        };
        let url = eval_string(&page, "location.href").await;
        state
            .pages
            .lock()
            .await
            .insert(target_id.to_string(), page.clone());
        state
            .add_tab(Tab {
                id: target_id.to_string(),
                url,
                title: String::new(),
                favicon: String::new(),
            })
            .await;
        let handles =
            cdp_events::spawn_page_listeners(app.clone(), page.clone(), target_id.to_string());
        state.listeners.lock().await.insert(target_id.to_string(), handles);
        apply_context_menu(state, &page).await;
        // A popup mirrors normal browser UX: it becomes the visible/active tab.
        state.set_active(target_id).await;
        let _ = page.bring_to_front().await;
        move_screencast_to_active(app, state).await;
        emit_tabs_changed(app, state).await;
    }

    /// Drop a tab whose underlying target was destroyed (window.close / popup closed).
    pub async fn remove_target(app: &AppHandle, state: &CdpState, target_id: &str) {
        if !state.pages.lock().await.contains_key(target_id) {
            return;
        }
        if let Some(handles) = state.listeners.lock().await.remove(target_id) {
            for h in handles {
                h.abort();
            }
        }
        let sc = state.screencast_target.lock().await.clone();
        if sc.as_deref() == Some(target_id) {
            if let Some(h) = state.screencast_task.lock().await.take() {
                h.abort();
            }
            *state.screencast_target.lock().await = None;
        }
        state.pages.lock().await.remove(target_id);
        state.remove_tab(target_id).await;
        emit_tabs_changed(app, state).await;
    }
```
(`apply_context_menu` is added in Task 2 — Tasks 1 and 2 land together in the same `cargo build`; build only after both code blocks exist.)

- [ ] **Step 7: Spawn the browser-level target listeners in `ensure_engine`.** In `src-tauri/src/browser.rs`, replace the block from line 284 (`// The Handler MUST be polled...`) through line 295 (`Ok(())`) with:
```rust
        // The Handler MUST be polled continuously or no command/event ever resolves.
        let handler_task = tokio::spawn(async move {
            while let Some(h) = handler.next().await {
                if h.is_err() {
                    break;
                }
            }
        });

        // Create browser-level target streams while we still hold the local handle.
        let mut created = browser
            .event_listener::<EventTargetCreated>()
            .await
            .map_err(|e| format!("target-created listen failed: {e}"))?;
        let mut destroyed = browser
            .event_listener::<EventTargetDestroyed>()
            .await
            .map_err(|e| format!("target-destroyed listen failed: {e}"))?;

        *state.child.lock().await = Some(child);
        *state.browser.lock().await = Some(browser);
        *state.handler_task.lock().await = Some(handler_task);

        let created_task = {
            let app = app.clone();
            tokio::spawn(async move {
                while let Some(ev) = created.next().await {
                    let ttype = ev.target_info.r#type.clone();
                    let tid = serde_json::to_value(&ev.target_info.target_id)
                        .ok()
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_default();
                    if tid.is_empty() {
                        continue;
                    }
                    let guard = app.state::<CdpState>();
                    let state = guard.inner();
                    let known: Vec<String> = state.pages.lock().await.keys().cloned().collect();
                    if should_adopt_target(&ttype, &tid, &known) {
                        adopt_target(&app, state, &tid).await;
                    }
                }
            })
        };
        let destroyed_task = {
            let app = app.clone();
            tokio::spawn(async move {
                while let Some(ev) = destroyed.next().await {
                    let tid = serde_json::to_value(&ev.target_id)
                        .ok()
                        .and_then(|v| v.as_str().map(|s| s.to_string()))
                        .unwrap_or_default();
                    if tid.is_empty() {
                        continue;
                    }
                    let guard = app.state::<CdpState>();
                    remove_target(&app, guard.inner(), &tid).await;
                }
            })
        };
        // Track under a reserved key so shutdown()'s drain aborts them; "__browser__"
        // can never collide with a real CDP targetId.
        state
            .listeners
            .lock()
            .await
            .insert("__browser__".to_string(), vec![created_task, destroyed_task]);

        Ok(())
```

- [ ] **Step 8: Commit (after Task 2 also compiles).** `git add src-tauri/src/browser.rs` then:
```
git commit -m "feat(browser): adopt popup/new-target pages as tabs over CDP targetCreated

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Right-click context menu over the `__noteGenBridge` binding (Rust + frontend)

Replace the `browser_inject_context_menu` stub with `Page.addScriptToEvaluateOnNewDocument` injecting a localized in-page menu, `Runtime.addBinding` for the callback, and a per-page `EventBindingCalled` listener that emits `browser-context-action`. Wire copy/paste through M3's `browser_input_text`.

**Files:**
- Modify: `src-tauri/src/browser.rs:40-42` (add `AddScriptToEvaluateOnNewDocumentParams` to the `page::{...}` import), add `runtime` import; `src-tauri/src/browser.rs:299-325` (`create_tab` — apply context menu); `src-tauri/src/browser.rs:974-983` (implement `browser_inject_context_menu`)
- Modify: `src-tauri/src/cdp_events.rs:17-21` (imports), `src-tauri/src/cdp_events.rs:33-39` (`spawn_page_listeners`), add `binding_called` listener
- Modify: `src/app/core/main/browser/browser-webview.tsx:189-210` (add copy/paste cases)
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write failing unit tests for the two pure fns.** Add to the `tests` module created in Task 1 (`src-tauri/src/browser.rs`):
```rust
        use super::{context_menu_script, parse_context_action};
        use std::collections::HashMap;

        #[test]
        fn menu_script_embeds_bridge_and_labels() {
            let mut labels = HashMap::new();
            labels.insert("translate".to_string(), "翻譯選取".to_string());
            let js = context_menu_script(&labels);
            assert!(js.contains("__noteGenBridge"));
            assert!(js.contains("翻譯選取"));
            assert!(js.contains("addEventListener('contextmenu'"));
        }

        #[test]
        fn parse_action_extracts_fields() {
            let v = parse_context_action(r#"{"action":"quote","text":"hi","url":"u","title":"t"}"#)
                .unwrap();
            assert_eq!(v["action"], "quote");
            assert_eq!(v["text"], "hi");
        }

        #[test]
        fn parse_action_rejects_garbage_and_missing_action() {
            assert!(parse_context_action("not json").is_none());
            assert!(parse_context_action(r#"{"text":"x"}"#).is_none());
        }
```

- [ ] **Step 2: Run the tests, expect FAIL.** `cargo test --manifest-path src-tauri/Cargo.toml context_menu` → `error[E0432]: unresolved import `super::context_menu_script``.

- [ ] **Step 3: Add imports.** In `src-tauri/src/browser.rs` change the `page::{...}` use block (lines 40-42) to add the script param, and add the runtime import after it:
```rust
    use chromiumoxide::cdp::browser_protocol::page::{
        AddScriptToEvaluateOnNewDocumentParams, GetNavigationHistoryParams, NavigateParams,
        NavigateToHistoryEntryParams, ReloadParams,
    };
    use chromiumoxide::cdp::js_protocol::runtime::AddBindingParams;
```

- [ ] **Step 4: Add the two pure fns + the `apply_context_menu` helper.** Insert in `mod desktop` after `should_adopt_target` (Task 1) in `src-tauri/src/browser.rs`:
```rust
    /// Build the in-page context-menu bootstrap script. Injected via
    /// addScriptToEvaluateOnNewDocument (and evaluated once on the current document):
    /// renders a localized menu on `contextmenu`, runs page-local actions
    /// (back/forward/reload/selectAll/print) inline, and forwards host actions
    /// (copy/paste/quote/translate/screenshot/bookmark/devtools) over the
    /// `__noteGenBridge` binding as a JSON string.
    pub fn context_menu_script(labels: &HashMap<String, String>) -> String {
        fn esc(s: &str) -> String {
            s.replace('\\', "\\\\").replace('\'', "\\'")
        }
        let g = |k: &str, d: &str| esc(labels.get(k).map(|s| s.as_str()).unwrap_or(d));
        const TEMPLATE: &str = r#"(function(){
  if (window.__noteGenMenuInstalled) return;
  window.__noteGenMenuInstalled = true;
  var L = {back:'%BACK%',forward:'%FORWARD%',reload:'%RELOAD%',copy:'%COPY%',paste:'%PASTE%',selectAll:'%SELECTALL%',quote:'%QUOTE%',translate:'%TRANSLATE%',screenshot:'%SCREENSHOT%',bookmark:'%BOOKMARK%',print:'%PRINT%',devTools:'%DEVTOOLS%'};
  function send(action){ try { window.__noteGenBridge(JSON.stringify({action:action,text:String(window.getSelection()||''),url:location.href,title:document.title})); } catch(e){} }
  function close(){ var m=document.getElementById('__ng_menu'); if(m) m.remove(); }
  var ITEMS=[
    ['back',function(){history.back();}],['forward',function(){history.forward();}],['reload',function(){location.reload();}],['sep'],
    ['copy',function(){send('copy');}],['paste',function(){send('paste');}],['selectAll',function(){document.execCommand('selectAll');}],['sep'],
    ['quote',function(){send('quote');}],['translate',function(){send('translate');}],['screenshot',function(){send('screenshot');}],['bookmark',function(){send('bookmark');}],['sep'],
    ['print',function(){window.print();}],['devTools',function(){send('devtools');}]
  ];
  document.addEventListener('contextmenu',function(e){
    e.preventDefault(); close();
    var menu=document.createElement('div'); menu.id='__ng_menu';
    menu.style.cssText='position:fixed;z-index:2147483647;min-width:180px;background:#fff;color:#111;border:1px solid #ccc;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.2);padding:4px 0;font:13px system-ui,sans-serif;';
    var x=Math.min(e.clientX, window.innerWidth-200), y=Math.min(e.clientY, window.innerHeight-360);
    menu.style.left=Math.max(0,x)+'px'; menu.style.top=Math.max(0,y)+'px';
    ITEMS.forEach(function(it){
      if(it[0]==='sep'){ var hr=document.createElement('div'); hr.style.cssText='height:1px;background:#eee;margin:4px 0;'; menu.appendChild(hr); return; }
      var item=document.createElement('div'); item.textContent=L[it[0]]; item.style.cssText='padding:6px 14px;cursor:pointer;white-space:nowrap;';
      item.onmouseenter=function(){item.style.background='#f0f0f0';}; item.onmouseleave=function(){item.style.background='transparent';};
      item.onclick=function(){ close(); it[1](); };
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    setTimeout(function(){ document.addEventListener('mousedown',function h(ev){ if(!menu.contains(ev.target)){ close(); document.removeEventListener('mousedown',h);} }); },0);
  }, true);
})();"#;
        TEMPLATE
            .replace("%BACK%", &g("back", "Back"))
            .replace("%FORWARD%", &g("forward", "Forward"))
            .replace("%RELOAD%", &g("reload", "Reload"))
            .replace("%COPY%", &g("copy", "Copy"))
            .replace("%PASTE%", &g("paste", "Paste"))
            .replace("%SELECTALL%", &g("selectAll", "Select All"))
            .replace("%QUOTE%", &g("quote", "Quote"))
            .replace("%TRANSLATE%", &g("translate", "Translate"))
            .replace("%SCREENSHOT%", &g("screenshot", "Screenshot"))
            .replace("%BOOKMARK%", &g("bookmark", "Bookmark"))
            .replace("%PRINT%", &g("print", "Print"))
            .replace("%DEVTOOLS%", &g("devTools", "DevTools"))
    }

    /// Parse a `__noteGenBridge` payload (JSON string from the in-page menu) into the
    /// object emitted on `browser-context-action`. Returns None for malformed payloads
    /// or a missing `action`.
    pub fn parse_context_action(payload: &str) -> Option<Value> {
        let v: Value = serde_json::from_str(payload).ok()?;
        let action = v.get("action")?.as_str()?.to_string();
        Some(json!({
            "action": action,
            "text": v.get("text").and_then(|x| x.as_str()).unwrap_or(""),
            "url": v.get("url").and_then(|x| x.as_str()).unwrap_or(""),
            "title": v.get("title").and_then(|x| x.as_str()).unwrap_or(""),
        }))
    }

    /// Register the bridge binding + inject the localized menu script for one page,
    /// using the labels last supplied by the frontend (no-op until they are set).
    async fn apply_context_menu(state: &CdpState, page: &Page) {
        let labels = state.context_menu_labels.lock().await.clone();
        if let Some(labels) = labels {
            let script = context_menu_script(&labels);
            let _ = page.execute(AddBindingParams::new("__noteGenBridge")).await;
            let _ = page
                .execute(AddScriptToEvaluateOnNewDocumentParams::new(script.clone()))
                .await;
            let _ = page.evaluate(script).await;
        }
    }
```

- [ ] **Step 5: Run the tests, expect PASS.** `cargo test --manifest-path src-tauri/Cargo.toml context_menu parse_action` → all pass.

- [ ] **Step 6: Implement `browser_inject_context_menu` (replace the stub).** Replace lines 974-983 of `src-tauri/src/browser.rs` with:
```rust
    pub async fn browser_inject_context_menu(
        state: tauri::State<'_, CdpState>,
        labels: HashMap<String, String>,
    ) -> Result<(), String> {
        *state.context_menu_labels.lock().await = Some(labels);
        let pages: Vec<Page> = state.pages.lock().await.values().cloned().collect();
        for page in pages {
            apply_context_menu(&state, &page).await;
        }
        Ok(())
    }
```

- [ ] **Step 7: Apply the menu to freshly-seeded tabs.** In `create_tab` (`src-tauri/src/browser.rs`), after the listener insert at line 323 (`state.listeners.lock().await.insert(...)`) and before `Ok(target_id)`:
```rust
        apply_context_menu(state, &page).await;
```

- [ ] **Step 8: Add the binding-called listener in cdp_events.** In `src-tauri/src/cdp_events.rs` add to the imports after line 20 (`use chromiumoxide::Page;`):
```rust
use chromiumoxide::cdp::js_protocol::runtime::EventBindingCalled;
```
Add `binding_called(app.clone(), page.clone(), target_id.clone()),` to the vec in `spawn_page_listeners` (line 34-38), then add this fn after `nav_within` (after line 109):
```rust
/// `__noteGenBridge` callbacks from the injected context menu → browser-context-action.
fn binding_called(app: AppHandle, page: Page, target_id: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(mut stream) = page.event_listener::<EventBindingCalled>().await else {
            return;
        };
        while let Some(ev) = stream.next().await {
            if ev.name != "__noteGenBridge" {
                continue;
            }
            let Some(payload) = crate::browser::parse_context_action(&ev.payload) else {
                continue;
            };
            let guard = app.state::<CdpState>();
            if guard.inner().is_active_target(&target_id).await {
                let _ = app.emit("browser-context-action", payload);
            }
        }
    })
}
```

- [ ] **Step 9: Wire copy/paste in the frontend handler.** In `src/app/core/main/browser/browser-webview.tsx`, inside the `browser-context-action` switch (lines 191-209), add two cases before the closing `}` of the switch (after the `devtools` case at line 208):
```tsx
          case 'copy':
            invoke<string>('browser_get_selected_text').then(async (selected) => {
              if (selected) {
                try { await navigator.clipboard.writeText(selected) } catch { /* clipboard denied */ }
              }
            }).catch(() => {})
            break
          case 'paste':
            navigator.clipboard.readText().then((clip) => {
              if (clip) invoke('browser_input_text', { text: clip }).catch(() => {})
            }).catch(() => {})
            break
```

- [ ] **Step 10: Build + lint, expect PASS.** `cargo build --manifest-path src-tauri/Cargo.toml` then `pnpm lint` → both green. Manual verify (real engine): right-click a page → localized menu appears; "Translate Selection" emits `browser-context-action` with `action:"translate"`; "Paste" injects clipboard text into a focused input.

- [ ] **Step 11: Commit.** `git add src-tauri/src/browser.rs src-tauri/src/cdp_events.rs src/app/core/main/browser/browser-webview.tsx` then:
```
git commit -m "feat(browser): real context menu via Runtime.addBinding + copy/paste bridge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Find-in-page (Rust commands + emit)

Implement `browser_find_start/next/prev/close` as a self-contained injected TreeWalker highlighter that returns `{count,index}`; Rust parses it and emits `browser-find-state`.

**Files:**
- Modify: `src-tauri/src/browser.rs:985-1008` (implement the four find commands), add `parse_find_state` + `run_find` + `find_program`
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing unit test.** Add to the `tests` module in `src-tauri/src/browser.rs`:
```rust
        use super::parse_find_state;
        use serde_json::json;

        #[test]
        fn find_state_reads_count_and_index() {
            assert_eq!(parse_find_state(&json!({"count":3,"index":1})), (3, 1));
        }

        #[test]
        fn find_state_defaults_to_no_match() {
            assert_eq!(parse_find_state(&json!({})), (0, -1));
        }

        #[test]
        fn find_state_clamps_negative_count() {
            assert_eq!(parse_find_state(&json!({"count":-5,"index":-1})), (0, -1));
        }
```

- [ ] **Step 2: Run the test, expect FAIL.** `cargo test --manifest-path src-tauri/Cargo.toml find_state` → `error[E0432]: unresolved import `super::parse_find_state``.

- [ ] **Step 3: Add `parse_find_state`, `find_program`, and `run_find`.** Insert in `mod desktop` after `parse_context_action` (`src-tauri/src/browser.rs`):
```rust
    /// Parse the `{count, index}` returned by the in-page find module into the pair
    /// emitted on `browser-find-state`. Missing/garbage fields fall back to (0, -1).
    pub fn parse_find_state(v: &Value) -> (i64, i64) {
        let count = v.get("count").and_then(|c| c.as_i64()).unwrap_or(0).max(0);
        let index = v.get("index").and_then(|i| i.as_i64()).unwrap_or(-1);
        (count, index)
    }

    /// Self-contained find program. State (`window.__ngFind`) persists across calls so
    /// next/prev advance without re-scanning. ops: start | next | prev | clear.
    fn find_program() -> &'static str {
        r#"function(op,query,cs){
  var W=window; if(!W.__ngFind) W.__ngFind={marks:[],idx:-1}; var S=W.__ngFind;
  function clearMarks(){ S.marks.forEach(function(m){ var p=m.parentNode; if(!p) return; while(m.firstChild) p.insertBefore(m.firstChild,m); p.removeChild(m); p.normalize(); }); S.marks=[]; S.idx=-1; }
  function highlight(q){ clearMarks(); if(!q) return; var needle=cs?q:q.toLowerCase();
    var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){ if(!n.nodeValue||!n.nodeValue.trim()) return NodeFilter.FILTER_REJECT; var p=n.parentNode; if(p&&(p.nodeName==='SCRIPT'||p.nodeName==='STYLE'||p.nodeName==='NOSCRIPT')) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; }});
    var nodes=[],n; while(n=walker.nextNode()) nodes.push(n);
    nodes.forEach(function(node){ var hay=cs?node.nodeValue:node.nodeValue.toLowerCase(); var from=0,pos,pieces=[];
      while(needle.length&&(pos=hay.indexOf(needle,from))!==-1){ pieces.push([pos,pos+needle.length]); from=pos+needle.length; }
      if(!pieces.length) return; var parent=node.parentNode; if(!parent) return; var text=node.nodeValue,last=0,frag=document.createDocumentFragment();
      pieces.forEach(function(pc){ if(pc[0]>last) frag.appendChild(document.createTextNode(text.slice(last,pc[0]))); var mk=document.createElement('mark'); mk.setAttribute('data-ng-find','1'); mk.style.background='#ffd54a'; mk.style.color='inherit'; mk.textContent=text.slice(pc[0],pc[1]); frag.appendChild(mk); S.marks.push(mk); last=pc[1]; });
      if(last<text.length) frag.appendChild(document.createTextNode(text.slice(last))); parent.replaceChild(frag,node); }); }
  function focusIdx(){ S.marks.forEach(function(m,i){ m.style.background=(i===S.idx)?'#ff9800':'#ffd54a'; }); var cur=S.marks[S.idx]; if(cur&&cur.scrollIntoView) cur.scrollIntoView({block:'center',inline:'nearest'}); }
  if(op==='start'){ highlight(query); S.idx=S.marks.length?0:-1; focusIdx(); }
  else if(op==='next'){ if(S.marks.length){ S.idx=(S.idx+1)%S.marks.length; focusIdx(); } }
  else if(op==='prev'){ if(S.marks.length){ S.idx=(S.idx-1+S.marks.length)%S.marks.length; focusIdx(); } }
  else if(op==='clear'){ clearMarks(); }
  return JSON.stringify({count:S.marks.length,index:S.idx});
}"#
    }

    async fn run_find(
        app: &AppHandle,
        state: &CdpState,
        op: &str,
        query: &str,
        cs: bool,
    ) -> Result<(), String> {
        let Some(page) = state.active_page().await else {
            return Ok(());
        };
        let q = serde_json::to_string(query).unwrap_or_else(|_| "\"\"".to_string());
        let expr = format!("({})('{}', {}, {})", find_program(), op, q, cs);
        let val = page
            .evaluate(expr)
            .await
            .ok()
            .and_then(|r| r.into_value::<Value>().ok())
            .unwrap_or_else(|| json!({}));
        let (count, index) = parse_find_state(&val);
        let _ = app.emit("browser-find-state", json!({ "count": count, "index": index }));
        Ok(())
    }
```

- [ ] **Step 4: Run the test, expect PASS.** `cargo test --manifest-path src-tauri/Cargo.toml find_state` → `3 passed`.

- [ ] **Step 5: Replace the four find command stubs.** Replace lines 985-1008 of `src-tauri/src/browser.rs` with:
```rust
    #[tauri::command]
    pub async fn browser_find_start(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
        query: String,
        case_sensitive: bool,
    ) -> Result<(), String> {
        run_find(&app, &state, "start", &query, case_sensitive).await
    }

    #[tauri::command]
    pub async fn browser_find_next(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
    ) -> Result<(), String> {
        run_find(&app, &state, "next", "", false).await
    }

    #[tauri::command]
    pub async fn browser_find_prev(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
    ) -> Result<(), String> {
        run_find(&app, &state, "prev", "", false).await
    }

    #[tauri::command]
    pub async fn browser_find_close(
        app: AppHandle,
        state: tauri::State<'_, CdpState>,
    ) -> Result<(), String> {
        run_find(&app, &state, "clear", "", false).await
    }
```
(The mobile stubs at lines 1230-1252 keep their existing signatures — the frontend args `query`/`caseSensitive` are unchanged; `app`/`state` are injected and not part of the IPC surface, so `lib.rs`/`main.rs` need no edits.)

- [ ] **Step 6: Build, expect PASS.** `cargo build --manifest-path src-tauri/Cargo.toml` → green. Manual verify (real engine): type in the FindBar → matches highlight yellow, current one orange, FindBar shows `1/N`; Next/Prev cycle and scroll into view; close clears highlights.

- [ ] **Step 7: Commit.** `git add src-tauri/src/browser.rs` then:
```
git commit -m "feat(browser): implement find-in-page (TreeWalker highlight + browser-find-state)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Fix the Ctrl+F focus-routing conflict (frontend)

When the browser canvas has focus, intercept Ctrl/Cmd+F to open the FindBar and `stopPropagation` so the global note-search in `layout.tsx` never fires.

**Files:**
- Modify: `src/lib/browser/find.ts:37` (add `isFindShortcut`)
- Modify: `src/lib/browser/find.test.ts:88` (append tests)
- Modify: `src/app/core/main/browser/browser-screencast.tsx:224-236` (`onKeyDown`)
- Modify: `src/app/core/layout.tsx:32` (import store) and `:145-163` (guard)
- Test: `src/lib/browser/find.test.ts`

- [ ] **Step 1: Write the failing test.** Append to `src/lib/browser/find.test.ts`:
```ts
import { isFindShortcut } from './find'

describe('isFindShortcut', () => {
  it('matches Ctrl+F', () => {
    expect(isFindShortcut({ key: 'f', ctrlKey: true, metaKey: false })).toBe(true)
  })
  it('matches Cmd+F (mac) and uppercase F', () => {
    expect(isFindShortcut({ key: 'f', ctrlKey: false, metaKey: true })).toBe(true)
    expect(isFindShortcut({ key: 'F', ctrlKey: true, metaKey: false })).toBe(true)
  })
  it('ignores plain f and other modified keys', () => {
    expect(isFindShortcut({ key: 'f', ctrlKey: false, metaKey: false })).toBe(false)
    expect(isFindShortcut({ key: 'g', ctrlKey: true, metaKey: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test, expect FAIL.** `pnpm test:run src/lib/browser/find.test.ts` → fails: `isFindShortcut is not a function` (no export).

- [ ] **Step 3: Add the predicate.** Append to `src/lib/browser/find.ts`:
```ts
export function isFindShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')
}
```

- [ ] **Step 4: Run the test, expect PASS.** `pnpm test:run src/lib/browser/find.test.ts` → all pass.

- [ ] **Step 5: Intercept in the canvas.** In `src/app/core/main/browser/browser-screencast.tsx`, add the import after line 5 (`import useBrowserStore...` already present at line 6 — add the find import):
```tsx
import { isFindShortcut } from '@/lib/browser/find'
```
Then change `onKeyDown` (lines 224-236) so the first statements are:
```tsx
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Browser owns Ctrl/Cmd+F: open the FindBar and stop the event reaching the
    // window-level global note-search handler in layout.tsx. Do NOT forward to CDP.
    if (isFindShortcut(e)) {
      e.preventDefault()
      e.stopPropagation()
      useBrowserStore.getState().setFindOpen(true)
      return
    }
    e.preventDefault()
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey
```
(leave the rest of the function — the `invoke('browser_input_key', ...)` body — unchanged).

- [ ] **Step 6: Defensive guard in layout.tsx.** In `src/app/core/layout.tsx` add after the existing `invoke` import (line 32):
```tsx
import useBrowserStore from "@/stores/browser"
```
Then in the Ctrl/Cmd+F branch (lines 145-163), insert at the very top of the `if ((e.metaKey || e.ctrlKey) && e.key === 'f') {` block, before the editor check:
```tsx
        // Browser mode owns Ctrl/Cmd+F (canvas opens the FindBar and stops
        // propagation). Guard here too so global note-search never steals it.
        if (useBrowserStore.getState().workspaceMode === 'browser') {
          return
        }
```

- [ ] **Step 7: Lint + full unit run, expect PASS.** `pnpm lint` then `pnpm test:run` → green. Manual verify (real engine): in browser mode press Ctrl+F → the page FindBar opens (not the global SearchDialog); in notes mode Ctrl+F still opens global/editor search.

- [ ] **Step 8: Commit.** `git add src/lib/browser/find.ts src/lib/browser/find.test.ts src/app/core/main/browser/browser-screencast.tsx src/app/core/layout.tsx` then:
```
git commit -m "fix(browser): route Ctrl/Cmd+F to in-page FindBar, not global note-search

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: File downloads (Rust events → existing downloads DB/UI)

Enable downloads via `Browser.setDownloadBehavior` and forward per-page `downloadWillBegin`/`downloadProgress` into `browser-download-started`/`browser-download-finished`, correlating guid→url.

**Files:**
- Modify: `src-tauri/src/browser.rs:88-106` (CdpState struct), `:108-127` (`new`), `:228-238` (`shutdown`), `:30` area (imports), `ensure_engine` (set download behavior); add `download_outcome`
- Modify: `src-tauri/src/cdp_events.rs:17-21` (imports), `:33-39` (`spawn_page_listeners`), add download listeners
- Test: `#[cfg(test)] mod tests` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing unit test.** Add to the `tests` module in `src-tauri/src/browser.rs`:
```rust
        use super::download_outcome;
        use chromiumoxide::cdp::browser_protocol::browser::DownloadProgressState;

        #[test]
        fn download_in_progress_is_not_terminal() {
            assert_eq!(download_outcome(&DownloadProgressState::InProgress), None);
        }

        #[test]
        fn download_completed_and_canceled_are_terminal() {
            assert_eq!(download_outcome(&DownloadProgressState::Completed), Some(true));
            assert_eq!(download_outcome(&DownloadProgressState::Canceled), Some(false));
        }
```

- [ ] **Step 2: Run the test, expect FAIL.** `cargo test --manifest-path src-tauri/Cargo.toml download_` → `error[E0432]: unresolved import `super::download_outcome``.

- [ ] **Step 3: Add imports + the pure fn.** In `src-tauri/src/browser.rs` add after the `emulation::{...}` use block (after line 32):
```rust
    use chromiumoxide::cdp::browser_protocol::browser::{
        DownloadProgressState, SetDownloadBehaviorBehavior, SetDownloadBehaviorParams,
    };
```
Add the pure fn in `mod desktop` after `parse_find_state`:
```rust
    /// Map a CDP download progress state to a terminal outcome: None while still in
    /// progress, Some(true) on completion, Some(false) on cancel. Drives the single
    /// browser-download-finished emit.
    pub fn download_outcome(state: &DownloadProgressState) -> Option<bool> {
        match state {
            DownloadProgressState::InProgress => None,
            DownloadProgressState::Completed => Some(true),
            DownloadProgressState::Canceled => Some(false),
        }
    }
```

- [ ] **Step 4: Run the test, expect PASS.** `cargo test --manifest-path src-tauri/Cargo.toml download_` → `2 passed`.

- [ ] **Step 5: Add the guid→url map to CdpState.** In `src-tauri/src/browser.rs` add after the `viewport` field (line 105):
```rust
        /// In-flight download guid -> (url, suggested_filename), for correlating the
        /// guid-only downloadProgress events back to a url on finish.
        pub downloads: Mutex<HashMap<String, (String, String)>>,
```
In `CdpState::new()` add after `viewport: Mutex::new(None),` (line 125):
```rust
                downloads: Mutex::new(HashMap::new()),
```
In `shutdown()` add before the closing brace, after line 237 (`*state.frame_channel.lock().await = None;`):
```rust
            self.downloads.lock().await.clear();
```

- [ ] **Step 6: Enable downloads in `ensure_engine`.** In `src-tauri/src/browser.rs`, just before the final `Ok(())` of `ensure_engine` (the `Ok(())` after the target-listener insert added in Task 1), insert:
```rust
        // Allow downloads to the OS Downloads dir (fallback app_data/downloads) and
        // enable Browser.downloadWillBegin/downloadProgress events.
        let dl_dir = app
            .path()
            .download_dir()
            .ok()
            .or_else(|| app.path().app_data_dir().ok().map(|d| d.join("downloads")));
        if let Some(dir) = dl_dir {
            let _ = std::fs::create_dir_all(&dir);
            let guard = state.browser.lock().await;
            if let Some(browser) = guard.as_ref() {
                let mut params = SetDownloadBehaviorParams::new(SetDownloadBehaviorBehavior::Allow);
                params.download_path = Some(dir.to_string_lossy().to_string());
                params.events_enabled = Some(true);
                let _ = browser.execute(params).await;
            }
        }
```

- [ ] **Step 7: Add the per-page download listeners.** In `src-tauri/src/cdp_events.rs` add to imports after the page import block (after line 19):
```rust
use chromiumoxide::cdp::browser_protocol::browser::{EventDownloadProgress, EventDownloadWillBegin};
```
Add `download_began(app.clone(), page.clone(), target_id.clone()),` and `download_progress(app.clone(), page.clone(), target_id.clone()),` to the `spawn_page_listeners` vec (line 34-38). Then add after `binding_called` (added in Task 2):
```rust
/// Download starting → record guid->(url,filename) + browser-download-started.
fn download_began(app: AppHandle, page: Page, _target_id: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(mut stream) = page.event_listener::<EventDownloadWillBegin>().await else {
            return;
        };
        while let Some(ev) = stream.next().await {
            let guard = app.state::<CdpState>();
            let state = guard.inner();
            state
                .downloads
                .lock()
                .await
                .insert(ev.guid.clone(), (ev.url.clone(), ev.suggested_filename.clone()));
            let _ = app.emit(
                "browser-download-started",
                json!({
                    "url": ev.url,
                    "filename": ev.suggested_filename,
                    "destination": ev.suggested_filename,
                }),
            );
        }
    })
}

/// Download progress → on a terminal state emit browser-download-finished (url looked
/// up from the guid map) and drop the entry. Not gated on active tab: a download in
/// any tab must register.
fn download_progress(app: AppHandle, page: Page, _target_id: String) -> JoinHandle<()> {
    tokio::spawn(async move {
        let Ok(mut stream) = page.event_listener::<EventDownloadProgress>().await else {
            return;
        };
        while let Some(ev) = stream.next().await {
            let Some(success) = crate::browser::download_outcome(&ev.state) else {
                continue;
            };
            let guard = app.state::<CdpState>();
            let state = guard.inner();
            let url = state
                .downloads
                .lock()
                .await
                .remove(&ev.guid)
                .map(|(u, _)| u)
                .unwrap_or_default();
            let _ = app.emit(
                "browser-download-finished",
                json!({
                    "url": url,
                    "path": ev.file_path,
                    "success": success,
                }),
            );
        }
    })
}
```

- [ ] **Step 8: Build + lint, expect PASS.** `cargo build --manifest-path src-tauri/Cargo.toml` then `pnpm lint` → green. Manual verify (real engine): click a download link → a row appears in the Downloads drawer with status `started`, then flips to `finished` with a path; `getInProgressDownloadCount()` returns to 0.

- [ ] **Step 9: Commit.** `git add src-tauri/src/browser.rs src-tauri/src/cdp_events.rs` then:
```
git commit -m "feat(browser): wire CDP file downloads into downloads DB and UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

**Milestone verification (all tasks):**
- `cargo test --manifest-path src-tauri/Cargo.toml` (runs all M4 `#[cfg(test)]` pure-fn tests) → green
- `cargo build --manifest-path src-tauri/Cargo.toml` (desktop) → green
- `pnpm test:run` → green; `pnpm lint` → green
- LF line endings preserved on every edited file (verify before each commit — Edit on Windows can leak CRLF)
- No new i18n keys required: `browser.contextMenu.*` and `browser.find.*` already exist in all five locales (`messages/{en,zh,zh-TW,ja,pt-BR}.json`); the menu is rendered from the labels the frontend already passes to `browser_inject_context_menu`.

> **Assumptions & notes for this milestone:**
> - M4 implements four commands that already exist as stubs in browser.rs and are already registered in lib.rs/main.rs (lines 81,85-88 / 116,119-122): browser_inject_context_menu and browser_find_start/next/prev/close. No invoke_handler edits are needed; only the desktop fn bodies change. The mobile stubs (browser.rs 1223-1252) keep their existing signatures and the unchanged frontend args, so the command surface stays identical across cfg targets.
> - CRITICAL cross-milestone dependency: context-menu Paste calls invoke('browser_input_text', { text }) which is introduced by M3 (Input.insertText). If M4 lands before M3, the 'paste' case is a no-op (the .catch swallows the missing-command error) — wire order M3 before M4, or treat paste as known-degraded until M3.
> - The frontend already fully consumes browser-context-action (browser-webview.tsx 189-210), browser-find-state + browser-find-requested (find-bar.tsx 19-40), and browser-download-started/finished (browser-webview.tsx 151-170 → src/db/downloads.ts). M4 only supplies the missing Rust emitters; this task adds the two missing frontend switch cases (copy/paste).
> - browser-favicon-changed is M5 (not M4). browser-engine-exited is M2. This milestone introduces no new browser-* events beyond the four listed.
> - Tasks 1 and 2 must be built together: adopt_target (Task 1) calls apply_context_menu (Task 2). Run the first cargo build only after both code blocks are present; the suggested commit order keeps Task 1's commit compiling because Task 2's helper is added in the same working tree before either commit (reorder commits if you prefer, but do not build between Step 6 of Task 1 and Step 4 of Task 2).
> - Verified against installed chromiumoxide 0.9.1 / chromiumoxide_cdp 0.9.1 source: Browser::execute (browser/mod.rs:410), Browser::pages (mod.rs:424), Browser::event_listener (mod.rs:444), Page::event_listener (page.rs:313), Page::opener_id (page.rs:384); TargetInfo.r#type / .target_id / .opener_id (cdp.rs:105128); EventTargetCreated/Destroyed (cdp.rs:107100/107122) in browser_protocol::target; AddBindingParams (cdp.rs:18587) + EventBindingCalled.name/.payload (cdp.rs:18808) in js_protocol::runtime; AddScriptToEvaluateOnNewDocumentParams (cdp.rs:88744) in browser_protocol::page; SetDownloadBehaviorParams/Behavior (cdp.rs:31478/31498), EventDownloadWillBegin.guid/.url/.suggested_filename (cdp.rs:32753), EventDownloadProgress.guid/.state/.file_path + DownloadProgressState (cdp.rs:32785/32806) in browser_protocol::browser.
> - Popup adoption deliberately retries browser.pages() for up to ~2s because chromiumoxide's Handler processes targetCreated asynchronously and the Page is not in pages() at the instant the event fires (matches the prompt's stated behavior).
> - Per-page download listeners are NOT gated on is_active_target (a download can begin in any tab); context-menu and find emits ARE gated on the active target to mirror the existing single-dispatcher behavior in cdp_events.rs.


---

## Milestone 5: Finishing

Ship the last polish for the CDP browser engine: real favicons, working zoom UI + shortcuts, screencast FPS/resize tuning, a fixed seed-tab title race, removal of the dead devtools button and the vestigial show/hide + overlay machinery + bridge capability, and a CDP-accurate rename of `BrowserWebView` to `BrowserHost`. Also split the incidental tiptap markdown-safety change out of this branch's history.

> Conventions for every task: TS unit tests live in a `.test.ts` next to the source and run with `pnpm test:run <path>`; Rust tests live in a `#[cfg(test)] mod` and run with `cargo test --manifest-path src-tauri/Cargo.toml <filter>`. Write files with LF endings only. Do not break the mobile `mod mobile` stub in `browser.rs` — the desktop changes below are inside `mod desktop` and the command surface stays identical.

---

### Task 1: Split the incidental tiptap markdown-safety change into its own commit

The branch has an unrelated WIP edit in `tiptap-editor.tsx` (wrap every `setContent` in try/catch so a markdown parse failure doesn't overwrite the user's file) plus its two i18n keys `editor.loadFailed` / `editor.loadFailedDesc`. Verified: the **entire** uncommitted delta of all five `messages/*.json` files is exactly that key pair (`git diff --stat` shows `2 insertions` per file), so staging the whole message files is safe and contains nothing browser-related. Commit this first so the rest of M5's history is browser-only.

Files:
- Modify (commit as-is, no code change): `src/app/core/main/editor/markdown/tiptap-editor.tsx`
- Modify (commit as-is): `messages/en.json:2813`, `messages/zh.json:2687`, `messages/zh-TW.json:2789`, `messages/ja.json:2873`, `messages/pt-BR.json:2820`
- Test: none (history-hygiene task; verified by `git diff --cached` inspection)

- [ ] **Step 1: Confirm the message-file delta is ONLY the editor keys (gate before staging).**
```bash
git -C e:/source/note-gen diff --stat -- messages/en.json messages/zh.json messages/zh-TW.json messages/ja.json messages/pt-BR.json
# EXPECT each line to read " messages/<x>.json | 2 ++"  (2 insertions, 0 deletions).
# If any file shows more than 2 changed lines, STOP — a browser i18n key is still
# uncommitted and must be committed by its own milestone first.
git -C e:/source/note-gen diff -- messages/en.json | grep -E '^\+' | grep -v '^\+\+\+'
# EXPECT exactly the two lines: "loadFailed": ... and "loadFailedDesc": ...
```

- [ ] **Step 2: Stage exactly the tiptap file and the five message files.**
```bash
cd e:/source/note-gen
git add src/app/core/main/editor/markdown/tiptap-editor.tsx \
        messages/en.json messages/zh.json messages/zh-TW.json messages/ja.json messages/pt-BR.json
```

- [ ] **Step 3: Verify the staged diff touches nothing browser-related (gate).**
```bash
git -C e:/source/note-gen diff --cached --name-only
# EXPECT exactly 6 paths: tiptap-editor.tsx + the 5 messages/*.json. No browser files.
git -C e:/source/note-gen diff --cached -- messages/zh-TW.json | grep -E '^\+' | grep -v '^\+\+\+'
# EXPECT only the loadFailed / loadFailedDesc additions.
```

- [ ] **Step 4: Commit with a conventional message.**
```bash
git -C e:/source/note-gen commit -m "fix(editor): guard markdown setContent with try/catch to prevent data loss

Build the editor with empty content and route all loads through the
try/catch-protected setContent paths; on parse failure keep the on-disk
file untouched and toast editor.loadFailed. Unrelated to the browser
migration — split out so this branch's history stays browser-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Confirm the working tree now has only browser-migration + M5 changes left.**
```bash
git -C e:/source/note-gen status --short -- src/app/core/main/editor messages
# EXPECT empty output (editor + messages fully committed).
```

---

### Task 2: Favicon — resolve and emit `browser-favicon-changed` from cdp_events

The frontend already listens for `browser-favicon-changed` (`browser-webview.tsx:131`) and tabs carry a `favicon` field, but Rust never emits it — favicons are always blank. Add a pure URL-resolver (testable, uses the already-present `url = "2.5"` crate) and wire it into the existing `load_fired` listener so the active tab's favicon is resolved on every load.

Files:
- Modify: `src-tauri/src/cdp_events.rs:43` (the `load_fired` listener) + add `resolve_favicon_url` + `#[cfg(test)] mod tests`
- Modify: `src-tauri/src/browser.rs:178` (add `update_tab_favicon` next to `update_tab_url`)
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/cdp_events.rs`

- [ ] **Step 1: Write the failing Rust test for `resolve_favicon_url`.** Append to `src-tauri/src/cdp_events.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::resolve_favicon_url;

    #[test]
    fn root_relative_href_resolves_against_origin() {
        assert_eq!(
            resolve_favicon_url("https://example.com/some/page", "/icon.png"),
            "https://example.com/icon.png"
        );
    }

    #[test]
    fn relative_href_resolves_against_directory() {
        assert_eq!(
            resolve_favicon_url("https://example.com/a/b", "fav.ico"),
            "https://example.com/a/fav.ico"
        );
    }

    #[test]
    fn empty_href_falls_back_to_default_favicon() {
        assert_eq!(
            resolve_favicon_url("https://example.com/page", ""),
            "https://example.com/favicon.ico"
        );
    }

    #[test]
    fn absolute_and_protocol_relative_href_pass_through() {
        assert_eq!(
            resolve_favicon_url("https://example.com/page", "https://cdn.example.com/i.png"),
            "https://cdn.example.com/i.png"
        );
        assert_eq!(
            resolve_favicon_url("https://example.com/page", "//cdn.x.com/i.png"),
            "https://cdn.x.com/i.png"
        );
    }

    #[test]
    fn unparseable_doc_url_yields_empty() {
        assert_eq!(resolve_favicon_url("not a url", "/icon.png"), "");
    }
}
```

- [ ] **Step 2: Run it, expect FAIL (function does not exist yet).**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml resolve_favicon
# EXPECT: error[E0425]: cannot find function `resolve_favicon_url` in module `super`
```

- [ ] **Step 3: Implement `resolve_favicon_url` + the favicon-query JS constant.** Add the import `use url::Url;` near the top of `src-tauri/src/cdp_events.rs` (with the other `use` lines), and add above `spawn_page_listeners`:
```rust
/// JS that returns the raw `href` attribute of the page's icon `<link>` (the
/// first `rel` containing "icon", case-insensitive), or "" when absent. The raw
/// (possibly relative) value is resolved Rust-side by `resolve_favicon_url`.
const FAVICON_HREF_JS: &str =
    r#"(() => { const l = document.querySelector('link[rel~="icon" i]'); return l ? (l.getAttribute('href') || '') : ''; })()"#;

/// Resolve a page's favicon to an absolute URL. `doc_url` is the document's
/// `location.href`; `raw_href` is the raw (possibly empty/relative/protocol-
/// relative/absolute) value of the icon `<link href>`. Empty `raw_href` falls
/// back to the origin's `/favicon.ico`. Returns "" when `doc_url` is unparseable.
pub fn resolve_favicon_url(doc_url: &str, raw_href: &str) -> String {
    let Ok(base) = Url::parse(doc_url) else {
        return String::new();
    };
    let href = raw_href.trim();
    let target = if href.is_empty() { "/favicon.ico" } else { href };
    base.join(target).map(|u| u.to_string()).unwrap_or_default()
}
```

- [ ] **Step 4: Add `update_tab_favicon` to `CdpState`.** In `src-tauri/src/browser.rs`, immediately after the `update_tab_url` method (ends at `:182`), insert:
```rust
        pub async fn update_tab_favicon(&self, target_id: &str, favicon: &str) {
            if let Some(t) = self.tabs.lock().await.iter_mut().find(|t| t.id == target_id) {
                t.favicon = favicon.to_string();
            }
        }
```

- [ ] **Step 5: Emit favicon from `load_fired`.** In `src-tauri/src/cdp_events.rs`, inside `load_fired`, replace the title block (the `if let Ok(res) = page.evaluate("document.title").await { ... }` at `:55`–`:64`) with the version that also resolves + emits the favicon:
```rust
            if let Ok(res) = page.evaluate("document.title").await {
                if let Ok(title) = res.into_value::<String>() {
                    let guard = app.state::<CdpState>();
                    let state = guard.inner();
                    state.update_tab_meta(&target_id, None, Some(&title)).await;
                    if state.is_active_target(&target_id).await {
                        let _ = app.emit("browser-title-changed", json!({ "title": title }));
                    }
                }
            }
            // Favicon: read the raw <link rel~=icon> href, resolve it against the
            // document URL, then mirror into the tab + emit for the active tab.
            let doc_url = page
                .evaluate("location.href")
                .await
                .ok()
                .and_then(|r| r.into_value::<String>().ok())
                .unwrap_or_default();
            let raw_href = page
                .evaluate(FAVICON_HREF_JS)
                .await
                .ok()
                .and_then(|r| r.into_value::<String>().ok())
                .unwrap_or_default();
            let favicon = resolve_favicon_url(&doc_url, &raw_href);
            if !favicon.is_empty() {
                let guard = app.state::<CdpState>();
                let state = guard.inner();
                state.update_tab_favicon(&target_id, &favicon).await;
                if state.is_active_target(&target_id).await {
                    let _ = app.emit("browser-favicon-changed", json!({ "favicon": favicon }));
                }
            }
```

- [ ] **Step 6: Run the test, expect PASS.**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml resolve_favicon
# EXPECT: test result: ok. 5 passed
```

- [ ] **Step 7: Commit.**
```bash
git -C e:/source/note-gen add src-tauri/src/cdp_events.rs src-tauri/src/browser.rs
git -C e:/source/note-gen commit -m "feat(browser): resolve and emit favicons from cdp_events

Add resolve_favicon_url (url crate) + read the icon <link href> on load,
mirror into tab meta and emit browser-favicon-changed for the active tab.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fix the seed-tab title race — register listeners before the initial navigation

`create_tab` (`browser.rs:299`) calls `browser.new_page(url)` (which navigates AND awaits load) and only *then* attaches `spawn_page_listeners`. So the first tab's `loadEventFired` (title + favicon) has already fired before the listener exists — the seed tab strip is stuck on the URL. Fix: open `about:blank`, attach listeners, then navigate.

Files:
- Modify: `src-tauri/src/browser.rs:299` (`create_tab`)
- Test: manual (real-engine integration; gated full-engine tests are M6). Concrete verification below.

- [ ] **Step 1: Rewrite `create_tab` to attach listeners before navigating.** Replace the body of `create_tab` (`browser.rs:299`–`:325`) with:
```rust
    async fn create_tab(app: &AppHandle, state: &CdpState, url: &str) -> Result<String, String> {
        // Open a blank page first so we can attach per-page listeners BEFORE the
        // real navigation — otherwise the first tab's loadEventFired (title +
        // favicon) fires before the listener exists (seed-tab title race).
        let page = {
            let guard = state.browser.lock().await;
            let browser = guard.as_ref().ok_or("Browser not created")?;
            browser
                .new_page("about:blank")
                .await
                .map_err(|e| format!("new_page failed: {e}"))?
        };
        let target_id = target_id_str(&page);
        state
            .pages
            .lock()
            .await
            .insert(target_id.clone(), page.clone());
        state
            .add_tab(Tab {
                id: target_id.clone(),
                url: url.to_string(),
                title: String::new(),
                favicon: String::new(),
            })
            .await;
        let handles = cdp_events::spawn_page_listeners(app.clone(), page.clone(), target_id.clone());
        state.listeners.lock().await.insert(target_id.clone(), handles);
        // Listeners are live — now drive the real navigation.
        if url != "about:blank" {
            state.set_pending_nav(&target_id, PendingNav::Navigate).await;
            page.execute(NavigateParams::new(url.to_string()))
                .await
                .map_err(|e| format!("navigate failed: {e}"))?;
        }
        Ok(target_id)
    }
```

- [ ] **Step 2: Drop the now-wrong "seed already loaded" loading clear.** In `browser_create` (`browser.rs:432`–`:434`) the comment + `emit_loading(&app, false)` assume `new_page(url)` already finished loading. With the new flow the seed page is still loading, and `load_fired` will emit `loading:false` when done. Replace those lines:
```rust
            emit_tabs_changed(&app, &state).await;
            // The seed navigation is now in-flight (listeners attached first);
            // load_fired will clear the spinner when the page finishes loading.
            emit_loading(&app, true);
```

- [ ] **Step 3: Build, expect PASS (compile gate).**
```bash
cargo build --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
# EXPECT: Finished ... (no errors)
```

- [ ] **Step 4: Manual verification against the real engine.** Run `pnpm tauri dev`, switch to browser mode, and let the homepage (Google) load.
  - EXPECT: the seed tab in the title-bar `TabStrip` shows the page **title** ("Google"), not the raw URL, within a second of first load.
  - EXPECT: the tab shows a favicon (Task 2) on first load, not only after a manual reload.
  - Before this fix the first tab stayed on the URL until a manual reload; confirm a fresh start now shows the title.

- [ ] **Step 5: Commit.**
```bash
git -C e:/source/note-gen add src-tauri/src/browser.rs
git -C e:/source/note-gen commit -m "fix(browser): attach page listeners before initial navigation

Open about:blank, register load/frame/within-doc listeners, then
navigate — so the seed tab's first loadEventFired (title + favicon) is
no longer missed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Screencast — skip restart when physical caps are unchanged

`apply_viewport` (`browser.rs:346`) aborts + restarts the screencast on **every** `browser_set_viewport`, which the frontend `ResizeObserver` fires constantly while dragging — causing flicker. Only the start-time `maxWidth/maxHeight` (physical px = css × dpr) actually require a restart. Add a pure caps helper + a stored `screencast_caps` and only restart when the physical caps change; always refresh device metrics so a dpr-only change (dragging across monitors) still re-reports.

Files:
- Modify: `src-tauri/src/browser.rs` — add `screencast_caps` field (`:106`/`:125`), `physical_caps` + `should_restart_screencast` fns, rewrite `apply_viewport` (`:346`), set caps in `browser_start_screencast` (`:580`), clear in `browser_stop_screencast` (`:594`) + `browser_hide` (`:536`)
- Test: `#[cfg(test)] mod tests` inside `mod desktop` in `src-tauri/src/browser.rs`

- [ ] **Step 1: Write the failing Rust test.** Add at the very end of `mod desktop` (just before its closing brace at `browser.rs:1048`):
```rust
    #[cfg(test)]
    mod tests {
        use super::{physical_caps, should_restart_screencast};

        #[test]
        fn physical_caps_multiplies_and_rounds() {
            assert_eq!(physical_caps(800, 600, 1.0), (800, 600));
            assert_eq!(physical_caps(800, 600, 2.0), (1600, 1200));
            // 1.5 dpr rounds to nearest integer.
            assert_eq!(physical_caps(801, 601, 1.5), (1202, 902));
        }

        #[test]
        fn physical_caps_guards_zero_and_negative_dpr() {
            assert_eq!(physical_caps(800, 600, 0.0), (800, 600));
            assert_eq!(physical_caps(800, 600, -1.0), (800, 600));
            assert_eq!(physical_caps(0, 0, 2.0), (1, 1));
        }

        #[test]
        fn restart_only_when_caps_change() {
            assert!(should_restart_screencast(None, (800, 600)));
            assert!(should_restart_screencast(Some((800, 600)), (1600, 1200)));
            assert!(!should_restart_screencast(Some((800, 600)), (800, 600)));
        }
    }
```

- [ ] **Step 2: Run it, expect FAIL.**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml physical_caps
# EXPECT: error[E0425]: cannot find function `physical_caps` in module `super`
```

- [ ] **Step 3: Add the `screencast_caps` field.** In `CdpState` (after `viewport` at `browser.rs:105`):
```rust
        /// Physical caps (css×dpr) the active screencast was last started with;
        /// used to skip needless abort+restart on viewport churn.
        pub screencast_caps: Mutex<Option<(u32, u32)>>,
```
And in `CdpState::new()` (after `viewport: Mutex::new(None),` at `:125`):
```rust
                screencast_caps: Mutex::new(None),
```

- [ ] **Step 4: Add the pure helpers.** Insert just above `apply_viewport` (`browser.rs:346`):
```rust
    /// Physical pixel caps (CSS px × dpr) the screencast must be started at.
    /// dpr ≤ 0 is treated as 1.0; result is clamped to ≥ 1 on each axis.
    fn physical_caps(css_w: u32, css_h: u32, dpr: f64) -> (u32, u32) {
        let dpr = if dpr <= 0.0 { 1.0 } else { dpr };
        (
            ((css_w as f64) * dpr).round().max(1.0) as u32,
            ((css_h as f64) * dpr).round().max(1.0) as u32,
        )
    }

    /// A screencast restart is only needed when the physical caps actually change.
    fn should_restart_screencast(current: Option<(u32, u32)>, next: (u32, u32)) -> bool {
        current != Some(next)
    }
```

- [ ] **Step 5: Rewrite `apply_viewport`.** Replace its body (`browser.rs:346`–`:381`) with:
```rust
    async fn apply_viewport(
        app: &AppHandle,
        state: &CdpState,
        width: f64,
        height: f64,
        dpr: f64,
    ) -> Result<(), String> {
        let w = width.max(1.0) as u32;
        let h = height.max(1.0) as u32;
        let dpr = if dpr <= 0.0 { 1.0 } else { dpr };
        *state.viewport.lock().await = Some((w, h, dpr));

        let Some(page) = state.active_page().await else {
            return Ok(());
        };
        // Always refresh device metrics so a dpr-only change (e.g. dragging the
        // window across monitors) is reflected even when we skip the restart.
        set_device_metrics(&page, w, h, dpr).await?;

        let streaming = state.screencast_task.lock().await.is_some();
        if streaming {
            let next_caps = physical_caps(w, h, dpr);
            let current = *state.screencast_caps.lock().await;
            if should_restart_screencast(current, next_caps) {
                if let Some(handle) = state.screencast_task.lock().await.take() {
                    handle.abort();
                }
                cdp_screencast::stop(&page).await;
                let target = state.active_target().await.unwrap_or_default();
                let handle = cdp_screencast::start(
                    app.clone(),
                    page.clone(),
                    target,
                    next_caps.0,
                    next_caps.1,
                )
                .await?;
                *state.screencast_task.lock().await = Some(handle);
                *state.screencast_caps.lock().await = Some(next_caps);
            }
        }
        Ok(())
    }
```

- [ ] **Step 6: Record + clear caps at start/stop.** In `browser_start_screencast` (`browser.rs:580`), replace the start call + assignment with:
```rust
        let caps = physical_caps(w, h, dpr);
        let handle = cdp_screencast::start(
            app,
            page.clone(),
            target.clone(),
            caps.0,
            caps.1,
        )
        .await?;
        *state.screencast_task.lock().await = Some(handle);
        *state.screencast_target.lock().await = Some(target);
        *state.screencast_caps.lock().await = Some(caps);
```
In `browser_stop_screencast` (`browser.rs:594`), after `*state.screencast_target.lock().await = None;`:
```rust
        *state.screencast_caps.lock().await = None;
```
In `browser_hide` (`browser.rs:536`), after `*state.screencast_target.lock().await = None;`:
```rust
        *state.screencast_caps.lock().await = None;
```

- [ ] **Step 7: Run the test, expect PASS, and build.**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml physical_caps
# EXPECT: test result: ok. 3 passed
cargo build --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
# EXPECT: Finished
```

- [ ] **Step 8: Commit.**
```bash
git -C e:/source/note-gen add src-tauri/src/browser.rs
git -C e:/source/note-gen commit -m "perf(browser): skip screencast restart when physical caps unchanged

Track the screencast's started physical caps and only abort+restart when
css×dpr actually changes; always refresh device metrics so dpr-only
changes still re-report. Removes drag-resize flicker.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Screencast — cap forward rate to ~30fps

The pump in `cdp_screencast::start` (`cdp_screencast.rs:84`) forwards every Chromium frame to the channel; on a large viewport this floods the IPC channel. ACK every frame (mandatory — else Chromium stalls) but only forward at a capped rate.

Files:
- Modify: `src-tauri/src/cdp_screencast.rs:84` (the pump) + add `should_emit_frame` + `#[cfg(test)] mod tests`
- Test: `#[cfg(test)] mod tests` inside `src-tauri/src/cdp_screencast.rs`

- [ ] **Step 1: Write the failing Rust test.** Append to `src-tauri/src/cdp_screencast.rs`:
```rust
#[cfg(test)]
mod tests {
    use super::{should_emit_frame, SCREENCAST_MIN_FRAME_MS};

    #[test]
    fn min_interval_is_about_30fps() {
        assert_eq!(SCREENCAST_MIN_FRAME_MS, 33);
    }

    #[test]
    fn emits_when_interval_elapsed() {
        assert!(should_emit_frame(SCREENCAST_MIN_FRAME_MS, SCREENCAST_MIN_FRAME_MS));
        assert!(should_emit_frame(100, SCREENCAST_MIN_FRAME_MS));
    }

    #[test]
    fn drops_when_too_soon() {
        assert!(!should_emit_frame(0, SCREENCAST_MIN_FRAME_MS));
        assert!(!should_emit_frame(10, SCREENCAST_MIN_FRAME_MS));
    }
}
```

- [ ] **Step 2: Run it, expect FAIL.**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml should_emit_frame
# EXPECT: error[E0425]: cannot find function `should_emit_frame`
```

- [ ] **Step 3: Add the cap constant + pure helper.** Insert above `start` (`cdp_screencast.rs:71`):
```rust
/// Minimum gap between forwarded frames (~30fps). Frames arriving faster are
/// still ACKed (so Chromium keeps producing) but not forwarded to the canvas.
pub const SCREENCAST_MIN_FRAME_MS: u64 = 33;

/// Forward a frame only when at least `min_interval_ms` has elapsed since the
/// last forwarded frame.
pub fn should_emit_frame(elapsed_ms: u64, min_interval_ms: u64) -> bool {
    elapsed_ms >= min_interval_ms
}
```

- [ ] **Step 4: Throttle the pump.** Replace the pump task body (`cdp_screencast.rs:83`–`:100`, from `let pump_page = page.clone();` through the closing `});`) with:
```rust
    let pump_page = page.clone();
    let handle = tokio::spawn(async move {
        // Start "stale" so the first frame is always forwarded.
        let mut last_emit = std::time::Instant::now()
            .checked_sub(std::time::Duration::from_millis(SCREENCAST_MIN_FRAME_MS + 1))
            .unwrap_or_else(std::time::Instant::now);
        while let Some(frame) = frames.next().await {
            // ALWAYS ack (even dropped frames) or Chromium stalls after the first
            // frame. Fire it before any gating so the stream stays hot.
            let _ = pump_page
                .execute(ScreencastFrameAckParams::new(frame.session_id))
                .await;
            let guard = app.state::<CdpState>();
            let state = guard.inner();
            if !state.is_active_target(&target_id).await {
                continue;
            }
            if !should_emit_frame(last_emit.elapsed().as_millis() as u64, SCREENCAST_MIN_FRAME_MS) {
                continue;
            }
            last_emit = std::time::Instant::now();
            if let Some(channel) = state.frame_channel().await {
                let _ = channel.send(frame_from_event(frame.as_ref()));
            }
        }
    });
```

- [ ] **Step 5: Run the test, expect PASS, and build.**
```bash
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml should_emit_frame
# EXPECT: test result: ok. 3 passed
cargo build --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
# EXPECT: Finished
```

- [ ] **Step 6: Commit.**
```bash
git -C e:/source/note-gen add src-tauri/src/cdp_screencast.rs
git -C e:/source/note-gen commit -m "perf(browser): cap screencast forward rate to ~30fps

ACK every frame (so Chromium keeps producing) but only forward to the
canvas channel once per ~33ms.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Zoom — mount the status bar + intercept Ctrl +/-/0

Zoom currently has no UI surface mounted (`BrowserStatusBar` is orphaned — no importer) and the browser canvas swallows Ctrl +/-/0 (it forwards every key to CDP). Add a pure `zoomShortcutAction` (testable), intercept those keys in the canvas to call `browser_set_zoom`, and mount a trimmed `BrowserStatusBar` (loading + zoom cluster only — the extract/screenshot/clear actions already live in `BrowserNavBar`, so the orphaned copies are dropped to avoid duplicate buttons).

Files:
- Modify: `src/lib/browser/zoom.ts` (add `zoomShortcutAction`) + `src/lib/browser/zoom.test.ts`
- Modify (rewrite): `src/app/core/main/browser/browser-status-bar.tsx`
- Modify: `src/app/core/main/browser/browser-screencast.tsx:224` (`onKeyDown`)
- Modify: `src/app/core/main/browser/index.tsx:54` (mount the status bar)
- Test: `src/lib/browser/zoom.test.ts`

- [ ] **Step 1: Add the failing test for `zoomShortcutAction`.** In `src/lib/browser/zoom.test.ts`, add `zoomShortcutAction` to the import from `./zoom` and append:
```ts
describe('zoomShortcutAction', () => {
  it('returns null without ctrl/meta', () => {
    expect(zoomShortcutAction({ key: '=', ctrlOrMeta: false })).toBeNull()
    expect(zoomShortcutAction({ key: '0', ctrlOrMeta: false })).toBeNull()
  })

  it('maps + / = to in', () => {
    expect(zoomShortcutAction({ key: '=', ctrlOrMeta: true })).toBe('in')
    expect(zoomShortcutAction({ key: '+', ctrlOrMeta: true })).toBe('in')
  })

  it('maps - / _ to out', () => {
    expect(zoomShortcutAction({ key: '-', ctrlOrMeta: true })).toBe('out')
    expect(zoomShortcutAction({ key: '_', ctrlOrMeta: true })).toBe('out')
  })

  it('maps 0 to reset', () => {
    expect(zoomShortcutAction({ key: '0', ctrlOrMeta: true })).toBe('reset')
  })

  it('returns null for unrelated keys', () => {
    expect(zoomShortcutAction({ key: 'a', ctrlOrMeta: true })).toBeNull()
    expect(zoomShortcutAction({ key: 'ArrowUp', ctrlOrMeta: true })).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, expect FAIL.**
```bash
pnpm test:run src/lib/browser/zoom.test.ts
# EXPECT: failure — "zoomShortcutAction is not a function" / import has no such export
```

- [ ] **Step 3: Implement `zoomShortcutAction`.** Append to `src/lib/browser/zoom.ts`:
```ts
export type ZoomShortcut = 'in' | 'out' | 'reset'

/** Map a Ctrl/Cmd-modified key to a zoom action, or null if not a zoom shortcut. */
export function zoomShortcutAction(e: { key: string; ctrlOrMeta: boolean }): ZoomShortcut | null {
  if (!e.ctrlOrMeta) return null
  switch (e.key) {
    case '=':
    case '+':
      return 'in'
    case '-':
    case '_':
      return 'out'
    case '0':
      return 'reset'
    default:
      return null
  }
}
```

- [ ] **Step 4: Run the test, expect PASS.**
```bash
pnpm test:run src/lib/browser/zoom.test.ts
# EXPECT: Test Files 1 passed; all zoomShortcutAction cases green
```

- [ ] **Step 5: Intercept the shortcut in the canvas.** In `src/app/core/main/browser/browser-screencast.tsx`, add to the imports from `@/lib/browser/zoom` (add a new import line):
```tsx
import { zoomShortcutAction, zoomIn, zoomOut, zoomReset } from '@/lib/browser/zoom'
```
Then replace `onKeyDown` (`:224`–`:236`) with:
```tsx
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Host-intercept zoom shortcuts (Ctrl/Cmd +/-/0) — do NOT forward to CDP.
    const zoomAction = zoomShortcutAction({ key: e.key, ctrlOrMeta: e.ctrlKey || e.metaKey })
    if (zoomAction) {
      e.preventDefault()
      e.stopPropagation()
      const current = useBrowserStore.getState().zoomLevel
      const next =
        zoomAction === 'in' ? zoomIn(current) : zoomAction === 'out' ? zoomOut(current) : zoomReset()
      invoke<number>('browser_set_zoom', { level: next })
        .then((actual) => useBrowserStore.getState().setZoomLevel(actual))
        .catch(() => {})
      return
    }
    e.preventDefault()
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey
    invoke('browser_input_key', {
      kind: 'down',
      key: e.key,
      code: e.code,
      windowsVirtualKeyCode: e.keyCode,
      text: printable ? e.key : null,
      modifiers: mods(e),
      location: e.location,
    }).catch(() => {})
  }
```

- [ ] **Step 6: Rewrite `BrowserStatusBar` to loading + zoom only.** Replace the entire contents of `src/app/core/main/browser/browser-status-bar.tsx` with:
```tsx
'use client'

import { invoke } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import { Loader2, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import useBrowserStore from '@/stores/browser'
import { zoomIn, zoomOut, zoomReset, formatZoomPercent } from '@/lib/browser/zoom'

// Bottom status bar for browser mode: loading indicator + zoom cluster. The
// extract/screenshot/clear-data actions live in BrowserNavBar — do NOT duplicate
// them here.
export function BrowserStatusBar() {
  const t = useTranslations('browser')
  const { browserLoading, browserReady, zoomLevel, setZoomLevel } = useBrowserStore()

  async function applyZoom(level: number) {
    if (!browserReady) return
    try {
      const actual = await invoke<number>('browser_set_zoom', { level })
      setZoomLevel(actual)
    } catch (e) {
      console.error('[Browser] zoom failed:', e)
    }
  }

  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-2 px-2 py-1 border-t bg-background text-xs text-muted-foreground">
        {browserLoading && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('loading')}
          </span>
        )}
        <div className="flex items-center gap-0.5 border-l pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => applyZoom(zoomOut(zoomLevel))}
                disabled={!browserReady}
                aria-label={t('zoomOut')}
              >
                <Minus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{t('zoomOut')}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-xs font-mono min-w-[3.5rem]"
                onClick={() => applyZoom(zoomReset())}
                disabled={!browserReady}
                aria-label={t('zoomReset')}
              >
                {formatZoomPercent(zoomLevel)}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{t('zoomReset')}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => applyZoom(zoomIn(zoomLevel))}
                disabled={!browserReady}
                aria-label={t('zoomIn')}
              >
                <Plus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{t('zoomIn')}</p></TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 7: Mount the status bar in `BrowserPanel`.** In `src/app/core/main/browser/index.tsx`, add the import after the `BrowserWebView` import (`:5`):
```tsx
import { BrowserStatusBar } from './browser-status-bar'
```
and add the component right after `<BrowserWebView />` (`:54`):
```tsx
      <BrowserWebView />
      <BrowserStatusBar />
```

- [ ] **Step 8: Lint + type-check, expect PASS.**
```bash
pnpm -C e:/source/note-gen lint
pnpm -C e:/source/note-gen exec tsc --noEmit
# EXPECT: both clean (the zoom keys browser.zoomIn/zoomOut/zoomReset already
# exist in all 5 message files — no new i18n keys are introduced).
```

- [ ] **Step 9: Manual verification.** `pnpm tauri dev`, browser mode: press Ctrl+= / Ctrl+- / Ctrl+0 over the page → page zooms and the status-bar percent updates; clicking the +/-/% buttons does the same; the page does not receive those keystrokes.

- [ ] **Step 10: Commit.**
```bash
git -C e:/source/note-gen add src/lib/browser/zoom.ts src/lib/browser/zoom.test.ts \
  src/app/core/main/browser/browser-status-bar.tsx \
  src/app/core/main/browser/browser-screencast.tsx \
  src/app/core/main/browser/index.tsx
git -C e:/source/note-gen commit -m "feat(browser): mount zoom status bar and intercept Ctrl +/-/0

Add zoomShortcutAction, host-intercept the zoom keys in the canvas to
call browser_set_zoom, and mount a trimmed BrowserStatusBar (loading +
zoom only) in BrowserPanel.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Remove the headless devtools button (v1)

There is no clean headless path to open Chromium's DevTools front-end, so `browser_toggle_devtools` is already a flag-only stub. Remove the toolbar button and every frontend call site; keep the Rust command (and the `devtoolsOpen` store field, still used by `handleClearData`) so the registered command surface is unchanged.

Files:
- Modify: `src/app/core/main/browser/browser-nav-bar.tsx:6,27,72,340`
- Modify: `src/app/core/main/browser/browser-webview.tsx:28,143,206`
- Rust: no change (`browser_toggle_devtools` stays registered as a stub)
- Test: lint/tsc + grep gate (UI removal)

- [ ] **Step 1: Strip the devtools button from the nav bar.** In `src/app/core/main/browser/browser-nav-bar.tsx`:
  - In the lucide import (`:6`), remove `Wrench` from the list.
  - In the destructure (`:27`), remove `devtoolsOpen` (keep `setDevtoolsOpen` — `handleClearData` still calls it).
  - Delete the `handleToggleDevtools` function (`:72`–`:82`).
  - Delete the DevTools `<Button>` inside the settings `<PopoverContent>` (`:340`–`:351`, the block starting `<Button ... onClick={handleToggleDevtools} ...>` with the `Wrench` icon and the `t(devtoolsOpen ? 'contextMenu.devToolsClose' : 'contextMenu.devTools')` label).

- [ ] **Step 2: Strip the devtools wiring from the event hub.** In `src/app/core/main/browser/browser-webview.tsx`:
  - In the destructure (`:28` area), remove `setDevtoolsOpen` (it becomes unused after the listener is gone).
  - Delete the `browser-devtools-state` listener (`:143`–`:145`):
```tsx
      // R8: DevTools 開關狀態。Rust toggle 後 emit。
      window.listen<{ open: boolean }>('browser-devtools-state', (event) => {
        setDevtoolsOpen(event.payload.open)
      }),
```
  - Delete the `devtools` case in the `browser-context-action` switch (`:206`–`:208`):
```tsx
          case 'devtools':
            invoke('browser_toggle_devtools').catch((err: unknown) => console.error('[Browser] DevTools toggle failed:', err))
            break
```

- [ ] **Step 3: Grep gate — no frontend call sites remain.**
```bash
cd e:/source/note-gen
grep -rn "browser_toggle_devtools\|browser-devtools-state\|handleToggleDevtools\|Wrench" src
# EXPECT: no matches (the Rust command in browser.rs/main.rs/lib.rs is intentionally kept).
```

- [ ] **Step 4: Lint + type-check, expect PASS.**
```bash
pnpm -C e:/source/note-gen lint
pnpm -C e:/source/note-gen exec tsc --noEmit
# EXPECT: clean (no unused-var errors from the removed devtools symbols).
```

- [ ] **Step 5: Commit.**
```bash
git -C e:/source/note-gen add src/app/core/main/browser/browser-nav-bar.tsx src/app/core/main/browser/browser-webview.tsx
git -C e:/source/note-gen commit -m "refactor(browser): remove headless devtools toggle button (v1)

No clean headless path to the DevTools front-end; drop the toolbar button
and all frontend call sites. Rust browser_toggle_devtools stays a stub so
the command surface is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Delete vestigial show/hide + overlay machinery + bridge capability

With CDP, content is a `<canvas>` — overlays (drawers, model select) render above it natively, so the `overlayCount`/`pushOverlay`/`popOverlay` machinery and the `browser_show`/`browser_hide` frontend calls are dead. Remove the store fields + all five consumers + the two `invoke` sites, and delete the now-unused `browser-bridge.json` capability (it scoped the deleted native child webview labels `browser-webview` / `browser-tab-*`).

Files:
- Modify: `src/stores/browser.ts:30-34,108-110`
- Modify: `src/app/core/main/browser/bookmark-drawer.tsx:21-26`, `browser-drawer.tsx:61,73-77`, `downloads-drawer.tsx:36-41`, `history-drawer.tsx:59-64`
- Modify: `src/app/core/main/chat/model-select.tsx:47-56`
- Modify: `src/app/core/main/page.tsx:128-136`, `src/app/core/layout.tsx:32,134-139`
- Delete: `src-tauri/capabilities/browser-bridge.json`
- Test: lint/tsc + grep gate

- [ ] **Step 1: Remove the overlay machinery from the store.** In `src/stores/browser.ts`, delete the interface block (`:30`–`:34`):
```ts
  // Track overlay count to hide WebView when popups/dialogs are open
  // Native child WebView always renders above HTML elements
  overlayCount: number
  pushOverlay: () => void
  popOverlay: () => void
```
and the implementation block (`:108`–`:110`):
```ts
  overlayCount: 0,
  pushOverlay: () => set((state) => ({ overlayCount: state.overlayCount + 1 })),
  popOverlay: () => set((state) => ({ overlayCount: Math.max(0, state.overlayCount - 1) })),
```

- [ ] **Step 2: Remove overlay use from the four drawers.** In each of `bookmark-drawer.tsx`, `browser-drawer.tsx`, `downloads-drawer.tsx`, `history-drawer.tsx`: drop `pushOverlay, popOverlay` from the `useBrowserStore()` destructure, and delete the overlay `useEffect`:
```tsx
  useEffect(() => {
    if (open) pushOverlay()
    else popOverlay()
  }, [open, pushOverlay, popOverlay])
```
(In `browser-drawer.tsx` this is the block under the `// Overlay management` comment at `:73`–`:77`; drop that comment too.)

- [ ] **Step 3: Remove overlay use from model-select.** In `src/app/core/main/chat/model-select.tsx`, delete the destructure (`:47`) `const { pushOverlay, popOverlay } = useBrowserStore()` and simplify `handleSetOpen` (`:49`–`:56`) to:
```tsx
  function handleSetOpen(isOpen: boolean) {
    setOpen(isOpen)
  }
```

- [ ] **Step 4: Drop the browser_show/hide call in page.tsx.** In `src/app/core/main/page.tsx`, replace the workspace-mode effect (`:128`–`:136`) with:
```tsx
  useEffect(() => {
    if (workspaceMode === 'browser') {
      useBrowserChatStore.getState().startNewConversation()
      emitter.emit('chat-input-reset', undefined)
    }
  }, [workspaceMode])
```

- [ ] **Step 5: Drop the browser_hide call + unused invoke import in layout.tsx.** In `src/app/core/layout.tsx`, delete the effect (`:134`–`:139`):
```tsx
  // 离开主页时隐藏浏览器 WebView
  useEffect(() => {
    if (pathname !== '/core/main') {
      invoke('browser_hide').catch(() => {})
    }
  }, [pathname])
```
and remove the now-unused import (`:32`) `import { invoke } from "@tauri-apps/api/core"`.

- [ ] **Step 6: Delete the bridge capability.**
```bash
git -C e:/source/note-gen rm src-tauri/capabilities/browser-bridge.json
```

- [ ] **Step 7: Grep gate — machinery fully gone.**
```bash
cd e:/source/note-gen
grep -rn "pushOverlay\|popOverlay\|overlayCount" src
# EXPECT: no matches
grep -rn "browser_show\|browser_hide" src
# EXPECT: no matches (Rust commands remain registered; only frontend calls removed)
```

- [ ] **Step 8: Lint + tsc + Rust build, expect PASS.**
```bash
pnpm -C e:/source/note-gen lint
pnpm -C e:/source/note-gen exec tsc --noEmit
cargo build --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
# EXPECT: all clean (removing one capability file is valid; commands stay registered)
```

- [ ] **Step 9: Commit.**
```bash
git -C e:/source/note-gen add -A src/stores/browser.ts \
  src/app/core/main/browser/bookmark-drawer.tsx \
  src/app/core/main/browser/browser-drawer.tsx \
  src/app/core/main/browser/downloads-drawer.tsx \
  src/app/core/main/browser/history-drawer.tsx \
  src/app/core/main/chat/model-select.tsx \
  src/app/core/main/page.tsx src/app/core/layout.tsx \
  src-tauri/capabilities/browser-bridge.json
git -C e:/source/note-gen commit -m "refactor(browser): drop vestigial show/hide + overlay + bridge capability

CDP content is a canvas — overlays render above it natively. Remove the
overlayCount/pushOverlay/popOverlay store machinery + all consumers, the
browser_show/hide frontend calls, and the unused browser-bridge.json
capability (it scoped the deleted native child webview labels).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Rename `BrowserWebView` to `BrowserHost` (CDP-accurate)

`browser-webview.tsx` is no longer a webview — it is the CDP event hub rendering the screencast canvas. Rename file + component to a name-accurate `BrowserHost`. Do this last so earlier tasks edit the file at its current path.

Files:
- Rename: `src/app/core/main/browser/browser-webview.tsx` → `src/app/core/main/browser/browser-host.tsx`
- Modify: `src/app/core/main/browser/index.tsx:5,54`
- Modify: `src/app/core/main/browser/browser-nav-bar.tsx:109` (stale comment)
- Test: tsc/lint + grep gate

- [ ] **Step 1: Move the file (preserve history).**
```bash
git -C e:/source/note-gen mv src/app/core/main/browser/browser-webview.tsx src/app/core/main/browser/browser-host.tsx
```

- [ ] **Step 2: Rename the component export.** In `src/app/core/main/browser/browser-host.tsx`, change the declaration:
```tsx
export function BrowserHost() {
```
(was `export function BrowserWebView()`). Also update the leading doc comment's first sentence to say `BrowserHost` instead of "This component".

- [ ] **Step 3: Update the importer.** In `src/app/core/main/browser/index.tsx`, change the import (`:5`):
```tsx
import { BrowserHost } from './browser-host'
```
and the usage (`:54`):
```tsx
      <BrowserHost />
```
(`<BrowserStatusBar />` from Task 6 stays directly below it.)

- [ ] **Step 4: Fix the stale comment in the nav bar.** In `src/app/core/main/browser/browser-nav-bar.tsx:109`, change the comment text `BrowserWebView 會在下個 tick…` to `BrowserHost 會在下個 tick…`.

- [ ] **Step 5: Grep gate — no `BrowserWebView` / `browser-webview` import references remain.**
```bash
cd e:/source/note-gen
grep -rn "BrowserWebView" src
# EXPECT: no matches
grep -rn "from './browser-webview'\|browser/browser-webview" src
# EXPECT: no matches (app-context-menu.tsx historical comments about the old
# native webview label may remain; they are not code references).
```

- [ ] **Step 6: Type-check + lint, expect PASS.**
```bash
pnpm -C e:/source/note-gen exec tsc --noEmit
pnpm -C e:/source/note-gen lint
# EXPECT: clean
```

- [ ] **Step 7: Full M5 verification sweep.**
```bash
pnpm -C e:/source/note-gen test:run
cargo test --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
cargo build --manifest-path e:/source/note-gen/src-tauri/Cargo.toml
# EXPECT: TS suite green (incl. zoom + frame helpers), Rust tests green
# (resolve_favicon, physical_caps, should_emit_frame), desktop build clean.
git -C e:/source/note-gen ls-files --eol src/app/core/main/browser/browser-host.tsx
# EXPECT: "w/lf" (LF endings only)
```

- [ ] **Step 8: Commit.**
```bash
git -C e:/source/note-gen add -A src/app/core/main/browser/browser-host.tsx \
  src/app/core/main/browser/index.tsx \
  src/app/core/main/browser/browser-nav-bar.tsx
git -C e:/source/note-gen commit -m "refactor(browser): rename BrowserWebView to BrowserHost

The component is the CDP event hub rendering the screencast canvas, not a
webview. Rename file + component for accuracy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> **Assumptions & notes for this milestone:**
> - browser-favicon-changed: the frontend listener already exists in browser-webview.tsx:131 and the tab favicon field/update_tab_meta plumbing exists; M5 only makes Rust actually emit it (resolve_favicon_url in cdp_events.rs). Keep the event name exactly 'browser-favicon-changed' across milestones.
> - Rust browser_toggle_devtools, browser_show, browser_hide commands are intentionally KEPT registered (in main.rs/lib.rs and both desktop+mobile impls) so the invoke_handler surface is unchanged; M5 only removes their FRONTEND call sites. Do not delete the Rust commands.
> - Verified the entire uncommitted delta of all 5 messages/*.json files is exactly the editor.loadFailed/loadFailedDesc pair (git diff --stat = 2 insertions each), so Task 1 can stage the whole message files safely. If executed out of order and a browser i18n key is still uncommitted, the Task 1 Step 1 gate catches it.
> - M5 adds NO new i18n keys: browser.zoomIn/zoomOut/zoomReset already exist in all 5 locale files (en.json:2081-2083).
> - Task ordering matters: Task 6 mounts the status bar and Task 7 edits browser-webview.tsx while it still has that name; Task 9 (rename to browser-host.tsx) MUST run last.
> - M6 owns the TS helpers src/lib/browser/{input-map,frame-decode,viewport}.ts and the Rust parse_devtools_endpoint fn — M5 deliberately does NOT create those. M5's pure fns (resolve_favicon_url, physical_caps, should_restart_screencast, should_emit_frame, zoomShortcutAction) have distinct names to avoid collision.
> - screencast_caps is a new CdpState field added only inside mod desktop; the mobile stub CdpState (unit struct) is untouched, preserving the cfg-gated command surface.
> - Trimmed BrowserStatusBar drops the extract/screenshot/clear cluster because those buttons already exist in BrowserNavBar (browser-nav-bar.tsx:264-280, :52-70); mounting the full original would create duplicate controls.


---

## Milestone 6: Tests (cross-cutting; extraction-driven so the logic becomes unit-testable)

Goal: lock the CDP-engine logic behind fast, deterministic tests by extracting the few genuinely-pure functions (`parse_devtools_endpoint`, `frame_from_metadata`, and the TS input/frame/viewport mappers) and characterizing the existing mappers, add a developer-only live-engine integration harness gated by `RUN_ENGINE_TESTS=1`, and bring `e2e/tauri-mock.ts` back in sync with the new command surface. No new Tauri commands, events, or i18n keys are introduced.

### Task 1: Rust pure-fn tests in `browser_engine.rs` + extract `parse_devtools_endpoint`

Files:
- Modify `src-tauri/src/browser_engine.rs:100-112` (replace the inline DevToolsActivePort line-parsing in `launch_chromium`)
- Modify `src-tauri/src/browser_engine.rs:153` (add `parse_devtools_endpoint` after `kill_pid_tree`)
- Modify `src-tauri/src/browser_engine.rs:270` (append `#[cfg(test)] mod tests` at end of file)
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing test module.** Append to the end of `src-tauri/src/browser_engine.rs` (after line 270):
```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> PathBuf {
        let uniq = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("ng-engine-{uniq}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parse_endpoint_happy() {
        let got = parse_devtools_endpoint("54321\n/devtools/browser/abc-123\n");
        assert_eq!(
            got,
            Some(("54321".to_string(), "/devtools/browser/abc-123".to_string()))
        );
    }

    #[test]
    fn parse_endpoint_trims_crlf_and_whitespace() {
        let got = parse_devtools_endpoint("  54321  \r\n  /devtools/browser/x  \r\n");
        assert_eq!(
            got,
            Some(("54321".to_string(), "/devtools/browser/x".to_string()))
        );
    }

    #[test]
    fn parse_endpoint_rejects_incomplete() {
        assert_eq!(parse_devtools_endpoint(""), None); // empty
        assert_eq!(parse_devtools_endpoint("54321"), None); // no path line
        assert_eq!(parse_devtools_endpoint("54321\n"), None); // path line empty
        assert_eq!(parse_devtools_endpoint("\n/devtools/browser/x"), None); // port empty
    }

    #[test]
    fn chromium_exe_names_nonempty_and_platform_specific() {
        let names = chromium_exe_names();
        assert!(!names.is_empty());
        assert!(names.iter().all(|n| !n.is_empty()));
        #[cfg(target_os = "windows")]
        assert!(names.iter().any(|n| n.eq_ignore_ascii_case("chrome.exe")));
        #[cfg(target_os = "macos")]
        assert!(names.iter().any(|n| *n == "Chromium"));
        #[cfg(all(unix, not(target_os = "macos")))]
        assert!(names.iter().any(|n| *n == "chrome"));
    }

    #[test]
    fn find_chromium_root_exe_wins_over_nested() {
        let root = tmp_dir();
        let name = chromium_exe_names()[0];
        let nested = root.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join(name), b"").unwrap();
        std::fs::write(root.join(name), b"").unwrap();
        let found = find_chromium_in_dir(&root).unwrap();
        assert_eq!(found, root.join(name));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_chromium_is_case_insensitive() {
        let root = tmp_dir();
        let upper = chromium_exe_names()[0].to_uppercase();
        std::fs::write(root.join(&upper), b"").unwrap();
        assert!(find_chromium_in_dir(&root).is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn find_chromium_respects_depth_limit() {
        let name = chromium_exe_names()[0];
        // depth 3 (root/a/b/c/<exe>) is reachable.
        let root3 = tmp_dir();
        let deep3 = root3.join("a").join("b").join("c");
        std::fs::create_dir_all(&deep3).unwrap();
        std::fs::write(deep3.join(name), b"").unwrap();
        assert!(find_chromium_in_dir(&root3).is_some(), "depth-3 exe should be found");
        let _ = std::fs::remove_dir_all(&root3);
        // depth 4 (root/a/b/c/d/<exe>) is out of range.
        let root4 = tmp_dir();
        let deep4 = root4.join("a").join("b").join("c").join("d");
        std::fs::create_dir_all(&deep4).unwrap();
        std::fs::write(deep4.join(name), b"").unwrap();
        assert!(find_chromium_in_dir(&root4).is_none(), "depth-4 exe should be out of range");
        let _ = std::fs::remove_dir_all(&root4);
    }

    #[test]
    fn resolve_byo_file_takes_precedence_over_downloaded() {
        let root = tmp_dir();
        let name = chromium_exe_names()[0];
        let exe = root.join(name);
        std::fs::write(&exe, b"").unwrap();
        let downloaded = tmp_dir(); // present but must be ignored when BYO is a file
        let got =
            resolve_engine_executable(Some(exe.to_str().unwrap()), Some(&downloaded)).unwrap();
        assert_eq!(got, exe);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&downloaded);
    }

    #[test]
    fn resolve_byo_dir_scans_for_exe() {
        let root = tmp_dir();
        let name = chromium_exe_names()[0];
        std::fs::write(root.join(name), b"").unwrap();
        let got = resolve_engine_executable(Some(root.to_str().unwrap()), None).unwrap();
        assert_eq!(got, root.join(name));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_missing_byo_path_errors() {
        let uniq = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let bogus = std::env::temp_dir().join(format!("ng-nope-{uniq}"));
        let err = resolve_engine_executable(Some(bogus.to_str().unwrap()), None).unwrap_err();
        assert!(err.contains("does not exist"), "unexpected error: {err}");
    }
}
```

- [ ] **Step 2: Run, expecting compile FAIL.** From the repo root:
```
cargo test --manifest-path src-tauri/Cargo.toml --lib parse_devtools_endpoint
```
Expected failure: `error[E0425]: cannot find function 'parse_devtools_endpoint' in this scope` (the other referenced fns already exist; only this one is missing).

- [ ] **Step 3: Add `parse_devtools_endpoint`.** Insert in `src-tauri/src/browser_engine.rs` immediately after the `kill_pid_tree` fn (after line 153):
```rust
/// Parse the two-line `DevToolsActivePort` file Chromium writes after launch:
/// line 1 is the chosen port, line 2 is the browser-level ws path
/// (e.g. `/devtools/browser/<guid>`). Returns `(port, path)` only when BOTH
/// lines are present and non-empty; otherwise `None` (file half-written/stale).
pub fn parse_devtools_endpoint(content: &str) -> Option<(String, String)> {
    let mut lines = content.lines();
    let port = lines.next()?.trim();
    let path = lines.next()?.trim();
    if port.is_empty() || path.is_empty() {
        return None;
    }
    Some((port.to_string(), path.to_string()))
}
```

- [ ] **Step 4: Refactor `launch_chromium` to use it.** Replace the inline parser at `src-tauri/src/browser_engine.rs:102-111`:
```rust
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            let mut lines = content.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                let port = port.trim();
                let path = path.trim();
                if !port.is_empty() && !path.is_empty() {
                    return Ok((child, format!("ws://127.0.0.1:{port}{path}")));
                }
            }
        }
```
with:
```rust
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            if let Some((port, path)) = parse_devtools_endpoint(&content) {
                return Ok((child, format!("ws://127.0.0.1:{port}{path}")));
            }
        }
```

- [ ] **Step 5: Run, expecting PASS.**
```
cargo test --manifest-path src-tauri/Cargo.toml --lib browser_engine::tests
```
Expected: all 9 tests pass (`test result: ok. 9 passed`).

- [ ] **Step 6: Commit.**
```
git add src-tauri/src/browser_engine.rs
git commit -m "test(browser): extract parse_devtools_endpoint and unit-test engine resolver"
```

### Task 2: Characterization tests for `browser.rs` mappers

Files:
- Modify `src-tauri/src/browser.rs:1047` (append `#[cfg(test)] mod tests` inside `mod desktop`, after `browser_engine_status`)
- Test: same file, `#[cfg(test)] mod tests` (drives `PendingNav::as_event_kind` at `browser.rs:59-68`, `CdpState::take_nav_kind` at `browser.rs:169-176`, `mouse_button` at `browser.rs:619-628`)

Note: these mappers already exist and are correct, so there is no red phase — the test passes on first run and locks current behavior. Verification is the green `cargo test` run in Step 2.

- [ ] **Step 1: Add the test module.** In `src-tauri/src/browser.rs`, inside `mod desktop`, immediately before its closing brace at line 1048 (i.e. right after the `browser_engine_status` command ends at line 1047):
```rust
    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn pending_nav_event_kinds() {
            assert_eq!(PendingNav::Back.as_event_kind(), "back");
            assert_eq!(PendingNav::Forward.as_event_kind(), "forward");
            assert_eq!(PendingNav::Navigate.as_event_kind(), "navigate");
            assert_eq!(PendingNav::Reload.as_event_kind(), "reload");
        }

        #[test]
        fn mouse_button_name_to_enum() {
            assert!(matches!(mouse_button("left"), MouseButton::Left));
            assert!(matches!(mouse_button("middle"), MouseButton::Middle));
            assert!(matches!(mouse_button("right"), MouseButton::Right));
            assert!(matches!(mouse_button("back"), MouseButton::Back));
            assert!(matches!(mouse_button("forward"), MouseButton::Forward));
            assert!(matches!(mouse_button("none"), MouseButton::None));
            assert!(matches!(mouse_button("bogus"), MouseButton::None));
        }

        #[tokio::test]
        async fn take_nav_kind_defaults_to_navigate_and_is_consumed() {
            let state = CdpState::new();
            // No pending intent for this target → default "navigate".
            assert_eq!(state.take_nav_kind("tab-1").await, "navigate");
            // A stored intent is reported once, then consumed.
            state.set_pending_nav("tab-1", PendingNav::Back).await;
            assert_eq!(state.take_nav_kind("tab-1").await, "back");
            assert_eq!(state.take_nav_kind("tab-1").await, "navigate");
        }
    }
```

- [ ] **Step 2: Run, expecting PASS.**
```
cargo test --manifest-path src-tauri/Cargo.toml --lib desktop::tests
```
Expected: `test result: ok. 3 passed`.

- [ ] **Step 3: Commit.**
```
git add src-tauri/src/browser.rs
git commit -m "test(browser): characterize PendingNav, take_nav_kind, and mouse_button mappers"
```

### Task 3: Extract `frame_from_metadata` in `cdp_screencast.rs` + unit test

Files:
- Modify `src-tauri/src/cdp_screencast.rs:17-20` (add `ScreencastFrameMetadata` to the page import)
- Modify `src-tauri/src/cdp_screencast.rs:51-65` (split `frame_from_event` into a pure `frame_from_metadata`)
- Modify `src-tauri/src/cdp_screencast.rs:120` (append `#[cfg(test)] mod tests`)
- Test: same file, `#[cfg(test)] mod tests`

- [ ] **Step 1: Write the failing test.** Append to the end of `src-tauri/src/cdp_screencast.rs` (after line 120):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chromiumoxide::cdp::browser_protocol::page::ScreencastFrameMetadata;

    #[test]
    fn frame_from_metadata_maps_fields_and_zeroes_timestamp() {
        let m = ScreencastFrameMetadata {
            offset_top: 12.0,
            page_scale_factor: 2.0,
            device_width: 800.0,
            device_height: 600.0,
            scroll_offset_x: 3.0,
            scroll_offset_y: 4.0,
            timestamp: None,
        };
        let f = frame_from_metadata("aGk=".to_string(), &m);
        assert_eq!(f.data_b64, "aGk=");
        assert_eq!(f.device_width, 800);
        assert_eq!(f.device_height, 600);
        assert_eq!(f.offset_top, 12.0);
        assert_eq!(f.page_scale_factor, 2.0);
        assert_eq!(f.scroll_offset_x, 3.0);
        assert_eq!(f.scroll_offset_y, 4.0);
        // The frontend never reads the CDP timestamp; we deliberately zero it.
        assert_eq!(f.timestamp, 0.0);
    }

    #[test]
    fn frame_from_metadata_truncates_fractional_device_dims_to_u32() {
        let m = ScreencastFrameMetadata {
            offset_top: 0.0,
            page_scale_factor: 1.0,
            device_width: 1366.9,
            device_height: 768.9,
            scroll_offset_x: 0.0,
            scroll_offset_y: 0.0,
            timestamp: None,
        };
        let f = frame_from_metadata(String::new(), &m);
        assert_eq!(f.device_width, 1366);
        assert_eq!(f.device_height, 768);
    }
}
```

- [ ] **Step 2: Run, expecting compile FAIL.**
```
cargo test --manifest-path src-tauri/Cargo.toml --lib cdp_screencast::tests
```
Expected failure: `error[E0425]: cannot find function 'frame_from_metadata' in this scope`.

- [ ] **Step 3: Add `ScreencastFrameMetadata` to the import.** Replace `src-tauri/src/cdp_screencast.rs:17-20`:
```rust
use chromiumoxide::cdp::browser_protocol::page::{
    EventScreencastFrame, ScreencastFrameAckParams, StartScreencastFormat, StartScreencastParams,
    StopScreencastParams,
};
```
with:
```rust
use chromiumoxide::cdp::browser_protocol::page::{
    EventScreencastFrame, ScreencastFrameAckParams, ScreencastFrameMetadata, StartScreencastFormat,
    StartScreencastParams, StopScreencastParams,
};
```

- [ ] **Step 4: Extract the pure mapper.** Replace `src-tauri/src/cdp_screencast.rs:51-65` (`fn frame_from_event`):
```rust
fn frame_from_event(ev: &EventScreencastFrame) -> ScreencastFrame {
    let m = &ev.metadata;
    ScreencastFrame {
        data_b64: binary_to_b64(&ev.data),
        device_width: m.device_width as u32,
        device_height: m.device_height as u32,
        offset_top: m.offset_top,
        page_scale_factor: m.page_scale_factor,
        scroll_offset_x: m.scroll_offset_x,
        scroll_offset_y: m.scroll_offset_y,
        // The frame metadata timestamp isn't used by the frontend; keep it 0.0
        // rather than depend on chromiumoxide's TimeSinceEpoch representation.
        timestamp: 0.0,
    }
}
```
with:
```rust
fn frame_from_event(ev: &EventScreencastFrame) -> ScreencastFrame {
    frame_from_metadata(binary_to_b64(&ev.data), &ev.metadata)
}

/// Pure mapper from CDP screencast metadata (+ the already-base64 payload) to the
/// frontend `ScreencastFrame`. Split out of `frame_from_event` so the field/cast
/// mapping is unit-testable without constructing a full `EventScreencastFrame`.
fn frame_from_metadata(data_b64: String, m: &ScreencastFrameMetadata) -> ScreencastFrame {
    ScreencastFrame {
        data_b64,
        device_width: m.device_width as u32,
        device_height: m.device_height as u32,
        offset_top: m.offset_top,
        page_scale_factor: m.page_scale_factor,
        scroll_offset_x: m.scroll_offset_x,
        scroll_offset_y: m.scroll_offset_y,
        // The frame metadata timestamp isn't used by the frontend; keep it 0.0
        // rather than depend on chromiumoxide's TimeSinceEpoch representation.
        timestamp: 0.0,
    }
}
```

- [ ] **Step 5: Run, expecting PASS.**
```
cargo test --manifest-path src-tauri/Cargo.toml --lib cdp_screencast::tests
```
Expected: `test result: ok. 2 passed`.

- [ ] **Step 6: Commit.**
```
git add src-tauri/src/cdp_screencast.rs
git commit -m "test(browser): extract frame_from_metadata and unit-test screencast mapping"
```

### Task 4: Extract `src/lib/browser/input-map.ts` + tests

Files:
- Create `src/lib/browser/input-map.ts`
- Test: Create `src/lib/browser/input-map.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/lib/browser/input-map.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  mods,
  buttonName,
  reduceClick,
  initialClickState,
  normalizeWheel,
} from './input-map'

describe('mods', () => {
  it('is 0 with no modifiers', () => {
    expect(mods({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(0)
  })
  it('maps Alt=1 Ctrl=2 Meta=4 Shift=8', () => {
    expect(mods({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false })).toBe(1)
    expect(mods({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(2)
    expect(mods({ altKey: false, ctrlKey: false, metaKey: true, shiftKey: false })).toBe(4)
    expect(mods({ altKey: false, ctrlKey: false, metaKey: false, shiftKey: true })).toBe(8)
  })
  it('ORs combinations', () => {
    expect(mods({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: true })).toBe(10)
    expect(mods({ altKey: true, ctrlKey: true, metaKey: true, shiftKey: true })).toBe(15)
  })
})

describe('buttonName', () => {
  it('maps PointerEvent.button to CDP names', () => {
    expect(buttonName(0)).toBe('left')
    expect(buttonName(1)).toBe('middle')
    expect(buttonName(2)).toBe('right')
    expect(buttonName(3)).toBe('back')
    expect(buttonName(4)).toBe('forward')
  })
  it('falls back to left for unknown', () => {
    expect(buttonName(5)).toBe('left')
    expect(buttonName(-1)).toBe('left')
  })
})

describe('reduceClick', () => {
  it('starts at count 1 from the initial state', () => {
    expect(reduceClick(initialClickState, { t: 1000, x: 10, y: 10 })).toEqual({
      t: 1000,
      x: 10,
      y: 10,
      count: 1,
    })
  })
  it('increments for same spot within 400ms', () => {
    const a = reduceClick(initialClickState, { t: 1000, x: 10, y: 10 })
    const b = reduceClick(a, { t: 1200, x: 12, y: 11 })
    expect(b.count).toBe(2)
    const c = reduceClick(b, { t: 1400, x: 11, y: 12 })
    expect(c.count).toBe(3)
  })
  it('resets when moved more than ~5px', () => {
    const a = reduceClick(initialClickState, { t: 1000, x: 10, y: 10 })
    const b = reduceClick(a, { t: 1100, x: 50, y: 10 })
    expect(b.count).toBe(1)
  })
  it('resets when slower than 400ms', () => {
    const a = reduceClick(initialClickState, { t: 1000, x: 10, y: 10 })
    const b = reduceClick(a, { t: 1500, x: 10, y: 10 })
    expect(b.count).toBe(1)
  })
})

describe('normalizeWheel', () => {
  const vp = { width: 800, height: 600 }
  it('passes pixel deltas through (deltaMode 0)', () => {
    expect(normalizeWheel({ deltaX: 3, deltaY: -7, deltaMode: 0 }, vp)).toEqual({
      deltaX: 3,
      deltaY: -7,
    })
  })
  it('scales line deltas by 16 (deltaMode 1)', () => {
    expect(normalizeWheel({ deltaX: 1, deltaY: 2, deltaMode: 1 }, vp)).toEqual({
      deltaX: 16,
      deltaY: 32,
    })
  })
  it('scales page deltas by the viewport (deltaMode 2)', () => {
    expect(normalizeWheel({ deltaX: 1, deltaY: 1, deltaMode: 2 }, vp)).toEqual({
      deltaX: 800,
      deltaY: 600,
    })
  })
})
```

- [ ] **Step 2: Run, expecting FAIL.**
```
pnpm test:run src/lib/browser/input-map.test.ts
```
Expected failure: `Failed to resolve import "./input-map"` (the module does not exist yet).

- [ ] **Step 3: Create the module.** Create `src/lib/browser/input-map.ts`:
```ts
// Pure input-mapping helpers extracted from BrowserScreencast so the modifier
// bitmask, button naming, multi-click counting, and wheel normalization are
// unit-testable in isolation.

export interface ModifierState {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

// CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
export function mods(e: ModifierState): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

// PointerEvent.button → CDP button name.
export function buttonName(b: number): string {
  return ['left', 'middle', 'right', 'back', 'forward'][b] ?? 'left'
}

export interface ClickState {
  t: number
  x: number
  y: number
  count: number
}

export const initialClickState: ClickState = { t: 0, x: 0, y: 0, count: 0 }

// Double/triple-click reducer: a press at the same spot (~5px) within 400ms of
// the previous one increments the counter; otherwise it resets to 1. Pure.
export function reduceClick(
  prev: ClickState,
  ev: { t: number; x: number; y: number },
): ClickState {
  const sameSpot =
    ev.t - prev.t < 400 && Math.abs(ev.x - prev.x) < 5 && Math.abs(ev.y - prev.y) < 5
  return { t: ev.t, x: ev.x, y: ev.y, count: sameSpot ? prev.count + 1 : 1 }
}

// Normalize wheel deltas to pixels. deltaMode 1 = lines (×16), 2 = pages
// (×viewport dimension); 0 = already pixels.
export function normalizeWheel(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  viewport: { width: number; height: number },
): { deltaX: number; deltaY: number } {
  let dx = e.deltaX
  let dy = e.deltaY
  if (e.deltaMode === 1) {
    dx *= 16
    dy *= 16
  } else if (e.deltaMode === 2) {
    dx *= viewport.width
    dy *= viewport.height
  }
  return { deltaX: dx, deltaY: dy }
}
```

- [ ] **Step 4: Run, expecting PASS.**
```
pnpm test:run src/lib/browser/input-map.test.ts
```
Expected: all describe blocks green (`Test Files 1 passed`).

- [ ] **Step 5: Commit.**
```
git add src/lib/browser/input-map.ts src/lib/browser/input-map.test.ts
git commit -m "test(browser): extract input-map helpers (mods, buttonName, reduceClick, normalizeWheel)"
```

### Task 5: Extract `src/lib/browser/frame-decode.ts` + tests

Files:
- Create `src/lib/browser/frame-decode.ts`
- Test: Create `src/lib/browser/frame-decode.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/lib/browser/frame-decode.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { decodeFrameBytes } from './frame-decode'

describe('decodeFrameBytes', () => {
  it('decodes a base64 ASCII string to bytes', () => {
    // btoa('ABC') === 'QUJD'
    expect(Array.from(decodeFrameBytes('QUJD'))).toEqual([65, 66, 67])
  })

  it('returns an empty Uint8Array for empty input', () => {
    const out = decodeFrameBytes('')
    expect(out).toBeInstanceOf(Uint8Array)
    expect(out.length).toBe(0)
  })

  it('round-trips arbitrary byte values via btoa', () => {
    const bytes = [0, 1, 127, 128, 200, 255]
    const b64 = btoa(String.fromCharCode(...bytes))
    expect(Array.from(decodeFrameBytes(b64))).toEqual(bytes)
  })

  it('preserves length for a JPEG SOI marker', () => {
    // 0xFF 0xD8 0xFF are the first JPEG bytes.
    const b64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff))
    const out = decodeFrameBytes(b64)
    expect(out.length).toBe(3)
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
  })
})
```

- [ ] **Step 2: Run, expecting FAIL.**
```
pnpm test:run src/lib/browser/frame-decode.test.ts
```
Expected failure: `Failed to resolve import "./frame-decode"`.

- [ ] **Step 3: Create the module.** Create `src/lib/browser/frame-decode.ts`:
```ts
// Decode a base64 screencast frame payload into raw bytes. The JPEG decode step
// (createImageBitmap) isn't available/testable in jsdom, but the base64→bytes
// conversion is — so it lives here, extracted from BrowserScreencast.
export function decodeFrameBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
```

- [ ] **Step 4: Run, expecting PASS.**
```
pnpm test:run src/lib/browser/frame-decode.test.ts
```
Expected: `Test Files 1 passed`.

- [ ] **Step 5: Commit.**
```
git add src/lib/browser/frame-decode.ts src/lib/browser/frame-decode.test.ts
git commit -m "test(browser): extract decodeFrameBytes base64 frame decoder"
```

### Task 6: Extract `src/lib/browser/viewport.ts` + tests

Files:
- Create `src/lib/browser/viewport.ts`
- Test: Create `src/lib/browser/viewport.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/lib/browser/viewport.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { physicalCaps } from './viewport'

describe('physicalCaps', () => {
  it('multiplies CSS size by dpr', () => {
    expect(physicalCaps({ width: 800, height: 600 }, 2)).toEqual({ width: 1600, height: 1200 })
  })

  it('floors fractional results', () => {
    expect(physicalCaps({ width: 800, height: 600 }, 1.5)).toEqual({ width: 1200, height: 900 })
    expect(physicalCaps({ width: 100.7, height: 50.2 }, 1)).toEqual({ width: 100, height: 50 })
  })

  it('treats dpr<=0 as 1', () => {
    expect(physicalCaps({ width: 640, height: 480 }, 0)).toEqual({ width: 640, height: 480 })
    expect(physicalCaps({ width: 640, height: 480 }, -2)).toEqual({ width: 640, height: 480 })
  })

  it('clamps to a minimum of 1 (CDP maxWidth/maxHeight must be >=1)', () => {
    expect(physicalCaps({ width: 0.4, height: 0.4 }, 1)).toEqual({ width: 1, height: 1 })
  })
})
```

- [ ] **Step 2: Run, expecting FAIL.**
```
pnpm test:run src/lib/browser/viewport.test.ts
```
Expected failure: `Failed to resolve import "./viewport"`.

- [ ] **Step 3: Create the module.** Create `src/lib/browser/viewport.ts`:
```ts
// Physical (device-pixel) screencast caps from CSS size × devicePixelRatio.
// Mirrors the Rust apply_viewport math: dpr<=0 falls back to 1, the result is
// floored and clamped to at least 1 (CDP maxWidth/maxHeight must be >=1).
export function physicalCaps(
  css: { width: number; height: number },
  dpr: number,
): { width: number; height: number } {
  const scale = dpr > 0 ? dpr : 1
  return {
    width: Math.max(1, Math.floor(css.width * scale)),
    height: Math.max(1, Math.floor(css.height * scale)),
  }
}
```

- [ ] **Step 4: Run, expecting PASS.**
```
pnpm test:run src/lib/browser/viewport.test.ts
```
Expected: `Test Files 1 passed`.

- [ ] **Step 5: Commit.**
```
git add src/lib/browser/viewport.ts src/lib/browser/viewport.test.ts
git commit -m "test(browser): extract physicalCaps viewport helper"
```

### Task 7: Wire `browser-screencast.tsx` onto the extracted helpers

Files:
- Modify `src/app/core/main/browser/browser-screencast.tsx:3-5` (imports)
- Modify `src/app/core/main/browser/browser-screencast.tsx:20-28` (remove inline `mods`/`buttonName`)
- Modify `src/app/core/main/browser/browser-screencast.tsx:40` (`lastClickRef` type/init)
- Modify `src/app/core/main/browser/browser-screencast.tsx:56-58` (use `decodeFrameBytes`)
- Modify `src/app/core/main/browser/browser-screencast.tsx:133-142` (use `normalizeWheel`)
- Modify `src/app/core/main/browser/browser-screencast.tsx:164-173` (use `reduceClick`)
- Verification: `pnpm test:run`, `pnpm exec tsc --noEmit`, `pnpm lint`

This task removes the duplicated inline logic so the helpers are the single source of truth. There is no isolated unit test for the component (it depends on the Tauri runtime + canvas); the gate is that the extracted-helper tests still pass and the file type-checks and lints clean after the swap.

- [ ] **Step 1: Add the helper imports.** Replace `src/app/core/main/browser/browser-screencast.tsx:3-5`:
```tsx
import { useEffect, useRef } from 'react'
import { invoke, Channel } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
```
with:
```tsx
import { useEffect, useRef } from 'react'
import { invoke, Channel } from '@tauri-apps/api/core'
import { useTranslations } from 'next-intl'
import {
  mods,
  buttonName,
  reduceClick,
  initialClickState,
  normalizeWheel,
  type ClickState,
} from '@/lib/browser/input-map'
import { decodeFrameBytes } from '@/lib/browser/frame-decode'
```

- [ ] **Step 2: Delete the inline `mods` and `buttonName`.** Remove `src/app/core/main/browser/browser-screencast.tsx:20-28`:
```tsx
// CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8.
function mods(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

// PointerEvent.button → CDP button name.
function buttonName(b: number): string {
  return ['left', 'middle', 'right', 'back', 'forward'][b] ?? 'left'
}
```
(delete the whole block; the imports now provide both).

- [ ] **Step 3: Use the shared `ClickState` for the ref.** Replace `src/app/core/main/browser/browser-screencast.tsx:40`:
```tsx
  const lastClickRef = useRef<{ t: number; x: number; y: number; count: number }>({ t: 0, x: 0, y: 0, count: 0 })
```
with:
```tsx
  const lastClickRef = useRef<ClickState>(initialClickState)
```

- [ ] **Step 4: Decode frames via the helper.** Replace `src/app/core/main/browser/browser-screencast.tsx:56-58`:
```tsx
        const bin = atob(frame.dataB64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
```
with:
```tsx
        const bytes = decodeFrameBytes(frame.dataB64)
```

- [ ] **Step 5: Normalize wheel deltas via the helper.** Replace `src/app/core/main/browser/browser-screencast.tsx:133-149` (the delta block + the invoke):
```tsx
      // Normalize line/page deltas to pixels.
      let dx = e.deltaX
      let dy = e.deltaY
      if (e.deltaMode === 1) {
        dx *= 16
        dy *= 16
      } else if (e.deltaMode === 2) {
        dx *= r.width
        dy *= r.height
      }
      invoke('browser_input_wheel', {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        deltaX: dx,
        deltaY: dy,
        modifiers: mods(e),
      }).catch(() => {})
```
with:
```tsx
      const { deltaX: dx, deltaY: dy } = normalizeWheel(e, { width: r.width, height: r.height })
      invoke('browser_input_wheel', {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        deltaX: dx,
        deltaY: dy,
        modifiers: mods(e),
      }).catch(() => {})
```

- [ ] **Step 6: Use `reduceClick` for the multi-click counter.** Replace `src/app/core/main/browser/browser-screencast.tsx:165-184` (the click-count block + invoke):
```tsx
    // click-count: same button within 400ms and ~5px → increment (double/triple).
    const now = e.timeStamp
    const lc = lastClickRef.current
    if (now - lc.t < 400 && Math.abs(x - lc.x) < 5 && Math.abs(y - lc.y) < 5) {
      lc.count += 1
    } else {
      lc.count = 1
    }
    lc.t = now
    lc.x = x
    lc.y = y
    invoke('browser_input_mouse', {
      kind: 'down',
      x,
      y,
      button: buttonName(e.button),
      buttons: e.buttons,
      clickCount: lc.count,
      modifiers: mods(e),
    }).catch(() => {})
```
with:
```tsx
    // click-count: same button within 400ms and ~5px → increment (double/triple).
    const next = reduceClick(lastClickRef.current, { t: e.timeStamp, x, y })
    lastClickRef.current = next
    invoke('browser_input_mouse', {
      kind: 'down',
      x,
      y,
      button: buttonName(e.button),
      buttons: e.buttons,
      clickCount: next.count,
      modifiers: mods(e),
    }).catch(() => {})
```

- [ ] **Step 7: Verify (tests + types + lint).**
```
pnpm test:run src/lib/browser && pnpm exec tsc --noEmit && pnpm lint
```
Expected: all `src/lib/browser` test files pass, `tsc` prints nothing (exit 0), and `pnpm lint` reports no errors for `browser-screencast.tsx` (in particular no unused `atob`/duplicate-function warnings).

- [ ] **Step 8: Commit.**
```
git add src/app/core/main/browser/browser-screencast.tsx
git commit -m "refactor(browser): consume extracted input-map and frame-decode helpers in screencast"
```

### Task 8: Gated live-engine integration harness `src-tauri/tests/engine_integration.rs`

Files:
- Modify `src-tauri/src/lib.rs:12-13` (make `browser_engine` a `pub mod` so the integration crate can reach it)
- Modify `src-tauri/Cargo.toml:66` (add desktop-gated `[dev-dependencies]` for the harness)
- Create `src-tauri/tests/engine_integration.rs`
- Verification: `cargo test ... --test engine_integration --no-run` (compile gate); manual run documented

The harness needs a real, no-redistribution CloakBrowser binary, so it is `#[ignore]` AND early-returns unless `RUN_ENGINE_TESTS=1` (double gate: even `cargo test -- --ignored` in CI won't launch a browser). The deterministic gate here is that it COMPILES; running it is a developer step.

- [ ] **Step 1: Expose `browser_engine` from the lib crate.** Replace `src-tauri/src/lib.rs:12-13`:
```rust
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod browser_engine;
```
with:
```rust
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod browser_engine;
```

- [ ] **Step 2: Add desktop-gated dev-dependencies.** Append to `src-tauri/Cargo.toml` (after line 66, the `base64 = "0.22"` line that closes the desktop dependency block):
```toml
# Dev-only deps for the gated live-engine integration harness in tests/.
# Duplicating the desktop runtime crates here guarantees the integration test
# crate can name them regardless of normal-vs-dev dependency resolution.
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dev-dependencies]
chromiumoxide = "0.9"
futures-util = "0.3"
tokio = { version = "1", features = ["full"] }
```

- [ ] **Step 3: Create the harness.** Create `src-tauri/tests/engine_integration.rs`:
```rust
//! Live-engine integration harness for the CDP browser engine.
//!
//! Requires a real CloakBrowser/Chromium (resolved from ./engine, ../engine,
//! or $CLOAKBROWSER_BINARY_PATH). Because that binary is no-redistribution it
//! never runs in CI: every test is `#[ignore]` AND bails unless RUN_ENGINE_TESTS=1.
//!
//! Run manually:
//!   RUN_ENGINE_TESTS=1 cargo test --manifest-path src-tauri/Cargo.toml \
//!       --test engine_integration -- --ignored --nocapture
#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::time::Duration;

use chromiumoxide::cdp::browser_protocol::input::InsertTextParams;
use chromiumoxide::cdp::browser_protocol::page::{
    EventScreencastFrame, NavigateParams, ScreencastFrameAckParams, StartScreencastFormat,
    StartScreencastParams,
};
use chromiumoxide::{Browser, Page};
use futures_util::StreamExt;

use tauri_app_lib::browser_engine::{kill_engine, launch_chromium, resolve_engine_executable};

fn gated() -> bool {
    std::env::var("RUN_ENGINE_TESTS").is_ok()
}

fn unique_profile() -> std::path::PathBuf {
    let uniq = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("ng-it-{uniq}"))
}

#[cfg(windows)]
fn is_process_alive(pid: u32) -> bool {
    let out = std::process::Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .expect("tasklist");
    String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
}

#[cfg(unix)]
fn is_process_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn current_url(page: &Page) -> String {
    page.evaluate("location.href")
        .await
        .ok()
        .and_then(|r| r.into_value::<String>().ok())
        .unwrap_or_default()
}

/// Launch + connect, returning the child, the connected Browser, and the profile
/// dir. Returns None when gating is off or no engine is installed.
async fn boot() -> Option<(tokio::process::Child, Browser, std::path::PathBuf)> {
    if !gated() {
        return None;
    }
    let exe = match resolve_engine_executable(None, None) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[engine_integration] skipping — no engine: {e}");
            return None;
        }
    };
    let profile = unique_profile();
    let (child, ws) = launch_chromium(&exe, &profile, "about:blank")
        .await
        .expect("launch_chromium");
    assert!(ws.starts_with("ws://127.0.0.1:"), "unexpected ws url: {ws}");
    let (browser, mut handler) = Browser::connect(ws).await.expect("Browser::connect");
    tokio::spawn(async move {
        while let Some(h) = handler.next().await {
            if h.is_err() {
                break;
            }
        }
    });
    Some((child, browser, profile))
}

async fn teardown(mut child: tokio::process::Child, browser: Browser, profile: std::path::PathBuf) {
    drop(browser);
    kill_engine(&mut child).await;
    let _ = std::fs::remove_dir_all(&profile);
}

#[ignore = "requires RUN_ENGINE_TESTS=1 and a real CloakBrowser binary"]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn launch_connect_navigate_and_input_round_trip() {
    let Some((child, browser, profile)) = boot().await else {
        return;
    };

    // navigate → url change.
    let page = browser
        .new_page("about:blank")
        .await
        .expect("new_page");
    page.execute(NavigateParams::new("https://example.com/".to_string()))
        .await
        .expect("navigate");
    let mut url = String::new();
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(200)).await;
        url = current_url(&page).await;
        if url.contains("example.com") {
            break;
        }
    }
    assert!(url.contains("example.com"), "url did not change: {url}");

    // input round-trip via Input.insertText (the browser_input_text path).
    let form = browser
        .new_page("data:text/html,<input id=i>")
        .await
        .expect("new_page form");
    form.evaluate("document.getElementById('i').focus()")
        .await
        .expect("focus");
    form.execute(InsertTextParams::new("héllo 測試"))
        .await
        .expect("insertText");
    let value = form
        .evaluate("document.getElementById('i').value")
        .await
        .expect("read value")
        .into_value::<String>()
        .expect("value string");
    assert_eq!(value, "héllo 測試");

    teardown(child, browser, profile).await;
}

#[ignore = "requires RUN_ENGINE_TESTS=1 and a real CloakBrowser binary"]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn screencast_emits_multiple_frames_within_timeout() {
    const N: usize = 5;
    const T: Duration = Duration::from_secs(5);
    let Some((child, browser, profile)) = boot().await else {
        return;
    };
    let page = browser
        .new_page("https://example.com/")
        .await
        .expect("new_page");

    // Register the listener BEFORE starting (no first-frame race).
    let mut frames = page
        .event_listener::<EventScreencastFrame>()
        .await
        .expect("listen");
    page.execute(
        StartScreencastParams::builder()
            .format(StartScreencastFormat::Jpeg)
            .quality(60)
            .every_nth_frame(1)
            .build(),
    )
    .await
    .expect("startScreencast");

    let deadline = tokio::time::Instant::now() + T;
    let mut count = 0usize;
    while count < N {
        match tokio::time::timeout_at(deadline, frames.next()).await {
            Ok(Some(f)) => {
                // ACK every frame or Chromium stalls after the first (the bug we guard).
                let _ = page
                    .execute(ScreencastFrameAckParams::new(f.session_id))
                    .await;
                count += 1;
            }
            _ => break,
        }
    }
    assert!(count >= N, "only {count} frames in {T:?} — screencast froze");

    teardown(child, browser, profile).await;
}

#[ignore = "requires RUN_ENGINE_TESTS=1 and a real CloakBrowser binary"]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relaunch_reaps_previous_engine_and_clears_singleton_lock() {
    if !gated() {
        return;
    }
    let exe = match resolve_engine_executable(None, None) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[engine_integration] skipping — no engine: {e}");
            return;
        }
    };
    let profile = unique_profile();

    // First launch; leak the Child so kill_on_drop does NOT reap it — this
    // simulates a Rust crash that orphaned the engine (the 25-zombie pitfall).
    let (child1, _ws1) = launch_chromium(&exe, &profile, "about:blank")
        .await
        .expect("first launch");
    let pid1 = child1.id().expect("pid1");
    assert!(is_process_alive(pid1), "engine should be running after launch");
    std::mem::forget(child1);

    // Second launch with the SAME profile must kill pid1's tree (via engine.pid)
    // and clear the stale Singleton lock before connecting.
    let (mut child2, _ws2) = launch_chromium(&exe, &profile, "about:blank")
        .await
        .expect("relaunch");

    let mut reaped = false;
    for _ in 0..20 {
        if !is_process_alive(pid1) {
            reaped = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(reaped, "previous engine pid {pid1} was not reaped on relaunch");
    assert!(
        !profile.join("SingletonLock").exists(),
        "stale SingletonLock was not removed"
    );

    kill_engine(&mut child2).await;
    let _ = std::fs::remove_dir_all(&profile);
}
```

- [ ] **Step 4: Verify it compiles (deterministic gate).**
```
cargo test --manifest-path src-tauri/Cargo.toml --test engine_integration --no-run
```
Expected: builds successfully (`Finished test [unoptimized + debuginfo]`) and does NOT launch a browser. Confirm the three tests are listed but skipped under a normal `cargo test --manifest-path src-tauri/Cargo.toml` run (they are `#[ignore]`).

- [ ] **Step 5: Commit.**
```
git add src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/tests/engine_integration.rs
git commit -m "test(browser): add gated live-engine integration harness (launch, screencast, input, zombie reaping)"
```

### Task 9: Re-sync `e2e/tauri-mock.ts` and retire `google-ua-verify.spec.ts`

Files:
- Modify `e2e/tauri-mock.ts:55-66` (drop the stale `browser_open_devtools`; add the new engine/screencast/input commands)
- Delete `e2e/google-ua-verify.spec.ts`
- Verification: deterministic `rg` assertions + a headless e2e boot of `browser-ui.spec.ts`

Disposition of `e2e/google-ua-verify.spec.ts`: it asserts that "the User-Agent we set in `src-tauri/src/browser.rs`" passes Google's anti-bot screen, but the CDP rewrite of `browser.rs` no longer sets any UA (stealth is baked into the CloakBrowser binary), and Playwright drives vanilla Chromium — not CloakBrowser — so a pass/fail here is a false signal about the shipped engine's stealth. It is therefore DELETED; stealth/detection is now exercised against the real engine by the gated `engine_integration.rs` navigate path (Task 8) and remains a manual concern per the design's stealth-regression note.

- [ ] **Step 1: Update the mock command table.** Replace `e2e/tauri-mock.ts:55-66`:
```ts
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
```
with:
```ts
      browser_toggle_devtools: () => false,
      browser_clear_data: () => undefined,
      browser_inject_context_menu: () => undefined,
      browser_navigate: () => undefined,
      browser_go_back: () => undefined,
      browser_go_forward: () => undefined,
      browser_reload: () => undefined,
      browser_create: () => undefined,
      browser_get_url: () => 'https://example.com',
      browser_get_title: () => 'Example',
      browser_get_selected_text: () => '',
      // Screencast + synthesized input surface (CDP engine).
      browser_start_screencast: () => undefined,
      browser_stop_screencast: () => undefined,
      browser_set_viewport: () => undefined,
      browser_input_mouse: () => undefined,
      browser_input_wheel: () => undefined,
      browser_input_key: () => undefined,
      // browser_input_text → Input.insertText (IME commit / paste), added in M3.
      browser_input_text: () => undefined,
      // Engine delivery + status (M1). Report "installed" so the panel renders
      // instead of the not-installed empty state under the mock.
      browser_engine_status: () => ({ installed: true, source: 'byo', exe_path: '/mock/cloakbrowser' }),
      browser_engine_set_path: () => undefined,
      browser_engine_download: () => undefined,
```

- [ ] **Step 2: Delete the stale spec.**
```
git rm e2e/google-ua-verify.spec.ts
```

- [ ] **Step 3: Verify the surface (deterministic).**
```
rg -n "browser_open_devtools|google-ua-verify" e2e ; rg -n "browser_input_text|browser_engine_download|browser_start_screencast" e2e/tauri-mock.ts
```
Expected: the first `rg` prints nothing and exits non-zero (no matches — both removed); the second prints the three new mock entries.

- [ ] **Step 4: Verify the panel still boots against the updated mock.**
```
PLAYWRIGHT_HEADLESS=1 PLAYWRIGHT_SLOWMO=0 pnpm e2e e2e/browser-ui.spec.ts
```
Expected: all `Browser panel UI (Tauri mocked)` tests pass (panel boots, title-bar tab strip renders 2 tabs, URL bar mirrors example.com) — confirming the removed/added commands didn't break the boot path.

- [ ] **Step 5: Commit.**
```
git add e2e/tauri-mock.ts
git commit -m "test(e2e): sync tauri-mock with CDP command surface; remove stale google-ua spec"
```

> **Assumptions & notes for this milestone:**
> - No new Tauri commands, Rust->frontend events, or i18n keys are introduced by M6 — it is purely test/extraction work, so messages/*.json are untouched.
> - New pure Rust fn introduced: browser_engine::parse_devtools_endpoint(&str) -> Option<(String,String)> (matches the shared contract), plus a private frame_from_metadata extracted in cdp_screencast.rs.
> - lib.rs is changed from `mod browser_engine` to `pub mod browser_engine` so the integration crate can call resolve_engine_executable/launch_chromium/kill_engine/parse_devtools_endpoint via `tauri_app_lib::browser_engine`; main.rs is left unchanged (it links its own private modules).
> - Task 2 (browser.rs mappers) has no red phase: PendingNav::as_event_kind, take_nav_kind and mouse_button already exist, so the test is a green-on-first-run characterization lock — this is called out explicitly in the task.
> - The TS helper signatures (mods, buttonName, reduceClick/ClickState, normalizeWheel in input-map.ts; decodeFrameBytes in frame-decode.ts; physicalCaps in viewport.ts) are the ones M3 (IME/paste input wiring) and M5 (screencast tuning/viewport) will import — keep them stable.
> - The integration harness is double-gated (#[ignore] + RUN_ENGINE_TESTS env check) and verified only by `--no-run` compilation in normal flow; the real run needs a no-redistribution CloakBrowser binary in ./engine, ../engine, or $CLOAKBROWSER_BINARY_PATH.
> - google-ua-verify.spec.ts is deleted (not repurposed): Playwright's vanilla Chromium can't exercise CloakBrowser's compiled-in stealth and the CDP browser.rs no longer sets a UA, so the test gave a false signal; stealth is now a real-engine concern handled by the gated harness.
> - e2e/tauri-mock.ts gains browser_input_text (M3) and browser_engine_status/set_path/download (M1) plus the already-shipped screencast/input commands; browser_engine_status returns installed:true so the mocked panel renders rather than M1's not-installed empty state.
> - If a future milestone wires physicalCaps into the frontend viewport reporting, viewport.ts is already the shared source; today it is exported and unit-tested but not yet consumed by browser-screencast.tsx (Rust still computes physical caps server-side).


---

## Execution

Implement milestones in order M1 -> M6 (M6 test-extraction tasks may interleave with the milestone they cover). Use **superpowers:subagent-driven-development** (fresh subagent per task + review) or **superpowers:executing-plans** (batch with checkpoints). After every file write/edit, verify LF: `tr -cd '\r' < FILE | wc -c` must print 0.
