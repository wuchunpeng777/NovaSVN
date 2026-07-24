# NovaSVN

[English](README.md) | 简体中文

[![CI](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml/badge.svg)](https://github.com/wuchunpeng777/NovaSVN/actions/workflows/ci.yml)

NovaSVN 是一款面向 Windows 和 macOS 的桌面 Subversion 客户端，将紧凑的工作副本、仓库时间线、仓库浏览和常用 SVN 操作整合到一个原生桌面应用中。

> NovaSVN `0.1.0` 当前为开发预览版本。应用会对本地工作副本和远端仓库执行真实 SVN 操作；运行破坏性操作前，请仔细确认路径、Revision 和待处理改动。

## 功能

- **工作副本：** 查看本地及远端变化，浏览文件树，查看 Diff、Blame 和 Properties，使用 SVN Changelist 组织文件并选择提交目标。
- **SVN 操作：** 支持 Add、Commit、Update、Revert、Move、Copy、Delete、Ignore、Lock、Unlock、Clean Up、Switch 和 SVN 属性编辑。
- **时间线：** 自动加载仓库日志，过滤和分页 Revision，高亮当前工作副本 Revision，查看变化路径、比较 Revision，并撤销指定 Revision 的改动。
- **仓库浏览：** 浏览 HEAD 或历史 Revision，并执行 Log、Blame、Properties、Checkout、Export、Import、Mkdir、Copy、Move、Rename 和 Delete。
- **Merge 流程：** 配置 Revision 范围及 Merge 参数，运行可取消的 Dry-run，在独立 Merge 预览窗口逐文件检查结果，并处理文本冲突。
- **Patch 与部分提交：** 预览所选 Hunk，生成或应用 Patch，并在不引入 Git 式暂存区的前提下提交所选文件。
- **项目管理：** 在有序项目列表中管理多个工作副本，切换项目时不会加载非当前页签的数据。
- **桌面集成：** 通过 Windows Explorer 或 macOS Finder 集成使用独立的 Log、Update、Commit、Revert、Clean Up、Checkout、Blame、Info 和冲突处理窗口。

## 运行要求

运行 NovaSVN 需要：

- Windows 或 macOS。
- `PATH` 中存在 Subversion 命令行客户端（`svn`），或在 NovaSVN 设置中配置其可执行文件。
- 目标 SVN 仓库所需的访问凭据及证书信任配置。

从源码构建还需要：

- Node.js 24 或兼容的当前 Node.js 版本。
- Rust stable 和 Cargo。
- Tauri 2 在当前平台所需的系统依赖。
- 用于集成测试和本地开发的 Subversion CLI。

## 开发

克隆仓库并安装依赖：

```bash
git clone https://github.com/wuchunpeng777/NovaSVN.git
cd NovaSVN
npm ci
```

以开发模式运行桌面应用：

```bash
npm run tauri:dev
```

只在浏览器中运行前端：

```bash
npm run dev
```

浏览器预览适合界面开发，但原生窗口、文件系统访问、系统集成和真实 SVN 命令需要在 Tauri 应用中运行。

## 质量检查

运行与 CI 相同的组合检查：

```bash
npm run check
```

常用的单项命令：

```bash
npm run test:components
npm run test:scripts
npm run build
npm run lint:rust
npm run test:rust
npm run test:e2e
```

真实 SVN 流程测试会创建临时本地仓库：

```powershell
npm run test:svn
npm run test:svn:partial
```

## 打包

在 Windows 上构建 NSIS 安装包：

```powershell
npm run release:windows
```

在 macOS 上构建本地 DMG：

```bash
npm run release:macos
```

配置所需的 Developer ID 身份和公证 Profile 后，构建经过公证的 macOS 正式包：

```bash
npm run release:macos:notarized
```

生成的安装包位于 `src-tauri/target/release/bundle/`。签名和公证要求参见 [macOS 发布验收](doc/macOS发布验收.md)。

## 项目结构

```text
src/                 Svelte 和 TypeScript 前端
src-tauri/           Rust 后端及 Tauri 桌面配置
tests/               Playwright 端到端测试
scripts/             发布、流程和性能基准脚本
doc/                 设计与工程文档
.github/workflows/   持续集成配置
```

## 文档

- [更新日志](CHANGELOG.md)
- [设计文档](doc/设计文档.md)
- [性能基准](doc/性能基准.md)
- [升级策略](doc/升级策略.md)

提交问题时，请提供操作系统、NovaSVN 版本、SVN 客户端版本（`svn --version`）、正在执行的操作和相关错误输出。发布日志前请移除凭据和私有仓库 URL。
