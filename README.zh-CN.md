# NovaSVN

[English](README.md) | 简体中文

[![CI](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml/badge.svg)](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](package.json)

**NovaSVN** 是面向 **Windows** 与 **macOS** 的开源桌面 Subversion 客户端。

它首先是一个**完整的工作台**，而不是一串互不关联的弹窗：在同一界面里查看本地改动、审阅历史、浏览仓库、带预览地合并、处理 Patch；需要时，也可以从系统右键菜单打开专注的小窗口。

**在 macOS 上，这个空白尤其明显：** 长期以来，Mac 端缺少体验完整、持续维护的现代桌面 SVN 客户端。团队往往只能在命令行、半成品 GUI，或「远程用 Windows 工具」之间折中。NovaSVN 把 macOS 当作一等公民来做——不是勉强能跑的移植版。

底层通过真实的 `svn` 命令行驱动——沿用你已配置、已信任的官方工具链，而不是自研一套协议栈。

> **状态说明：** `0.1.0` 为**开发预览**版本。应用会对本地工作副本和远端仓库执行真实 SVN 操作。执行破坏性操作前，请仔细确认路径、Revision 与未提交改动。

---

## 和常见 SVN 客户端有何不同

很多成熟的 SVN 工具更像是**资源管理器扩展**或**单次操作对话框**：右键文件夹 → 填表单 → 关掉窗口。这种方式适合快速完成单步操作，但很少提供一个可以「常驻其中」的审阅环境。

NovaSVN 选择了另一条路：

| 侧重点 | 你能得到什么 |
| --- | --- |
| **工作台优先** | 主窗口集中处理状态、多选、树形导航、批量提交 / 还原 / 移动 / 删除——更接近现代 IDE 工作区，而不是一连串模态对话框 |
| **需要时再用系统入口** | 仍可从资源管理器 / Finder 打开 Log、Commit、Update、Checkout、仓库浏览器等；任务需要上下文时再回到完整应用 |
| **macOS 一等公民** | 不是顺带移植：Mac 上同样提供完整工作台与系统集成，填补「好用桌面 SVN 几乎空白」的长期缺口 |
| **跨平台一体** | **Windows 与 macOS** 同一产品方向，团队可共用一套客户端与工作流 |
| **面向代码审阅的界面** | 基于 Monaco 的文本 Diff、编码感知对比、图片 Diff、Blame；日志时间线高亮工作副本 Revision，一键复制版本号 |
| **风险操作先预览** | Merge 支持可取消 Dry-run 与独立预览窗口，写工作副本之前先看清影响 |
| **真实 `svn`，不是替代品** | 认证、服务器特性与边界情况仍交给官方 CLI；NovaSVN 负责编排与呈现 |
| **轻量且开源** | Tauri + Rust + Svelte，MIT 许可——可审计、可 fork、可贡献 |

**一句话：** 保留官方 `svn` 的可靠性，补上现代桌面应用的多场景工作台，而不是把每件事都做成「弹窗 → 关掉」。在 Mac 上，目标更直接——补上那款一直缺位的桌面 SVN 客户端。

如果你仍在维护 SVN 仓库——尤其是在 macOS 上，或 Windows / Mac 混用的团队——希望界面更贴近现在的开发习惯，又不想换掉版本控制系统本身，这正是 NovaSVN 想填的位置。

---

## 功能

### 工作副本工作台

- 扫描本地与远端变化，紧凑文件表（状态、Revision、作者、大小等）
- 多选与树形导航；批量提交 / 还原 / 移动 / 删除
- 在无 Git 式暂存区的前提下，提交所选路径（部分提交）
- Diff（文本、编码感知、图片）、Blame、Properties、Changelist
- 浅色 / 深色 / 跟随系统主题

### 历史与时间线

- 加载、过滤、分页仓库日志
- 在时间线中高亮当前工作副本 Revision
- 查看变更路径、比较 Revision、撤销 / 回退指定 Revision
- 按指定 Revision Export 路径（结果不含 `.svn`）
- 一键复制单条日志的版本号，便于粘贴到命令或表单

### 仓库浏览器

- 浏览 HEAD 或历史 Revision
- Log、Blame、Properties、Checkout、Export、Import、Mkdir、Copy、Move、Rename、Delete
- 将条目拖出到系统文件管理器（先真实 Export，再交付本地产物）

### Merge、Patch 与冲突

- 可配置 Merge，支持可取消 Dry-run 与独立预览窗口
- 生成 / 应用 Patch
- 文本冲突处理辅助

### 桌面集成

既可用完整工作台，也可从系统入口打开专注窗口：

| 形态 | 示例 |
| --- | --- |
| 主应用 | 状态工作台、多文件审阅、仓库浏览 |
| 独立窗口 | Log、Update、Commit、Revert、Clean Up、Checkout、仓库浏览器、Blame、Info、冲突处理 |
| 系统入口 | Windows 资源管理器右键（安装包注册）；macOS Finder Quick Actions / Finder Sync |
| 命令行启动 | 例如 `--novasvn-action browse` |

---

## 运行要求

### 使用

| 要求 | 说明 |
| --- | --- |
| 操作系统 | Windows 10+ 或较新的 macOS |
| Subversion CLI | `PATH` 中有 `svn`，或在设置中指定可执行文件路径 |
| 访问权限 | 目标仓库所需的凭据与证书信任 |

### 从源码构建

| 要求 | 说明 |
| --- | --- |
| [Node.js](https://nodejs.org/) | 推荐 24（与 CI 一致） |
| [Rust](https://rustup.rs/) | stable 工具链与 Cargo |
| [Tauri 2](https://v2.tauri.app/start/prerequisites/) | 各平台系统依赖 |
| Subversion CLI | 集成测试与本地 SVN 流程需要 |

---

## 安装

### 预编译包

可在本机按 [打包](#打包) 自行构建，或在发布后使用 GitHub [Releases](https://github.com/wuchunpeng777/NovaSVN/releases)。

发布构建常见产物：

| 平台 | 产物路径 |
| --- | --- |
| Windows | `src-tauri/target/release/bundle/nsis/NovaSVN_*_x64-setup.exe` |
| macOS | `src-tauri/target/release/bundle/dmg/*.dmg` |

### 从源码开发运行

```bash
git clone https://github.com/wuchunpeng777/NovaSVN.git
cd NovaSVN
npm ci
npm run tauri:dev
```

仅前端浏览器预览（无原生文件系统 / SVN / 系统集成）：

```bash
npm run dev
```

---

## 开发

### 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run tauri:dev` | 完整桌面应用开发模式 |
| `npm run dev` | 仅前端（Vite） |
| `npm run build` | 类型检查 + 前端生产构建 |
| `npm run check` | 与 CI 相同的组合质量检查 |
| `npm run test:components` | Vitest（Svelte / TS） |
| `npm run test:rust` | Rust 单元测试 |
| `npm run lint:rust` | Clippy（`-D warnings`） |
| `npm run test:e2e` | Playwright 端到端 |
| `npm run test:scripts` | 发布 / 脚本自测 |

### 真实 SVN 流程测试

会创建临时本地仓库（Windows PowerShell）：

```powershell
npm run test:svn
npm run test:svn:partial
```

### 目录结构

```text
src/                 Svelte + TypeScript 界面
src-tauri/           Rust 后端、Tauri 配置、系统扩展
  windows-shell-extension/   Windows 资源管理器集成
  macos-finder-sync/         macOS Finder Sync 源码
tests/e2e/           Playwright 测试
scripts/             发布、SVN 流程与性能脚本
.github/workflows/   持续集成
```

### 技术栈

- **界面：** Svelte 5、TypeScript、Vite、Monaco Editor
- **桌面：** Tauri 2
- **后端：** Rust（`svn` 进程编排、任务队列、工作副本逻辑）
- **测试：** Vitest、Playwright、Cargo、PowerShell SVN 流程脚本

---

## 打包

### Windows（NSIS）

```powershell
npm run release:windows
```

安装包输出在 `src-tauri/target/release/bundle/nsis/`。

### macOS

```bash
# 本地 DMG
npm run release:macos

# 公证正式包（需配置 Developer ID 与 notary profile）
npm run release:macos:notarized
```

版本号同步：

```bash
npm run version:check
npm run version:sync   # 升版后对齐各处版本字符串
```

---

## 参与贡献

欢迎贡献代码与反馈。

1. Fork 仓库，从 `main` 拉取功能分支。
2. 变更尽量聚焦；遵循现有代码风格与测试习惯。
3. 提交 PR 前运行 `npm run check` 及必要的定向测试。
4. 说明用户可见行为，以及是否影响工作副本 / 远端安全。

### 反馈问题

请尽量提供：

- 操作系统与 NovaSVN 版本
- `svn --version`
- 复现步骤
- 相关日志或错误信息

**请勿粘贴密码、令牌或私有仓库 URL。** 发帖前务必脱敏。

---

## 安全提示

- NovaSVN 会执行**真实**的 `svn` 命令（提交、删除、合并、切换、导出等）。
- 确认前请核对**目标路径**、**URL** 与 **Revision**。
- Merge 优先使用 Dry-run / 预览流程。
- 开发预览版本行为可能随版本调整，可用 `git log` 查看近期变更。

---

## 许可证

NovaSVN 以 [MIT License](LICENSE) 发布。

第三方说明（例如基于 Lucide 的资源管理器图标）见对应资源目录内的文档。

---

## 相关链接

- [GitHub 仓库](https://github.com/wuchunpeng777/NovaSVN)
- [CI 状态](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)
- [问题反馈](https://github.com/wuchunpeng777/NovaSVN/issues)
- [提交历史](https://github.com/wuchunpeng777/NovaSVN/commits/main)
