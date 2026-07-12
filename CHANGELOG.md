# 更新日志

本文档记录 NovaSVN 面向用户和发布流程的可见变化。

## 0.1.0 - 开发预览

### 新增

- 建立 Tauri + Svelte + TypeScript + Rust 桌面应用骨架。
- 支持 SVN 命令行检测、工作副本打开、状态扫描、本地改动列表、文件 diff、提交目标选择和文件级提交。
- 支持未版本控制文件执行 Add，并自动添加所需父目录。
- 支持对当前工作副本内的版本控制文件和目录执行 Delete，删除前明确提示本地内容与未提交改动风险。
- 支持在当前工作副本内安全 Move 文件和目录，执行前确认源、目标及本地改动影响。
- 支持在当前工作副本内安全 Copy 文件和目录，复制结果保留 SVN 历史并自动进入提交目标。
- 支持对未版本控制文件和目录执行 Ignore，保留父目录已有的 `svn:ignore` 规则并明确显示规则作用目录。
- 工作副本工具栏改用紧凑图标按钮，补齐操作提示、禁用状态和 Refresh、Update、Cleanup、Patch 运行状态。
- Versions 布局统一标题栏、侧栏、主表和检查器尺寸，最小窗口宽度与 Tauri 的 960px 配置保持一致。
- 支持独立显示或隐藏项目侧栏和工作副本检查器，并持久化界面可见性偏好。
- 支持浅色、深色和跟随系统主题，包含状态色、Patch 对话框与 Monaco Diff 同步切换。
- 工作副本表格新增 Name、Base、Last、Date、Author、Status 和 Size 栏位，元数据来自流式 `svn info`。
- 工作副本状态区分本地改动、远端更新和同时变化，支持独立筛选并显示工作副本与仓库 revision。
- 文件行按状态显示 Commit、Update、Add 或 Resolve；文件级 Update 执行真实 `svn update <path>`，其余操作收纳到可访问菜单。
- 工作副本文件表支持复选框、Shift 范围多选和表头全选，并可批量切换 Commit 目标或执行真实 Revert、Move、Delete 任务。
- 工作副本文件表支持 treegrid 键盘导航、目录展开收起、范围选择、活动行自动滚动和明确焦点状态。
- 双击工作副本文件可使用系统默认应用安全打开；真实路径会限制在工作副本内，Windows 文件名不再经过命令解释器。
- 工作副本路径提供状态化右键菜单，保留多选批量语义，并支持菜单键、Shift+F10、方向键和 Escape。
- 工作副本检查器使用 Information、Properties、Diff、Blame、Commit 和 Tasks 标签组织文件详情与操作，并支持完整键盘切换。
- 应用原生菜单增加当前路径子菜单，按活动文件或目录状态动态提供 Open、Show in Folder、Commit、Update、Add、Resolve、Revert、Move、Copy、Ignore 和 Delete。
- Timeline 按本地日历日期分组显示 revision，并为未知日期提供稳定分组。
- Timeline revision 完整显示作者、精确时间、提交信息和改变路径，长路径清单可展开或收起。
- Timeline 改变路径可直接运行对应仓库 URL 的 Revision Diff，结果限定在所点击文件或目录。
- Timeline 增加开始与结束日期过滤、无效范围提示和一键清除过滤，结束日期包含当天全部提交。
- Timeline 作者、关键字、日期、当前文件和每页数量过滤可组合使用，文件范围切换会立即重载，并显示过滤结果与分页状态。
- Timeline 可勾选任意两个已加载的 Revision，按旧到新准备比较范围，并通过真实 Revision Diff 任务执行比较。
- Timeline 可将当前选中的版本化文件与任意 Revision 比较，后端把真实 `svn diff` 限定到该工作副本文件。
- Timeline 可将干净且已 Update 到 HEAD 的工作副本恢复到指定旧 Revision，通过反向 Merge 生成可审查、可提交的本地改动。
- Revision Diff 可导出完整 Patch；预览截断时显示完整文件名和路径，完整文件写入失败会使任务失败。
- Apply Patch 显示成功偏移的 hunk 数；命令输出预览限制为 256 KiB，任务日志限制为 64 KiB/500 行并明确标记截断。
- Merge 支持单源 URL、revision 范围、dry-run 结构化预览，以及 Record only、Ignore ancestry 和 Force 常用参数。
- Repository 可浏览任意 SVN URL 的 HEAD 或指定数字 Revision，目录导航保持当前历史快照。
- Repository 目录表明确显示条目类型、Last Revision、作者和日期，并为完整元数据提供 tooltip。
- Repository 文件可按当前历史 Revision 通过真实 `svn cat` 下载二进制安全的临时副本，并使用系统默认应用打开。
- Repository 文件可查看当前历史快照之前的 Log，并连续分页加载作者、时间和提交信息。
- Repository 文件可查看当前历史快照的逐行 Blame，显示每行 Revision、作者、行号和 UTF-8 文本内容。
- Repository 文件可查看当前历史快照的只读 Properties，支持 HEAD 已删除文件、多行值和二进制属性标记。
- Repository 可将当前 URL 按指定 Revision Checkout 到本地空目录，成功后自动打开工作副本。
- Repository 可将当前 URL 按指定 Revision Export 到本地空目录，导出结果不含 `.svn`，成功后在文件管理器中显示。
- Repository 可在当前仓库目录下创建远端目录，执行前确认目标与提交信息，成功后刷新父目录。
- Repository 可选择本地文件或目录 Import 到目标 URL，执行前复检源路径并确认提交信息，成功后刷新父目录。
- Repository 支持直接拖入一个本地文件或目录，按当前仓库目录和源名称预填 Import 目标，并显示可放置状态。
- Repository 文件和目录可拖出到系统文件管理器；应用先按当前 Revision 执行真实 Export，再通过原生 copy 拖拽交付本地产物。
- Repository 可将普通文件或目录按指定历史 Revision Copy 到新 URL，执行前确认并在成功后刷新目标父目录。
- Repository 可将远端文件或目录 Move 到新 URL，要求提交信息和确认，并在成功后刷新受影响的父目录。
- Repository 可在同一远端目录内 Rename 文件或目录，跨目录目标会被拒绝，并使用独立表单和任务状态。
- Repository 可直接 Delete 远端文件或目录，执行前要求提交信息和破坏性确认，成功后刷新父目录。
- 支持 update、revert、cleanup、Repository Browser、分支/标签识别、分支/标签创建、分支工作副本池、任务工作区和 svn switch。
- 支持 Log、Revision Diff、分支比较、Lock/Unlock、冲突处理、Merge、SVN Properties 和 Externals。
- 支持 Windows Explorer 右键菜单入口和 macOS Finder Quick Actions 安装脚本。
- 支持二进制资源、大文件和生成目录提醒。
- 支持 `svn:externals` 配置展示和 externals 状态提醒。
- 支持设置持久化、SVN 路径、工作副本池默认路径、Diff 偏好、提交模板、大文件阈值和外部 diff/merge 工具路径。
- 增加 Rust 自动化测试、SVN 流程测试、部分提交流程测试、性能基准脚本、Windows NSIS 安装包配置、macOS DMG 安装包配置和版本同步脚本。
- 性能基准记录状态扫描、diff、虚拟列表准备和提交目标准备耗时。

### 修复

- Repository 写操作遇到认证失败或无写权限时统一显示可恢复建议并保留 SVN 原始错误，成功后统一切回 HEAD 刷新。
- 仓库写操作成功后统一切回 HEAD 刷新，不再停留在旧 Revision 而看不到新结果。
- Repository 历史目录和文件命令附带对应 peg revision，条目在 HEAD 已删除时仍可按旧 Revision 浏览和打开。
- 普通 SVN 操作完成状态改为按 pending task id 处理，切换当前任务或工作副本不再丢失完成监听。
- 隔离并发的工作副本打开、状态扫描和文件树刷新请求，避免旧请求覆盖新工作副本。
- 后端重启导致 pending 任务消失时解除操作锁定并提示用户刷新重试。
- Commit、Partial Commit、Repository、Checkout、Switch、Revision Diff 和 Merge 完成状态不再依赖任务面板当前选中项。
- 文件树改为流式解析递归 `svn info`，并限制版本化路径数量、单路径和错误输出大小，避免完整 XML 与 DOM 的无界内存占用。
- 修复 Windows PowerShell 性能基准脚本的 Markdown 转义，并记录递归 `svn info` 耗时。

### 发布

- Windows 安装包：`npm run release:windows`。
- macOS 安装包：`npm run release:macos`。
- 版本同步：`npm run version:sync -- --set <version>`。
- 版本校验：`npm run version:check`。

### 已知限制

- Windows 代码签名、macOS 签名和 notarization 仍需按正式发布证书补齐。
- 第一版 SVN 集成通过本机 `svn` 命令行执行。
