# AI Context

This file stores durable project knowledge for xflow. Update it with `/xflow:learn` or `/xflow:record` when project-level facts change.

## Project Overview

- Type: 跨平台桌面应用。
- Product: NovaSVN 是一个现代化、高性能、跨平台的完整 SVN 客户端。
- Goals: 提供完整 SVN 能力、现代化 UI、Git-like 虚拟暂存区、部分提交、多工作副本分支池和大型工作副本优化体验。

## Tech Stack

- Languages: TypeScript、Rust。
- Frontend: Svelte + TypeScript + Vite。
- Desktop Runtime: Tauri。
- Backend: Rust Tauri commands。
- SVN Integration: 第一版通过 `svn` 命令行集成。
- Package/Build: npm、Cargo、Tauri bundler。

## Architecture Notes

- Structure: 前端源码在 `src/`，Tauri/Rust 后端在 `src-tauri/`，设计和计划文档在 `doc/`。
- App Shell: `src/App.svelte` 是当前工作台入口，`src/stores/` 存放前端状态，`src/types/` 存放共享类型，`src/components/` 存放可复用组件。
- Tauri Config: 应用配置在 `src-tauri/tauri.conf.json`，产品名为 `NovaSVN`。
- Rust Entry: Rust 后端入口在 `src-tauri/src/lib.rs` 和 `src-tauri/src/main.rs`。
- Frontend API: 前端组件不直接调用 Tauri `invoke`，统一通过 `src/lib/api.ts` 的 API client 调用后端命令。
- Command Response: Rust command 成功响应使用统一结构 `CommandResponse<T>`。
- Command Error: Rust 错误使用 `NovaError`，错误字段包含 `code`、`message`、`detail`、`recoverable`。
- Error UI: 前端命令错误通过统一错误展示组件呈现。
- Backend Modules: Rust 后端保留 `svn`、`workspace`、`task`、`staging`、`error` 模块边界。
- Icon: `src-tauri/icons/icon.png` 当前是占位图标，后续品牌设计阶段需要替换。

## Quality Constraints

- Performance: 大型工作副本性能是核心约束，后续列表、扫描、diff 和任务都应避免阻塞 UI。
- Security: 不提交密钥、本机敏感路径或临时缓存。
- Compatibility: 目标平台包含 Windows 和 macOS；当前 macOS 已验证开发启动，Windows 仍需后续环境验证。
- Generated Files: `node_modules/`、`dist/`、`src-tauri/target/`、`src-tauri/gen/` 等生成物不应提交。
- Cargo Registry: 仓库包含 `.cargo/config.toml`，用于覆盖本机失效的 Cargo `ustc` 源配置，保证项目内 Cargo 命令可用。

## Development Commands

- Install frontend dependencies: `npm install`。
- Frontend build: `npm run build`。
- Tauri dev: `npm run tauri:dev`。
- Rust check: `cargo check --manifest-path src-tauri/Cargo.toml`。

## Code Standards

- 使用中文沟通，代码注释使用中文。
- Keep code scoped to the active task spec.
- Prefer existing project patterns over new abstractions.
- Use readable names and small, focused methods.
- Treat code and Git state as the source of truth.
- 不实现当前 xflow 任务范围之外的 SVN 业务功能。

## xflow Notes

- Active specs live in `.xflow/tasks/`.
- Completed work is summarized in `.xflow/releases/`.
- Abandoned work is summarized in `.xflow/history/`.
- Temporary task details do not belong in this file.
