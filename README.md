# NovaSVN

English | [简体中文](README.zh-CN.md)

[![CI](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml/badge.svg)](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

**NovaSVN** is an open-source desktop Subversion client for **Windows** and **macOS**.

It brings everyday SVN work into one native app: working-copy status, timeline/history, repository browser, merge preview, patches, and shell integrations — powered by the real `svn` CLI rather than a reimplemented protocol stack.

> **Status:** `0.1.0` is a **development preview**. NovaSVN runs real SVN commands against local working copies and remote repositories. Always review paths, revisions, and pending changes before destructive operations.

---

## Why NovaSVN?

| | |
| --- | --- |
| **Native desktop** | Built with [Tauri](https://tauri.app/) + Rust + Svelte for a lightweight, native feel |
| **Real SVN** | Wraps the official Subversion CLI you already trust and configure |
| **Daily workflow** | Status, commit, update, log, diff, blame, merge, patch, export, and more |
| **Shell integration** | Standalone windows from Windows Explorer / macOS Finder |
| **Open source** | MIT licensed — inspect, fork, and contribute |

If you maintain SVN projects and want a modern UI without leaving the `svn` toolchain, NovaSVN is for you.

---

## Features

### Working copy

- Scan local and remote changes with a compact file table (status, revision, author, size, …)
- Multi-select, tree navigation, and bulk commit / revert / move / delete
- Diff (text, encoding-aware, image), Blame, Properties, and changelists
- Themes: light, dark, or follow system

### History & timeline

- Load, filter, and paginate repository logs
- Highlight the current working-copy revision
- Diff changed paths, compare revisions, revert selected revisions
- **Export a path at a given revision** (no `.svn` metadata)

### Repository browser

- Browse HEAD or a historical revision
- Log, Blame, Properties, Checkout, Export, Import, Mkdir, Copy, Move, Rename, Delete
- Drag entries out to the file manager after a real export

### Merge, patch & partial commit

- Merge with dry-run preview and a dedicated merge-preview window
- Apply / generate patches; commit selected files without a Git-style staging area
- Text conflict resolution helpers

### Desktop integration

Standalone windows (Log, Update, Commit, Revert, Clean Up, Checkout, Repo Browser, Blame, Info, conflict tools) from:

- Windows Explorer context menus (installer-registered)
- macOS Finder Quick Actions / Finder Sync (see packaging scripts)

CLI-style launches are also supported, e.g. `--novasvn-action browse`.

---

## Requirements

### To run

| Requirement | Notes |
| --- | --- |
| OS | Windows 10+ or recent macOS |
| Subversion CLI | `svn` on `PATH`, or set the executable path in NovaSVN settings |
| Access | Credentials / certificate trust as required by your repositories |

### To build from source

| Requirement | Notes |
| --- | --- |
| [Node.js](https://nodejs.org/) | 24 recommended (matches CI) |
| [Rust](https://rustup.rs/) | Stable toolchain + Cargo |
| [Tauri 2](https://v2.tauri.app/start/prerequisites/) | Platform system dependencies |
| Subversion CLI | Needed for integration tests and local SVN workflows |

---

## Install

### Prebuilt packages

Build artifacts locally (see [Packaging](#packaging)), or use GitHub [Releases](https://github.com/wuchunpeng777/NovaSVN/releases) when published.

Typical outputs after a release build:

| Platform | Artifact |
| --- | --- |
| Windows | `src-tauri/target/release/bundle/nsis/NovaSVN_*_x64-setup.exe` |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` |

### From source (development)

```bash
git clone https://github.com/wuchunpeng777/NovaSVN.git
cd NovaSVN
npm ci
npm run tauri:dev
```

Frontend-only browser preview (no native FS / SVN / shell integration):

```bash
npm run dev
```

---

## Development

### Useful scripts

| Command | Purpose |
| --- | --- |
| `npm run tauri:dev` | Full desktop app in dev mode |
| `npm run dev` | Frontend only (Vite) |
| `npm run build` | Typecheck + production frontend build |
| `npm run check` | Same combined quality gate as CI |
| `npm run test:components` | Vitest (Svelte / TS) |
| `npm run test:rust` | Rust unit tests |
| `npm run lint:rust` | Clippy (`-D warnings`) |
| `npm run test:e2e` | Playwright end-to-end |
| `npm run test:scripts` | Package / release script self-tests |

### Real SVN workflow tests

These create temporary local repositories (Windows PowerShell scripts):

```powershell
npm run test:svn
npm run test:svn:partial
```

### Project layout

```text
src/                 Svelte + TypeScript UI
src-tauri/           Rust backend, Tauri config, shell extensions
  windows-shell-extension/   Windows Explorer integration
  macos-finder-sync/         macOS Finder Sync extension sources
tests/e2e/           Playwright tests
scripts/             Release, SVN workflow, and benchmark helpers
.github/workflows/   CI
```

### Tech stack

- **UI:** Svelte 5, TypeScript, Vite, Monaco Editor  
- **Desktop:** Tauri 2  
- **Backend:** Rust (`svn` process orchestration, tasks, workspace logic)  
- **Tests:** Vitest, Playwright, Cargo tests, PowerShell SVN workflow scripts  

---

## Packaging

### Windows (NSIS)

```powershell
npm run release:windows
```

Produces an installer under `src-tauri/target/release/bundle/nsis/`.

### macOS

```bash
# Local DMG
npm run release:macos

# Notarized release (Developer ID + notary profile required)
npm run release:macos:notarized
```

Version strings are kept in sync via:

```bash
npm run version:check
npm run version:sync   # if you need to align versions after a bump
```

---

## Contributing

Contributions are welcome.

1. Fork the repository and create a feature branch from `main`.
2. Keep changes focused; match existing code style and test patterns.
3. Run `npm run check` (and relevant focused tests) before opening a PR.
4. Describe the user-visible behavior and any risk to working copies / remotes.

### Reporting issues

Please include:

- OS and NovaSVN version  
- `svn --version`  
- What you were doing (steps to reproduce)  
- Relevant logs or error text  

**Do not paste passwords, tokens, or private repository URLs.** Redact secrets before posting.

---

## Safety notes

- NovaSVN executes **real** `svn` commands (commit, delete, merge, switch, export, …).  
- Double-check **target path**, **URL**, and **revision** before confirming.  
- Prefer dry-run / preview flows for merge when available.  
- Development preview software may still change behavior between releases — check `git log` for recent changes.

---

## License

NovaSVN is released under the [MIT License](LICENSE).

Third-party notices (e.g. Lucide-based Explorer icons) are documented next to the assets that use them.

---

## Links

- [GitHub repository](https://github.com/wuchunpeng777/NovaSVN)
- [CI status](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)
- [Issue tracker](https://github.com/wuchunpeng777/NovaSVN/issues)
- [Commit history](https://github.com/wuchunpeng777/NovaSVN/commits/main)
