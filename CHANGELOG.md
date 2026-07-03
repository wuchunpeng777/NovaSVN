# 更新日志

本文档记录 NovaSVN 面向用户和发布流程的可见变化。

## 0.1.0 - 开发预览

### 新增

- 建立 Tauri + Svelte + TypeScript + Rust 桌面应用骨架。
- 支持 SVN 命令行检测、工作副本打开、状态扫描、本地改动列表、文件 diff、文件级虚拟暂存和文件级提交。
- 支持 update、revert、cleanup、Repository Browser、分支/标签识别、分支/标签创建、分支工作副本池、任务工作区和 svn switch。
- 支持 Log、Revision Diff、分支比较、Lock/Unlock、冲突处理、Merge、SVN Properties 和 Externals。
- 支持 Windows Explorer 右键菜单入口和 macOS Finder Quick Actions 安装脚本。
- 支持 Unity 项目识别、`.meta` 配对检查、Unity 文件分组、大资源提醒和生成目录提醒。
- 支持 `svn:externals` 配置展示和 externals 状态提醒。
- 支持设置持久化、SVN 路径、工作副本池默认路径、Diff 偏好、提交模板、大文件阈值、Unity 规则、Unity 分组规则和外部 diff/merge 工具路径。
- 增加 Rust 自动化测试、SVN 流程测试、部分提交流程测试、性能基准脚本、Windows NSIS 安装包配置、macOS DMG 安装包配置和版本同步脚本。
- 性能基准记录状态扫描、diff、虚拟列表准备和提交准备耗时。

### 发布

- Windows 安装包：`npm run release:windows`。
- macOS 安装包：`npm run release:macos`。
- 版本同步：`npm run version:sync -- --set <version>`。
- 版本校验：`npm run version:check`。

### 已知限制

- Windows 代码签名、macOS 签名和 notarization 仍需按正式发布证书补齐。
- 第一版 SVN 集成通过本机 `svn` 命令行执行。
