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
- Layout Components: 工作台布局组件放在 `src/components/layout/` 和 `src/components/workbench/`。
- Workbench Data: 当前工作台占位视图和导航数据集中在 `src/lib/workbench.ts`。
- Workbench Structure: 首屏应保持为工作台结构，包括左侧导航/过滤器、中间主视图、右侧详情和底部状态区。
- Tauri Config: 应用配置在 `src-tauri/tauri.conf.json`，产品名为 `NovaSVN`。
- Rust Entry: Rust 后端入口在 `src-tauri/src/lib.rs` 和 `src-tauri/src/main.rs`。
- Frontend API: 前端组件不直接调用 Tauri `invoke`，统一通过 `src/lib/api.ts` 的 API client 调用后端命令。
- Command Response: Rust command 成功响应使用统一结构 `CommandResponse<T>`。
- Command Error: Rust 错误使用 `NovaError`，错误字段包含 `code`、`message`、`detail`、`recoverable`。
- Error UI: 前端命令错误通过统一错误展示组件呈现。
- Backend Modules: Rust 后端保留 `svn`、`workspace`、`task`、`staging`、`error` 模块边界。
- SVN Detection: `src-tauri/src/svn.rs` 提供 SVN 命令行检测，默认检测 PATH 中的 `svn`，也支持指定可执行文件路径。
- SVN Detection Command: `detect_svn` command 执行 `svn --version --quiet` 获取版本，并在 Windows 下通过 `where` 尽力解析路径。
- SVN Detection UI: 右侧详情区展示 SVN 命令行状态、版本和路径，前端状态由 `src/stores/app.ts` 的 `svnStore` 管理。
- SVN Path Settings: 当前手动 SVN 路径只保存在前端运行态，持久化设置后续单独实现。
- Workspace Open: `src-tauri/src/workspace.rs` 负责打开工作副本，执行 `svn info --xml <path>` 并解析工作副本 root、仓库 URL、repository root 和 revision。
- Workspace Commands: 工作副本 commands 包括 `open_workspace` 和 `get_recent_workspace`，错误继续走统一 `NovaError`。
- Workspace UI: 主工作区顶部展示工作副本打开面板，前端状态由 `src/stores/app.ts` 的 `workspaceStore` 管理。
- Recent Workspace: 最近工作副本当前保存到应用数据目录下的 `recent-workspace.json`，只保存一个摘要。
- Status Scan: `scan_workspace_status` command 执行 `svn status --xml <working_copy_root>`，返回 `WorkingCopyStatus` 和 `ChangedFile`。
- Status UI: 主工作区显示状态统计和基础文件状态列表，打开工作副本后会自动扫描，也支持手动刷新。
- Status Limit: 当前状态扫描返回前 500 项，保留 offset/limit 扩展字段；搜索、过滤、分组和虚拟滚动后续实现。
- Changes List: 本地改动列表在前端基于 `workspaceStore.status.files` 派生，支持路径搜索、按状态分组和选中文件。
- Selected File: 当前选中文件路径保存在 `workspaceStore.selectedFilePath`，右侧详情区展示选中文件摘要，后续 diff 可复用该选择状态。
- Virtual Staging: 文件级虚拟暂存由 `workspaceStore.stagedFiles` 保存在前端运行内存中，只记录文件路径和状态，不持久化，也不修改真实 SVN 工作副本或 `.svn` 元数据。
- Staging Rules: `missing`、`conflicted`、`obstructed` 默认不可暂存；状态刷新后会移除不存在、状态变化或变为不可暂存的 staged 文件。
- Staging UI: 主工作区列表分为“已暂存”和“未暂存”分区，文件行支持选择、暂存和取消暂存；底部提交区显示已暂存摘要和提交按钮占位启用状态。
- Commit Placeholder: 当前提交按钮只作为后续提交功能入口占位，不执行真实 `svn commit`。
- File Diff: `get_file_diff` command 执行 `svn diff <path>`，请求包含工作副本 root、文件相对路径和可选 SVN 可执行文件路径。
- Diff UI: 右侧详情区显示普通文本 diff，二进制文件显示不可预览提示；Monaco diff 放到后续阶段。
- Diff State: 当前文件 diff、加载状态和错误保存在 `workspaceStore.selectedFileDiff`、`diffLoading`、`diffError`。
- Dialog Plugin: 目录选择使用 `@tauri-apps/plugin-dialog` 和 Rust `tauri-plugin-dialog`，权限配置在 `src-tauri/capabilities/default.json`。
- Task Queue: 后端任务队列由 `src-tauri/src/task.rs` 提供，当前为内存存储和串行执行模型，通过 Tauri managed state 注入。
- Task Commands: 任务相关 commands 包括创建模拟任务、读取任务列表、读取任务详情和取消任务；任务错误继续走统一 `NovaError`。
- Task UI: 前端任务状态集中在 `src/stores/app.ts` 的 `taskStore`，底部任务队列 UI 位于 `src/components/workbench/BottomPanel.svelte`。
- Task Refresh: 当前前端通过轮询刷新任务列表和选中任务日志，后续可替换为 Tauri 事件推送。
- Icon: `src-tauri/icons/icon.png` 当前是占位图标，后续品牌设计阶段需要替换。
- Windows Icon: Windows Tauri 构建需要 `src-tauri/icons/icon.ico` 存在。

## Quality Constraints

- Performance: 大型工作副本性能是核心约束，后续列表、扫描、diff 和任务都应避免阻塞 UI。
- Layout Stability: 工作台使用稳定 grid/flex 布局，新增真实数据时应避免面板尺寸跳动、文本溢出和控件重排。
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
- Git 提交日志必须使用中文。
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
