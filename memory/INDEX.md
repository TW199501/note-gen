# memory/ — Project-level deep-dive notes

This directory holds detail that's too heavy for `CLAUDE.md` but still important for anyone (human or Claude) working in this repo. CLAUDE.md is the slim entry point; this is the long-form annex.

Keep CLAUDE.md ≤ 200 lines (Anthropic guidance). When a section grows past ~5 dense bullets, extract it here and leave a 1-3 line summary + pointer in CLAUDE.md.

## Files

- [browser-architecture.md](browser-architecture.md) — In-app Browser (bundled Chromium child process + owner-overlay) deep-dive: Win32 mechanics, EnumWindows discovery, path resolution, dev/packaged distinction
- [browser-rejected-approaches.md](browser-rejected-approaches.md) — Seven approaches tried-and-rejected for the in-app browser (CDP, SetParent, WebView2, CloakBrowser, noVNC, raw browser_host, CEF Views). Don't re-propose without reading this first
- [gotchas.md](gotchas.md) — Backstories behind the LF / port 31415 / sidecar zombie / static-export / TS-Server-flooding gotchas; CLAUDE.md just lists the rules, the WHY lives here

## Conventions

- Files use plain Markdown (no YAML frontmatter)
- One topic per file; if a file grows past ~300 lines, split it
- Cross-references use relative paths (e.g., `[link](other-file.md)`)
- Past-tense incidents are fine here (CLAUDE.md is for forward-looking rules)
