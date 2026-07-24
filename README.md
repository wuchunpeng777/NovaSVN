# NovaSVN

English | [简体中文](README.zh-CN.md)

[![CI](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml/badge.svg)](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)

NovaSVN is a desktop Subversion client for Windows and macOS. It combines a compact working-copy view, repository history, repository browsing, and common SVN operations in one native desktop application.

> NovaSVN `0.1.0` is a development preview. It performs real SVN operations against local working copies and remote repositories. Review paths, revisions, and pending changes before running destructive operations.

## Features

- **Working copies:** inspect local and remote changes, browse the file tree, view diffs, blame and properties, organize files with SVN changelists, and select commit targets.
- **SVN operations:** add, commit, update, revert, move, copy, delete, ignore, lock, unlock, clean up, switch, and edit SVN properties.
- **Timeline:** automatically load repository history, filter and paginate revisions, highlight the current working-copy revision, inspect changed paths, compare revisions, and revert changes from a revision.
- **Repository browser:** browse HEAD or historical revisions and run log, blame, properties, checkout, export, import, mkdir, copy, move, rename, and delete operations.
- **Merge workflow:** configure revision ranges and merge options, run cancellable dry runs, inspect every affected file in a standalone merge preview, and resolve text conflicts.
- **Patch and partial commit:** preview selected hunks, generate or apply patches, and commit selected files without introducing a Git-style staging area.
- **Project management:** keep multiple working copies in an ordered project list and switch projects without loading data for inactive views.
- **Desktop integration:** use standalone Log, Update, Commit, Revert, Clean Up, Checkout, Blame, Info, and conflict windows from Windows Explorer or macOS Finder integrations.

## Requirements

To run NovaSVN:

- Windows or macOS.
- A Subversion command-line client (`svn`) available on `PATH`, or its executable configured in NovaSVN settings.
- Access credentials and trust configuration required by the target SVN repositories.

To build NovaSVN from source:

- Node.js 24 or a compatible current Node.js release.
- Rust stable and Cargo.
- The platform prerequisites required by Tauri 2.
- Subversion CLI for integration tests and local development.

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/wuchunpeng777/NovaSVN.git
cd NovaSVN
npm ci
```

Run the desktop application in development mode:

```bash
npm run tauri:dev
```

Run only the frontend in a browser:

```bash
npm run dev
```

The browser preview is useful for UI work, but native windows, filesystem access, shell integration, and real SVN commands require the Tauri application.

## Quality Checks

Run the same combined checks used by CI:

```bash
npm run check
```

Useful focused commands:

```bash
npm run test:components
npm run test:scripts
npm run build
npm run lint:rust
npm run test:rust
npm run test:e2e
```

The real SVN workflow tests create temporary local repositories:

```powershell
npm run test:svn
npm run test:svn:partial
```

## Packaging

Build a Windows NSIS installer on Windows:

```powershell
npm run release:windows
```

Build a local macOS DMG on macOS:

```bash
npm run release:macos
```

Build the notarized macOS release after configuring the required Developer ID identity and notary profile:

```bash
npm run release:macos:notarized
```

Generated packages are written under `src-tauri/target/release/bundle/`. The macOS signing and notarization checks are implemented by the scripts under `scripts/`.

## Project Structure

```text
src/                 Svelte and TypeScript frontend
src-tauri/           Rust backend and Tauri desktop configuration
tests/               Playwright end-to-end tests
scripts/             release, workflow, and benchmark scripts
.github/workflows/   continuous integration
```

## Documentation

- [Changelog](CHANGELOG.md)

When reporting an issue, include the operating system, NovaSVN version, SVN client version (`svn --version`), the operation being performed, and the relevant error output. Remove credentials and private repository URLs before posting logs.
