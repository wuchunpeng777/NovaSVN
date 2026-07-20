import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const windowsExplorerScript = fs.readFileSync(
  path.join(root, "scripts", "windows-explorer-menu.ps1"),
  "utf8",
);
const macosFinderScript = fs.readFileSync(
  path.join(root, "scripts", "macos-finder-quick-actions.sh"),
  "utf8",
);
const macosFinderSyncBuildScript = fs.readFileSync(
  path.join(root, "scripts", "build-macos-finder-sync.sh"),
  "utf8",
);
const macosFinderSyncDmgInjectScript = fs.readFileSync(
  path.join(root, "scripts", "inject-macos-finder-sync-into-dmg.sh"),
  "utf8",
);
const macosReleaseScript = fs.readFileSync(
  path.join(root, "scripts", "release-macos.sh"),
  "utf8",
);
const macosReleaseVerifyScript = fs.readFileSync(
  path.join(root, "scripts", "verify-macos-release.sh"),
  "utf8",
);
const macosNotarizeScript = fs.readFileSync(
  path.join(root, "scripts", "notarize-macos-release.sh"),
  "utf8",
);
const macosFinderSyncSource = fs.readFileSync(
  path.join(root, "src-tauri", "macos-finder-sync", "NovaSVNFinderSync.m"),
  "utf8",
);
const macosFinderSyncEntitlements = fs.readFileSync(
  path.join(root, "src-tauri", "macos-finder-sync", "NovaSVNFinderSync.entitlements"),
  "utf8",
);
const macosFinderSyncInfo = fs.readFileSync(
  path.join(root, "src-tauri", "macos-finder-sync", "Info.plist"),
  "utf8",
);
const macosFinderSyncXcodeProject = fs.readFileSync(
  path.join(
    root,
    "src-tauri",
    "macos-finder-sync",
    "NovaSVNFinderSync.xcodeproj",
    "project.pbxproj",
  ),
  "utf8",
);
const macosFinderSyncXcodeScheme = fs.readFileSync(
  path.join(
    root,
    "src-tauri",
    "macos-finder-sync",
    "NovaSVNFinderSync.xcodeproj",
    "xcshareddata",
    "xcschemes",
    "NovaSVNFinderSync.xcscheme",
  ),
  "utf8",
);
const benchmarkScript = fs.readFileSync(
  path.join(root, "scripts", "benchmark-svn-workspace.ps1"),
  "utf8",
);
const performanceBenchmarkRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "performance_benchmark.rs"),
  "utf8",
);
const benchmarkDoc = fs.readFileSync(path.join(root, "doc", "性能基准.md"), "utf8");
const syncVersionScript = fs.readFileSync(path.join(root, "scripts", "sync-version.mjs"), "utf8");
const releaseArtifactsScript = fs.readFileSync(
  path.join(root, "scripts", "release-artifacts.mjs"),
  "utf8",
);
const releaseArtifactsTest = fs.readFileSync(
  path.join(root, "scripts", "test-release-artifacts.mjs"),
  "utf8",
);
const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const nsisHooks = fs.readFileSync(path.join(root, "src-tauri", "nsis-hooks.nsh"), "utf8");
const tauriCargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
const defaultCapability = fs.readFileSync(
  path.join(root, "src-tauri", "capabilities", "default.json"),
  "utf8",
);
const playwrightConfig = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");
const e2eSmokeSpec = fs.readFileSync(
  path.join(root, "tests", "e2e", "workbench-smoke.spec.ts"),
  "utf8",
);
const e2eOperationsSpec = fs.readFileSync(
  path.join(root, "tests", "e2e", "workbench-operations.spec.ts"),
  "utf8",
);
const ciWorkflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "ci.yml"),
  "utf8",
);
const appSvelte = fs.readFileSync(path.join(root, "src", "App.svelte"), "utf8");
const appCss = fs.readFileSync(path.join(root, "src", "styles", "app.css"), "utf8");
const frontendApi = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
const appMenuSource = fs.readFileSync(path.join(root, "src", "lib", "app-menu.ts"), "utf8");
const mainWorkspace = fs.readFileSync(
  path.join(root, "src", "components", "workbench", "MainWorkspace.svelte"),
  "utf8",
);
const standaloneLogWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneLogWindow.svelte"),
  "utf8",
);
const standaloneBlameWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneBlameWindow.svelte"),
  "utf8",
);
const standaloneCommitWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneCommitWindow.svelte"),
  "utf8",
);
const commitMessageHistory = fs.readFileSync(
  path.join(root, "src", "lib", "commit-message-history.ts"),
  "utf8",
);
const standaloneUpdateWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneUpdateWindow.svelte"),
  "utf8",
);
const appStore = fs.readFileSync(path.join(root, "src", "stores", "app.ts"), "utf8");
const tauriLib = fs.readFileSync(path.join(root, "src-tauri", "src", "lib.rs"), "utf8");
const diagnosticsRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "diagnostics.rs"),
  "utf8",
);
const systemIntegrationRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "system_integration.rs"),
  "utf8",
);
const workspaceRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "workspace.rs"),
  "utf8",
);
const externalToolRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "external_tool.rs"),
  "utf8",
);
const taskRs = fs.readFileSync(path.join(root, "src-tauri", "src", "task.rs"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

const releaseScripts = ["release:windows", "release:macos", "release:macos:notarized"];
const requiredCheckSteps = [
  "npm run test:components",
  "npm run test:scripts",
  "npm run build",
  "npm run lint:rust",
  "npm run test:rust",
];
const requiredBundleTargets = ["nsis", "dmg"];
const benchmarkScripts = ["benchmark:svn", "benchmark:svn:quick", "benchmark:svn:reset"];
const e2eSmokeAssertions = [
  "NovaSVN",
  "工作副本",
  "时间线",
  "仓库",
  "提交目标",
  "未管理文件",
];
const systemIntegrationActions = [
  "open",
  "commit",
  "update",
  "diff",
  "log",
  "revert",
  "cleanup",
  "branch-workspace",
];
const startupActionViewChecks = [
  { action: "cleanup", view: "changes", operation: "cleanup" },
  { action: "diff", view: "changes" },
  { action: "revert", view: "changes" },
  { action: "branch-workspace", view: "branches" },
];
let failed = false;

for (const ciQualityGate of [
  "components: clippy",
  "subversion",
  "run: npm ci",
  "run: npm run check",
  "run: npx playwright install --with-deps chromium",
  "run: npm run test:e2e",
]) {
  if (!ciWorkflow.includes(ciQualityGate)) {
    console.error(`CI 缺少质量门禁：${ciQualityGate}`);
    failed = true;
  }
}

const checkCommand = packageJson.scripts?.check;
if (typeof checkCommand !== "string") {
  console.error("缺少跨平台统一 npm run check 入口");
  failed = true;
} else {
  let previousStepIndex = -1;
  for (const step of requiredCheckSteps) {
    const stepIndex = checkCommand.indexOf(step);
    if (stepIndex < 0) {
      console.error(`npm run check 缺少质量门禁：${step}`);
      failed = true;
    } else if (stepIndex <= previousStepIndex) {
      console.error(`npm run check 质量门禁顺序错误：${step}`);
      failed = true;
    }
    previousStepIndex = stepIndex;
  }
}

if (packageJson.scripts?.["test:rust"] !== "cargo test --manifest-path src-tauri/Cargo.toml") {
  console.error("test:rust 必须使用项目内 Cargo manifest，保证各平台入口一致");
  failed = true;
}

if (
  packageJson.scripts?.["lint:rust"] !==
  "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings"
) {
  console.error("lint:rust 必须检查全部 Rust 目标并将 Clippy 告警视为错误");
  failed = true;
}

const tauriWindowMinWidth = tauriConfig.app?.windows?.[0]?.minWidth;
const cssWindowMinWidth = Number(
  appCss.match(/html,\s*body,\s*#app\s*\{[^}]*min-width:\s*(\d+)px/s)?.[1] ?? NaN,
);
if (!Number.isFinite(cssWindowMinWidth) || cssWindowMinWidth !== tauriWindowMinWidth) {
  console.error(
    `CSS 最小宽度 ${cssWindowMinWidth || "未配置"} 必须与 Tauri ${tauriWindowMinWidth || "未配置"} 一致`,
  );
  failed = true;
}

for (const layoutToken of [
  "--source-list-width: 220px",
  "--inspector-divider-width: 6px",
  "--inspector-min-width: 300px",
]) {
  if (!appCss.includes(layoutToken)) {
    console.error(`Versions 布局缺少稳定尺寸：${layoutToken}`);
    failed = true;
  }
}

for (const themeToken of [
  'data-theme="dark"',
  "color-scheme: dark",
  'onAppSettingInput("themeMode", "system")',
  'theme={resolvedTheme}',
]) {
  const themeSource = themeToken.startsWith("data-theme") || themeToken.includes("color-scheme")
    ? appCss
    : mainWorkspace;
  if (!themeSource.includes(themeToken)) {
    console.error(`Versions 主题实现缺少：${themeToken}`);
    failed = true;
  }
}

for (const scriptName of releaseScripts) {
  const command = packageJson.scripts?.[scriptName];
  if (typeof command !== "string") {
    console.error(`${scriptName} 脚本不存在`);
    failed = true;
    continue;
  }

  if (!command.startsWith("npm run version:check && ")) {
    console.error(`${scriptName} 必须先执行 npm run version:check`);
    failed = true;
  }
}

if (tauriConfig.bundle?.active !== true) {
  console.error("Tauri bundler 必须启用 bundle.active");
  failed = true;
}

const configuredBundleTargets = Array.isArray(tauriConfig.bundle?.targets)
  ? tauriConfig.bundle.targets
  : [];
for (const target of requiredBundleTargets) {
  if (!configuredBundleTargets.includes(target)) {
    console.error(`Tauri bundle targets 缺少 ${target}`);
    failed = true;
  }
}

if (!packageJson.scripts?.["release:windows"]?.includes("--bundles nsis")) {
  console.error("release:windows 必须构建 NSIS 安装包");
  failed = true;
}

if (tauriConfig.bundle?.windows?.nsis?.installerHooks !== "nsis-hooks.nsh") {
  console.error("Windows NSIS 安装包必须加载 Explorer 菜单钩子");
  failed = true;
}

for (const action of ["Commit", "Log", "Update"]) {
  for (const registryPath of [
    `Software\\Classes\\Directory\\shell\\NovaSVN.${action}`,
    `Software\\Classes\\Directory\\Background\\shell\\NovaSVN.${action}`,
    `Software\\Classes\\*\\shell\\NovaSVN.${action}`,
  ]) {
    if (
      !nsisHooks.includes(`WriteRegStr HKCU "${registryPath}"`) ||
      !nsisHooks.includes(`DeleteRegKey HKCU "${registryPath}"`)
    ) {
      console.error(`Windows 安装/卸载缺少 Explorer ${action} 注册表入口：${registryPath}`);
      failed = true;
    }
  }
}

const blameRegistryPath = "Software\\Classes\\*\\shell\\NovaSVN.Blame";
if (
  !nsisHooks.includes(`WriteRegStr HKCU "${blameRegistryPath}"`) ||
  !nsisHooks.includes(`DeleteRegKey HKCU "${blameRegistryPath}"`) ||
  nsisHooks.includes("Software\\Classes\\Directory\\shell\\NovaSVN.Blame") ||
  nsisHooks.includes("Software\\Classes\\Directory\\Background\\shell\\NovaSVN.Blame")
) {
  console.error("Windows Explorer Blame 必须仅注册到文件右键菜单并支持完整卸载");
  failed = true;
}

if (
  !nsisHooks.includes('"MUIVerb" "NovaSVN Commit"') ||
  !nsisHooks.includes('"MUIVerb" "NovaSVN Log"') ||
  !nsisHooks.includes('"MUIVerb" "NovaSVN Update"') ||
  !nsisHooks.includes("--novasvn-action") ||
  !nsisHooks.includes("%1") ||
  !nsisHooks.includes("%V")
) {
  console.error("Windows Explorer Log 菜单必须传递文件、目录和目录背景路径");
  failed = true;
}

if (!packageJson.scripts?.["release:macos"]?.includes("scripts/release-macos.sh")) {
  console.error("release:macos 必须调用统一 macOS 发布脚本");
  failed = true;
}

if (
  !packageJson.scripts?.["release:macos:notarized"]?.includes("scripts/release-macos.sh --notarize") ||
  !macosReleaseScript.includes("build-macos-finder-sync.sh") ||
  !macosReleaseScript.includes("tauri build --bundles dmg --no-sign") ||
  !macosReleaseScript.includes("inject-macos-finder-sync-into-dmg.sh") ||
  !macosReleaseScript.includes("verify-macos-release.sh") ||
  !macosReleaseScript.includes("notarize-macos-release.sh")
) {
  console.error("macOS 发布必须构建 Finder Sync、注入 DMG、分级验收并支持 notarization");
  failed = true;
}

if (
  !macosFinderSyncDmgInjectScript.includes("Contents/PlugIns") ||
  !macosFinderSyncDmgInjectScript.includes("codesign --force --sign -") ||
  !macosFinderSyncDmgInjectScript.includes("APPLE_SIGNING_IDENTITY") ||
  !macosFinderSyncDmgInjectScript.includes("--options runtime") ||
  !macosFinderSyncDmgInjectScript.includes('sign "${SIGNING_IDENTITY}" "${DMG_PATH}"') ||
  !macosFinderSyncDmgInjectScript.includes("hdiutil convert")
) {
  console.error("Finder Sync DMG 注入脚本必须嵌入扩展并签名扩展、App 和 DMG");
  failed = true;
}

if (
  tauriConfig.identifier.endsWith(".app") ||
  !macosFinderSyncInfo.includes(`${tauriConfig.identifier}.finder-sync`) ||
  !macosFinderSyncXcodeProject.includes(`PRODUCT_BUNDLE_IDENTIFIER = ${tauriConfig.identifier}.finder-sync`)
) {
  console.error("macOS Bundle Identifier 必须稳定且 Finder Sync 必须使用应用标识前缀");
  failed = true;
}

if (!macosFinderSyncXcodeProject.includes("FinderSync.framework")) {
  console.error("Finder Sync Xcode 工程必须链接 FinderSync framework");
  failed = true;
}

if (!macosFinderSyncXcodeScheme.includes('BuildableName = "NovaSVNFinderSync.appex"')) {
  console.error("Finder Sync Xcode 工程必须提供共享 scheme 以便命令行稳定构建");
  failed = true;
}

if (
  !macosFinderSyncBuildScript.includes("xcodebuild") ||
  !macosFinderSyncBuildScript.includes("NovaSVNFinderSync.xcodeproj") ||
  !macosFinderSyncBuildScript.includes("-scheme NovaSVNFinderSync") ||
  !macosFinderSyncBuildScript.includes("generic/platform=macOS") ||
  !macosFinderSyncBuildScript.includes("CODE_SIGNING_ALLOWED=NO")
) {
  console.error("Finder Sync 构建脚本必须使用 Xcode extension target 并由脚本统一签名");
  failed = true;
}

if (
  !macosFinderSyncBuildScript.includes("APPLE_SIGNING_IDENTITY") ||
  !macosFinderSyncBuildScript.includes("--options runtime")
) {
  console.error("Finder Sync 构建必须支持 ad-hoc 与 Developer ID hardened runtime 签名");
  failed = true;
}

if (
  !macosFinderSyncEntitlements.includes("com.apple.security.app-sandbox") ||
  !macosFinderSyncBuildScript.includes("--entitlements") ||
  !macosFinderSyncDmgInjectScript.includes("--entitlements")
) {
  console.error("Finder Sync 扩展必须启用 App Sandbox entitlement");
  failed = true;
}

for (const token of [
  "codesign --verify --deep --strict",
  "spctl --assess --type execute",
  "stapler validate",
  "macos-finder-quick-actions.sh",
  "document.wflow",
  "shasum -a 256",
]) {
  if (!macosReleaseVerifyScript.includes(token)) {
    console.error(`macOS 发布验收缺少：${token}`);
    failed = true;
  }
}

for (const token of [
  "notarytool submit",
  "NOVASVN_NOTARY_PROFILE",
  "--keychain-profile",
  "stapler staple",
  "stapler validate",
]) {
  if (!macosNotarizeScript.includes(token)) {
    console.error(`macOS notarization 流程缺少：${token}`);
    failed = true;
  }
}

for (const token of [
  "macos-finder-sync",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "MARKETING_VERSION",
  "CURRENT_PROJECT_VERSION",
  "package-lock.json",
]) {
  if (!syncVersionScript.includes(token)) {
    console.error(`版本同步未覆盖 Finder Sync：${token}`);
    failed = true;
  }
}

if (!packageJson.scripts?.["test:scripts"]?.includes("test-release-artifacts.mjs")) {
  console.error("脚本门禁必须执行发布产物清单回归");
  failed = true;
}

if (
  packageJson.scripts?.["release:manifest"] !== "node scripts/release-artifacts.mjs generate" ||
  packageJson.scripts?.["release:manifest:verify"] !== "node scripts/release-artifacts.mjs verify"
) {
  console.error("发布产物清单必须提供统一生成和校验入口");
  failed = true;
}

for (const token of [
  "schema_version",
  "manual_signed_installer",
  "sha256File",
  "safeArtifactPath",
  "isSymbolicLink",
  "rejectDuplicateArtifacts",
  "validateRequiredPlatforms",
]) {
  if (!releaseArtifactsScript.includes(token)) {
    console.error(`发布产物清单缺少：${token}`);
    failed = true;
  }
}

if (
  !releaseArtifactsTest.includes("产物被修改后必须校验失败") ||
  !macosReleaseVerifyScript.includes("release-artifacts.mjs")
) {
  console.error("发布产物清单必须覆盖防篡改回归并接入 macOS 验收");
  failed = true;
}

for (const scriptName of benchmarkScripts) {
  const command = packageJson.scripts?.[scriptName];
  if (typeof command !== "string") {
    console.error(`${scriptName} 脚本不存在`);
    failed = true;
    continue;
  }

  if (!command.includes("--example performance_benchmark")) {
    console.error(`${scriptName} 必须调用跨平台 Rust 性能基准`);
    failed = true;
  }
}

if (!packageJson.scripts?.["benchmark:svn:reset"]?.includes("--reset")) {
  console.error("benchmark:svn:reset 必须传入 --reset");
  failed = true;
}

if (!packageJson.scripts?.["benchmark:svn:quick"]?.includes("--quick")) {
  console.error("benchmark:svn:quick 必须传入 --quick");
  failed = true;
}
if (!packageJson.scripts?.["benchmark:svn:quick"]?.includes(".benchmark/svn-quick")) {
  console.error("快速性能基准必须使用独立数据集目录");
  failed = true;
}

for (const token of [
  "benchmark-results.json",
  "benchmark-results.md",
  "scan_workspace_status",
  "list_workspace_files",
  "get_file_diff",
  "get_svn_blame",
  "get_svn_log",
  "STATUS_PAGE_SIZE",
  "threshold_ms",
]) {
  if (!performanceBenchmarkRs.includes(token)) {
    console.error(`跨平台性能基准缺少：${token}`);
    failed = true;
  }
}

if (!performanceBenchmarkRs.includes('arg("revert")') || !performanceBenchmarkRs.includes('arg("-R")')) {
  console.error("性能基准每次运行前必须还原工作副本，避免累积改动影响对比");
  failed = true;
}

if (!benchmarkDoc.includes("benchmark-results.md")) {
  console.error("性能基准文档必须说明 Markdown 摘要输出");
  failed = true;
}

if (!benchmarkDoc.includes("svn revert -R") || !benchmarkDoc.includes("5000 行 Blame")) {
  console.error("性能基准文档必须说明脚本会在每次运行前还原工作副本");
  failed = true;
}

if (!benchmarkScript.includes('"--example", "performance_benchmark"')) {
  console.error("PowerShell 性能入口必须复用跨平台 Rust 基准");
  failed = true;
}

if (
  !workspaceRs.includes("parse_versioned_workspace_paths_reader") ||
  !workspaceRs.includes("MAX_VERSIONED_WORKSPACE_PATHS") ||
  !workspaceRs.includes("MAX_SVN_INFO_METADATA_POOL_BYTES") ||
  !workspaceRs.includes("CompactWorkspaceMetadata") ||
  !workspaceRs.includes(".stdout(Stdio::piped())")
) {
  console.error("工作副本文件树必须流式读取 svn info，并限制路径与元数据内存");
  failed = true;
}

const fileBrowserStart = mainWorkspace.indexOf('class="file-browser"');
const fileBrowserEnd = mainWorkspace.indexOf('class="inspector-resizer"', fileBrowserStart);
const fileBrowserSource = mainWorkspace.slice(fileBrowserStart, fileBrowserEnd);
if (
  fileBrowserStart < 0 ||
  fileBrowserEnd < 0 ||
  !taskRs.includes("SvnOperationKind::UpdatePath") ||
  !taskRs.includes('format!("执行 svn update：{file_path}")') ||
  !fileBrowserSource.includes("Commit") ||
  !fileBrowserSource.includes("Update") ||
  !fileBrowserSource.includes("Resolve") ||
  fileBrowserSource.includes('role="button"')
) {
  console.error("文件行必须按状态使用真实按钮提供 Commit、Update、Add、Resolve 和菜单操作");
  failed = true;
}

if (
  !fileBrowserSource.includes('aria-label="选择当前可见路径"') ||
  !mainWorkspace.includes('class="batch-action-bar"') ||
  !mainWorkspace.includes("onRevertPaths(selectedRevertablePaths)") ||
  !mainWorkspace.includes("onMovePaths(selectedMovablePaths)") ||
  !mainWorkspace.includes("onDeletePaths(selectedDeletablePaths)") ||
  !taskRs.includes("MAX_BATCH_OPERATION_PATHS") ||
  !taskRs.includes("SvnBatchOperationKind::Revert") ||
  !taskRs.includes("SvnBatchOperationKind::Move") ||
  !taskRs.includes("SvnBatchOperationKind::Delete")
) {
  console.error("工作副本多选必须提供批量提交目标、Revert、Move、Delete 和后端路径边界");
  failed = true;
}

for (const column of ["Name", "Base", "Last", "Date", "Author", "Status", "Size"]) {
  if (!mainWorkspace.includes(`<span role="columnheader">${column}</span>`)) {
    console.error(`Versions 工作副本表格缺少栏位：${column}`);
    failed = true;
  }
}

if (
  !fileBrowserSource.includes('role="treegrid"') ||
  !fileBrowserSource.includes("aria-activedescendant") ||
  !mainWorkspace.includes('case "ArrowUp"') ||
  !mainWorkspace.includes('case "ArrowDown"') ||
  !mainWorkspace.includes('case "ArrowLeft"') ||
  !mainWorkspace.includes('case "ArrowRight"') ||
  !mainWorkspace.includes('case "Home"') ||
  !mainWorkspace.includes('case "End"')
) {
  console.error("工作副本文件表必须提供 treegrid 活动行和完整方向键导航");
  failed = true;
}

if (
  !fileBrowserSource.includes("on:dblclick") ||
  !mainWorkspace.includes("onOpenWorkspaceFile(node.path)") ||
  !externalToolRs.includes("canonical_target.starts_with(&canonical_root)") ||
  !externalToolRs.includes('(\"explorer\", vec![target.display().to_string()])') ||
  externalToolRs.includes('\"cmd\"')
) {
  console.error("双击打开必须使用安全工作副本路径和无命令解释器的系统默认应用入口");
  failed = true;
}

if (
  !fileBrowserSource.includes("on:contextmenu") ||
  !mainWorkspace.includes('class="workspace-context-menu"') ||
  !mainWorkspace.includes('event.key === "ContextMenu"') ||
  !mainWorkspace.includes('event.shiftKey && event.key === "F10"') ||
  !mainWorkspace.includes("runContextRevert") ||
  !mainWorkspace.includes("runContextMove") ||
  !mainWorkspace.includes("runContextDelete")
) {
  console.error("工作副本路径必须提供状态化右键菜单、批量操作和键盘入口");
  failed = true;
}

if (
  !mainWorkspace.includes('role="tablist"') ||
  !mainWorkspace.includes('role="tab"') ||
  !mainWorkspace.includes('role="tabpanel"') ||
  !mainWorkspace.includes('{ id: "information", label: "Information" }') ||
  !mainWorkspace.includes('{ id: "properties", label: "Properties" }') ||
  !mainWorkspace.includes('{ id: "diff", label: "Diff" }') ||
  !mainWorkspace.includes('{ id: "blame", label: "Blame" }')
) {
  console.error("Versions 检查器必须使用可访问标签组织 Information、Properties、Diff 和 Blame");
  failed = true;
}

if (
  !tauriLib.includes('"current_path_menu"') ||
  !tauriLib.includes('fn sync_app_menu_state(') ||
  !tauriLib.includes('set_menu_item_enabled(&current_path_menu') ||
  !appMenuSource.includes('case "path_open"') ||
  !appMenuSource.includes('case "path_delete"') ||
  !appSvelte.includes("dispatchAppMenuPathCommand") ||
  !mainWorkspace.includes("onActiveWorkspacePathChange(path)") ||
  !appMenuSource.includes("export function buildAppMenuState")
) {
  console.error("应用原生菜单必须提供当前路径操作、活动行同步和动态禁用状态");
  failed = true;
}

if (
  !mainWorkspace.includes("groupTimelineEntries") ||
  !mainWorkspace.includes('class="timeline-day-group"') ||
  !mainWorkspace.includes('class="timeline-day-header"') ||
  !mainWorkspace.includes('class="timeline-changed-paths"') ||
  !mainWorkspace.includes("expandedTimelineRevisions")
) {
  console.error("Timeline 必须按日期分组，并完整展示可展开的 revision 改变路径");
  failed = true;
}

if (
  !mainWorkspace.includes("openChangedPathRevisionDiff") ||
  !mainWorkspace.includes('class="timeline-changed-path-button"') ||
  !appStore.includes("repositoryPathUrl") ||
  !taskRs.includes("target_url") ||
  !taskRs.includes("payload.target_url.as_deref().unwrap_or(root)")
) {
  console.error("Timeline 改变路径必须通过目标仓库 URL 执行真实 Revision Diff");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="Timeline 开始日期"') ||
  !mainWorkspace.includes('aria-label="Timeline 结束日期"') ||
  !mainWorkspace.includes("nextLocalDay") ||
  !mainWorkspace.includes("clearTimelineFilters")
) {
  console.error("Timeline 必须提供包含结束日全天的日期范围过滤和清除入口");
  failed = true;
}

if (
  !mainWorkspace.includes('class="timeline-filter-summary"') ||
  !mainWorkspace.includes('aria-label="加载更多 Revision"') ||
  !appSvelte.includes("setSvnLogFileOnlyAndRefresh") ||
  !appStore.includes("svnLog: state.svnLogFileOnly === value ? state.svnLog : null")
) {
  console.error("Timeline 组合过滤必须正确重载文件范围、保留分页并显示结果状态");
  failed = true;
}

if (
  !mainWorkspace.includes("selectedComparisonRevisions") ||
  !mainWorkspace.includes('aria-label="Revision 比较选择"') ||
  !mainWorkspace.includes('class="timeline-entry-summary"') ||
  !mainWorkspace.includes("onPrepareRevisionDiffRange(range[0], range[1])") ||
  !mainWorkspace.includes("onRunRevisionDiff()") ||
  !appStore.includes("function prepareRevisionDiffRange(") ||
  !appSvelte.includes("onPrepareRevisionDiffRange={workspaceStore.prepareRevisionDiffRange}")
) {
  console.error("Timeline 双 Revision 选择必须准备有序范围并执行真实 Revision Diff 任务");
  failed = true;
}

if (
  !mainWorkspace.includes("compareSelectedFileWithRevision") ||
  !mainWorkspace.includes('class="timeline-working-copy-compare"') ||
  !mainWorkspace.includes("onPrepareWorkingCopyFileRevisionDiff") ||
  !appStore.includes("function prepareWorkingCopyFileRevisionDiff(") ||
  !appSvelte.includes("filePath: form.filePath") ||
  !taskRs.includes("request.file_path") ||
  !taskRs.includes("Path::new(root).join(file_path)")
) {
  console.error("Timeline 必须把选中文件和任意 revision 传给真实工作副本 Revision Diff");
  failed = true;
}

if (
  !mainWorkspace.includes('class="timeline-revert-revision"') ||
  !mainWorkspace.includes("onRevertToRevision(entry.revision)") ||
  !appSvelte.includes("revertWorkspaceToRevision") ||
  !appSvelte.includes('"revert_to_revision"') ||
  !taskRs.includes("fn execute_revert_revision(") ||
  !taskRs.includes('["merge", "--ignore-ancestry", "-r"]') ||
  !tauriLib.includes("create_revert_revision_task")
) {
  console.error("Timeline Revert 到 Revision 必须执行带运行时安全检查的真实反向 Merge");
  failed = true;
}

if (
  !mainWorkspace.includes('class="revision-patch-location"') ||
  !mainWorkspace.includes("revisionDiffResult.patch_file_path") ||
  !mainWorkspace.includes("显示完整 Patch 位置") ||
  !appStore.includes("完整 Patch 文件位置不可用") ||
  !taskRs.includes("analyze_revision_diff_file") ||
  !taskRs.includes("copy_revision_diff_patch") ||
  !taskRs.includes("MAX_REVISION_DIFF_PATCH_BYTES") ||
  !taskRs.includes("Revision diff 完整 Patch 写入失败")
) {
  console.error("截断的 Revision Diff 必须保留完整 Patch，并在界面明确显示文件位置");
  failed = true;
}

if (
  !taskRs.includes('command.arg("--record-only")') ||
  !taskRs.includes('command.arg("--ignore-ancestry")') ||
  !taskRs.includes('command.arg("--force")') ||
  !taskRs.includes("validate_merge_tracking_options") ||
  !mainWorkspace.includes('aria-label="Merge tracking 参数"') ||
  !mainWorkspace.includes('aria-label="Merge 结果统计"') ||
  !appSvelte.includes("recordOnly: form.recordOnly") ||
  !appStore.includes("record_only: request.recordOnly")
) {
  console.error("Merge 必须支持 revision 预览与常用 merge tracking 参数");
  failed = true;
}

if (
  !taskRs.includes("执行前工作副本状态复检通过") ||
  !taskRs.includes("merge_workspace_has_local_changes(&payload.svn_executable, &root)") ||
  !appSvelte.includes("workspaceStore.focusConflictResolution()") ||
  !appStore.includes("function focusConflictResolution()") ||
  !mainWorkspace.includes("inspectorSelectionSignature")
) {
  console.error("Merge 必须在执行前复检工作副本，并把冲突带入 Resolve 工作流");
  failed = true;
}

if (
  !taskRs.includes("adds_commits_and_reverts_nested_file_in_real_working_copy") ||
  !taskRs.includes("create_commit_task(CreateCommitTaskRequest") ||
  !taskRs.includes("kind: SvnOperationKind::RevertFile")
) {
  console.error("真实临时 SVN 仓库测试必须覆盖 Add、Commit 和单文件 Revert");
  failed = true;
}

if (
  !taskRs.includes("APPLY_PATCH_OUTPUT_PREVIEW_MAX_BYTES") ||
  !taskRs.includes("APPLY_PATCH_TASK_LOG_MAX_BYTES") ||
  !taskRs.includes("APPLY_PATCH_TASK_LOG_MAX_LINES") ||
  !taskRs.includes("run_apply_patch_command(state, task_id, &mut preflight_command)") ||
  !taskRs.includes("append_apply_patch_analysis_logs(state, task_id, &preflight_output.analysis)") ||
  !taskRs.includes("MAX_APPLY_PATCH_COMMAND_OUTPUT_BYTES") ||
  !taskRs.includes("fn bounded_apply_patch_output(") ||
  !taskRs.includes("offset_hunks") ||
  !taskRs.includes('root.join("offset.patch")') ||
  !mainWorkspace.includes("applyPatchResult.output_truncated") ||
  !mainWorkspace.includes("applyPatchResult.offset_hunks")
) {
  console.error("Apply Patch 必须覆盖偏移应用，并限制任务日志和 IPC 输出预览");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="仓库 Revision"') ||
  !mainWorkspace.includes('class="repository-revision-status"') ||
  !appSvelte.includes("revision: $workspaceStore.repositoryRevisionInput") ||
  !appStore.includes("repositoryRevisionInput") ||
  !taskRs.includes('command.args(["-r", revision])') ||
  !taskRs.includes("revision: revision.map(ToString::to_string)")
) {
  console.error("Repository 浏览必须把指定 Revision 贯穿 URL 导航和真实 svn list 请求");
  failed = true;
}

if (
  !mainWorkspace.includes("Last Revision") ||
  !mainWorkspace.includes("repositoryEntryKindLabel") ||
  !mainWorkspace.includes("title={entry.author || undefined}") ||
  !mainWorkspace.includes("title={entry.date || undefined}") ||
  !taskRs.includes("struct StreamingRepositoryListEntry") ||
  !taskRs.includes("entry.revision = attribute") ||
  !taskRs.includes("RepositoryListTextField::Author") ||
  !taskRs.includes("RepositoryListTextField::Date")
) {
  console.error("Repository 条目必须显示 Last Revision、作者、日期和准确类型");
  failed = true;
}

if (
  !taskRs.includes("run_merge_command(state, task_id, &mut command)") ||
  !taskRs.includes("MAX_MERGE_COMMAND_OUTPUT_BYTES") ||
  !taskRs.includes("analyze_merge_output_files") ||
  !taskRs.includes("Merge 输出预览已截断") ||
  !mainWorkspace.includes("mergeResult.output_truncated")
) {
  console.error("Merge 必须使用有界输出 collector，并明确标记截断预览");
  failed = true;
}

if (
  !taskRs.includes('TaskCommandOutputFile::create(task_id, "repository-list", "xml")') ||
  !taskRs.includes("parse_repository_list_xml_reader(") ||
  !taskRs.includes("MAX_REPOSITORY_LIST_XML_BYTES") ||
  !taskRs.includes("MAX_REPOSITORY_LIST_ENTRIES") ||
  !taskRs.includes("MAX_REPOSITORY_LIST_FIELD_BYTES") ||
  !taskRs.includes("MAX_REPOSITORY_LIST_TEXT_BYTES")
) {
  console.error("Repository List 必须使用受限临时文件和有界流式 XML 解析");
  failed = true;
}

if (
  !mainWorkspace.includes("onOpenRepositoryFile(entry.name)") ||
  !mainWorkspace.includes("打开仓库文件 ${entry.name} 的临时副本") ||
  !appSvelte.includes("openRepositoryTempFile({ path: result.file_path })") ||
  !appSvelte.includes("pendingRepositoryFileTaskId") ||
  !appStore.includes("function markRepositoryFileTask(") ||
  !taskRs.includes("TaskPayload::RepositoryFile") ||
  !taskRs.includes(".stdout(std::process::Stdio::from(file))") ||
  !taskRs.includes("repository_url_with_peg_revision(&payload.url") ||
  !taskRs.includes("repository_file: Some(RepositoryFileResult")
) {
  console.error("Repository 文件必须通过真实 svn cat 流式下载，并从独立 pending 任务打开安全临时副本");
  failed = true;
}

if (
  !mainWorkspace.includes("查看仓库文件 ${entry.name} 的 Log") ||
  !mainWorkspace.includes('aria-label="仓库文件日志"') ||
  !appSvelte.includes("workspaceStore.loadRepositoryFileLog({") ||
  !appStore.includes("function loadMoreRepositoryFileLog(") ||
  !workspaceRs.includes("pub fn get_repository_file_log(") ||
  !workspaceRs.includes('["log", "--xml", "--verbose", "--limit"]') ||
  !workspaceRs.includes("repository_url_with_peg_revision(&url")
) {
  console.error("Repository 文件 Log 必须限定当前历史 Revision，支持真实 svn log 分页并使用独立界面状态");
  failed = true;
}

if (
  !mainWorkspace.includes("查看仓库文件 ${entry.name} 的 Blame") ||
  !mainWorkspace.includes('aria-label="仓库文件 Blame"') ||
  !appSvelte.includes("workspaceStore.loadRepositoryFileBlame({") ||
  !appStore.includes("function loadRepositoryFileBlame(") ||
  !workspaceRs.includes("pub fn get_repository_file_blame(") ||
  !workspaceRs.includes('blame_command.args(["blame", "--xml"])') ||
  !workspaceRs.includes("parse_svn_blame_xml(&xml, &content, &url, max_lines)")
) {
  console.error("Repository 文件 Blame 必须在同一历史 Revision 执行真实 blame 与 cat，并使用独立逐行状态");
  failed = true;
}

if (
  !mainWorkspace.includes("查看仓库文件 ${entry.name} 的 Properties") ||
  !mainWorkspace.includes('aria-label="仓库文件 Properties"') ||
  !appSvelte.includes("workspaceStore.loadRepositoryFileProperties({") ||
  !appStore.includes("function loadRepositoryFileProperties(") ||
  !frontendApi.includes('callBackend<SvnProperties>("get_repository_file_properties"') ||
  !tauriLib.includes("get_repository_file_properties,") ||
  !workspaceRs.includes("pub fn get_repository_file_properties(") ||
  !workspaceRs.includes('command.args(["proplist", "--xml", "--verbose"])') ||
  !workspaceRs.includes("repository_url_with_peg_revision(&url")
) {
  console.error("Repository 文件 Properties 必须在当前历史 Revision 执行真实 svn proplist，并使用独立只读状态");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="创建仓库目录"') ||
  !mainWorkspace.includes("准备创建目录") ||
  !appSvelte.includes("pendingRepositoryMkdirTaskId") ||
  !appSvelte.includes("createRepositoryMkdir") ||
  !appSvelte.includes("确定创建仓库目录吗") ||
  !appStore.includes("function markRepositoryMkdirTask(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_mkdir_task"') ||
  !tauriLib.includes("create_repository_mkdir_task,") ||
  !taskRs.includes("TaskPayload::RepositoryMkdir") ||
  !taskRs.includes("fn run_repository_mkdir_task(") ||
  !taskRs.includes('.arg("mkdir")')
) {
  console.error("Repository 创建目录必须要求提交信息与确认，执行真实 svn mkdir，并按 pending 刷新父目录");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="Repository Import"') ||
  !mainWorkspace.includes("准备 Import") ||
  !mainWorkspace.includes("选择 Import 文件") ||
  !mainWorkspace.includes("选择 Import 目录") ||
  !appSvelte.includes("pendingRepositoryImportTaskId") ||
  !appSvelte.includes("确定 Import 到仓库吗") ||
  !appStore.includes("function markRepositoryImportTask(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_import_task"') ||
  !frontendApi.includes("chooseImportSource") ||
  !tauriLib.includes("create_repository_import_task,") ||
  !taskRs.includes("TaskPayload::RepositoryImport") ||
  !taskRs.includes("fn run_repository_import_task(") ||
  !taskRs.includes('.arg("import")') ||
  !taskRs.includes("validate_repository_import_source(Path::new(&payload.source_path))")
) {
  console.error("Repository Import 必须选择文件或目录、要求提交信息与确认、复检本地源并执行真实 svn import");
  failed = true;
}

if (
  !appSvelte.includes(".onDragDropEvent((event) =>") ||
  !appSvelte.includes('event.payload.type !== "drop"') ||
  !appSvelte.includes("event.payload.paths.length !== 1") ||
  !appStore.includes("function prepareRepositoryImportFromDrop(") ||
  !mainWorkspace.includes("class:repository-drop-active={repositoryImportDropActive}")
) {
  console.error("Repository 拖入 Import 必须监听原生拖放、限制单路径、预填目标并显示放置状态");
  failed = true;
}

if (
  packageJson.dependencies?.["@crabnebula/tauri-plugin-drag"] !== "^2.1.0" ||
  !tauriCargo.includes('tauri-plugin-drag = "2.1.1"') ||
  !defaultCapability.includes('"drag:default"') ||
  !tauriLib.includes(".plugin(tauri_plugin_drag::init())") ||
  !frontendApi.includes('callBackend<Task>("create_repository_drag_export_task"') ||
  !taskRs.includes("fn normalize_repository_drag_export_name(") ||
  !taskRs.includes('.join("repository-drag-exports")') ||
  !mainWorkspace.includes("on:pointerdown={(event) =>") ||
  !appSvelte.includes("await startDrag({") ||
  !appSvelte.includes('mode: "copy"')
) {
  console.error("Repository 拖出 Export 必须使用受控临时 svn export 和跨平台原生 copy 拖拽");
  failed = true;
}

if (
  !mainWorkspace.includes("复制当前条目") ||
  !mainWorkspace.includes('aria-label="Repository Copy 源 URL"') ||
  !appSvelte.includes("pendingRepositoryCopyParentUrl") ||
  !appSvelte.includes("确定${operation}吗") ||
  !appStore.includes('kind === "entry"') ||
  !taskRs.includes("RepositoryCopyKind::Entry") ||
  !taskRs.includes("repository_url_with_peg_revision(&payload.source_url") ||
  !taskRs.includes("repository_url_with_peg_revision(&payload.target_url, None)")
) {
  console.error("Repository 通用 Copy 必须支持普通条目、历史 Revision、执行确认和成功后刷新目标父目录");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="Repository Move"') ||
  !mainWorkspace.includes("准备 Move") ||
  !appSvelte.includes("pendingRepositoryMoveSourceParentUrl") ||
  !appSvelte.includes("确定移动仓库条目吗") ||
  !appStore.includes("function markRepositoryMoveTask(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_move_task"') ||
  !tauriLib.includes("create_repository_move_task,") ||
  !taskRs.includes("TaskPayload::RepositoryMove") ||
  !taskRs.includes("fn run_repository_move_task(") ||
  !taskRs.includes('.arg("move")')
) {
  console.error("Repository Move 必须要求提交信息与确认，执行真实 svn move，并刷新受影响的父目录");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="Repository Rename"') ||
  !mainWorkspace.includes("准备 Rename") ||
  !appSvelte.includes("pendingRepositoryMoveKind") ||
  !appSvelte.includes("确定重命名仓库条目吗") ||
  !appStore.includes("function prepareRepositoryRename(") ||
  !taskRs.includes("RepositoryMoveKind::Rename") ||
  !taskRs.includes("REPOSITORY_RENAME_PARENT_MISMATCH")
) {
  console.error("Repository Rename 必须限制同一父目录、使用独立表单与错误状态，并执行真实 svn move");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="Repository Delete"') ||
  !mainWorkspace.includes("准备 Delete") ||
  !appSvelte.includes("pendingRepositoryDeleteTaskId") ||
  !appSvelte.includes("确定永久删除仓库条目吗") ||
  !appStore.includes("function markRepositoryDeleteTask(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_delete_task"') ||
  !tauriLib.includes("create_repository_delete_task,") ||
  !taskRs.includes("TaskPayload::RepositoryDelete") ||
  !taskRs.includes("fn run_repository_delete_task(") ||
  !taskRs.includes('.arg("delete")')
) {
  console.error("Repository Delete 必须要求提交信息与破坏性确认，执行真实 svn delete，并刷新目标父目录");
  failed = true;
}

const repositoryWritePermissionCallCount =
  taskRs.match(/repository_write_command_error_detail\(/g)?.length ?? 0;
if (
  repositoryWritePermissionCallCount !== 6 ||
  !taskRs.includes("仓库写入被拒绝") ||
  !taskRs.includes('"e175013"') ||
  !taskRs.includes('"authentication failed"') ||
  !appSvelte.includes('workspaceStore.setRepositoryRevisionInput("")') ||
  !appSvelte.includes("void loadRepositoryUrl(url)")
) {
  console.error("Repository 写操作必须统一权限错误，并在成功后切回 HEAD 刷新目标目录");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="仓库 Checkout"') ||
  !mainWorkspace.includes("准备 Checkout") ||
  !mainWorkspace.includes("选择父目录") ||
  !appSvelte.includes("pendingRepositoryCheckoutTaskId") ||
  !appSvelte.includes("createRepositoryCheckout") ||
  !appStore.includes("function markRepositoryCheckoutTask(") ||
  !appStore.includes("function prepareRepositoryCheckout(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_checkout_task"') ||
  !frontendApi.includes("chooseCheckoutDirectory") ||
  !tauriLib.includes("create_repository_checkout_task,") ||
  !taskRs.includes("TaskPayload::RepositoryCheckout") ||
  !taskRs.includes("fn run_repository_checkout_task(") ||
  !taskRs.includes("validate_checkout_destination(Path::new(&payload.local_path))") ||
  !taskRs.includes("repository_url_with_peg_revision(&payload.url, payload.revision.as_deref())")
) {
  console.error("Repository Checkout 必须映射 URL/Revision/本地路径，执行真实 svn checkout，并按 pending 打开工作副本");
  failed = true;
}

if (
  !mainWorkspace.includes('aria-label="仓库 Export"') ||
  !mainWorkspace.includes("准备 Export") ||
  !appSvelte.includes("pendingRepositoryExportTaskId") ||
  !appSvelte.includes("createRepositoryExport") ||
  !appSvelte.includes("openLocalPathLocation({ path: localPath })") ||
  !appStore.includes("function markRepositoryExportTask(") ||
  !appStore.includes("function prepareRepositoryExport(") ||
  !frontendApi.includes('callBackend<Task>("create_repository_export_task"') ||
  !frontendApi.includes("chooseExportDirectory") ||
  !frontendApi.includes('callBackend<OpenLocalPathLocation>("open_local_path_location"') ||
  !tauriLib.includes("create_repository_export_task,") ||
  !tauriLib.includes("open_local_path_location,") ||
  !taskRs.includes("TaskPayload::RepositoryExport") ||
  !taskRs.includes("fn run_repository_export_task(") ||
  !taskRs.includes('command.arg("export")') ||
  !taskRs.includes("validate_export_destination(Path::new(&payload.local_path))")
) {
  console.error("Repository Export 必须执行真实 svn export，成功后打开本地路径位置且不打开工作副本");
  failed = true;
}

if (
  !workspaceRs.includes('node.has_tag_name("repos-status")') ||
  !workspaceRs.includes('node.has_tag_name("against")') ||
  !workspaceRs.includes("pub enum ChangeScope") ||
  !workspaceRs.includes("remote_updates_checked") ||
  !mainWorkspace.includes('workingCopyTreeFilter === "local"') ||
  !mainWorkspace.includes('workingCopyTreeFilter === "remote"')
) {
  console.error("工作副本必须区分本地、远端和组合状态，并提供独立筛选");
  failed = true;
}

if (packageJson.scripts?.["test:e2e"] !== "playwright test") {
  console.error("test:e2e 必须执行 Playwright 测试");
  failed = true;
}

if (packageJson.scripts?.["test:e2e:install"] !== "playwright install chromium") {
  console.error("test:e2e:install 必须安装 Playwright Chromium");
  failed = true;
}

const printOnlyGuardIndex = syncVersionScript.indexOf("if (shouldPrint && !requestedVersion)");
const packageWriteIndex = syncVersionScript.indexOf("writeJson(packagePath, packageJson)");
if (printOnlyGuardIndex < 0 || packageWriteIndex < 0 || printOnlyGuardIndex > packageWriteIndex) {
  console.error("version:print 不能在未设置新版本时写回版本文件");
  failed = true;
}

if (!playwrightConfig.includes('testDir: "./tests/e2e"')) {
  console.error("Playwright 配置必须指向 tests/e2e");
  failed = true;
}

if (!playwrightConfig.includes("webServer")) {
  console.error("Playwright 配置必须包含 webServer 冒烟测试入口");
  failed = true;
}

const prohibitedUiEffects = [
  "linear-gradient",
  "radial-gradient",
  "rgba(",
  "hsla(",
  "backdrop-filter",
  "box-shadow",
  "transparent",
  "opacity:",
];
for (const effect of prohibitedUiEffects) {
  if (appCss.includes(effect)) {
    console.error(`纯色 UI 方案不能包含 ${effect}`);
    failed = true;
  }
}

for (const assertion of e2eSmokeAssertions) {
  if (!e2eSmokeSpec.includes(assertion)) {
    console.error(`E2E 冒烟测试缺少关键断言：${assertion}`);
    failed = true;
  }
}

for (const operation of [
  "create_svn_operation_task",
  "create_commit_task",
  "create_merge_task",
  "create_apply_patch_task",
  'kind: "add_file"',
  'kind: "delete_path"',
  'kind: "revert_file"',
  'kind: "update_path"',
]) {
  if (!e2eOperationsSpec.includes(operation)) {
    console.error(`主工作台 E2E 缺少操作覆盖：${operation}`);
    failed = true;
  }
}

for (const action of systemIntegrationActions) {
  if (!windowsExplorerScript.includes(`Action = "${action}"`)) {
    console.error(`Windows Explorer 菜单缺少 action：${action}`);
    failed = true;
  }

  if (!macosFinderScript.includes(`|${action}"`)) {
    console.error(`macOS Finder Quick Action 缺少 action：${action}`);
    failed = true;
  }

  if (!macosFinderSyncSource.includes(`"${action}"`)) {
    console.error(`macOS Finder Sync 扩展缺少 action：${action}`);
    failed = true;
  }
}

if (!windowsExplorerScript.includes("--novasvn-path")) {
  console.error("Windows Explorer 菜单命令必须传递 --novasvn-path");
  failed = true;
}

if (!windowsExplorerScript.includes("%1") || !windowsExplorerScript.includes("%V")) {
  console.error("Windows Explorer 菜单必须同时支持文件/目录和目录背景路径占位符");
  failed = true;
}

if (!macosFinderScript.includes('--novasvn-path "\\$f"')) {
  console.error("macOS Finder Quick Action 必须传递选中的 Finder 路径");
  failed = true;
}

if (
  !macosFinderSyncSource.includes('"NovaSVN"') ||
  !macosFinderSyncSource.includes('"--novasvn-path"') ||
  !macosFinderSyncSource.includes("FIMenuKind")
) {
  console.error("macOS Finder Sync 扩展必须提供 Finder 右键菜单并传递选中路径");
  failed = true;
}

if (
  !macosFinderSyncSource.includes("rootItem.submenu = submenu") ||
  !macosFinderSyncSource.includes('addMenuItem:@"提交"')
) {
  console.error("macOS Finder Sync 扩展必须把操作收进 NovaSVN 统一上级菜单");
  failed = true;
}

for (const action of systemIntegrationActions.filter(
  (value) => value !== "open" && value !== "commit" && value !== "log" && value !== "update",
)) {
  if (!appSvelte.includes(`case "${action}":`)) {
    console.error(`启动意图分发缺少 action：${action}`);
    failed = true;
  }
}

if (
  !windowsExplorerScript.includes('Action = "blame"; FilesOnly = $true') ||
  !windowsExplorerScript.includes('$item.FilesOnly -eq $true')
) {
  console.error("Windows Explorer 脚本必须仅为文件注册 Blame 菜单");
  failed = true;
}

const standaloneLogStartupStart = appSvelte.indexOf('if (intent.action === "log")');
const standaloneLogStartupEnd = appSvelte.indexOf('startupSurface = "main"', standaloneLogStartupStart);
const standaloneLogStartup = appSvelte.slice(standaloneLogStartupStart, standaloneLogStartupEnd);
if (
  standaloneLogStartupStart < 0 ||
  standaloneLogStartupEnd < 0 ||
  !standaloneLogStartup.includes('startupSurface = "log"') ||
  !standaloneLogStartup.includes("standaloneLogReady = true") ||
  standaloneLogStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneLogWindow") ||
  !standaloneLogWindow.includes("getPathSvnLog") ||
  !standaloneLogWindow.includes("start_revision: startRevision") ||
  !tauriLib.includes('Some("log") => Some("NovaSVN Log")') ||
  !tauriLib.includes("window.set_title(title)") ||
  !tauriLib.includes("app.remove_menu()") ||
  !workspaceRs.includes("pub fn get_path_svn_log(")
) {
  console.error("Explorer Log 必须打开不恢复工作副本、不扫描状态的独立日志窗口");
  failed = true;
}

const standaloneBlameStartupStart = appSvelte.indexOf('if (intent.action === "blame")');
const standaloneBlameStartupEnd = appSvelte.indexOf(
  'if (intent.action === "log")',
  standaloneBlameStartupStart,
);
const standaloneBlameStartup = appSvelte.slice(
  standaloneBlameStartupStart,
  standaloneBlameStartupEnd,
);
if (
  standaloneBlameStartupStart < 0 ||
  standaloneBlameStartupEnd < 0 ||
  !standaloneBlameStartup.includes('startupSurface = "blame"') ||
  !standaloneBlameStartup.includes("standaloneBlameReady = true") ||
  standaloneBlameStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneBlameWindow") ||
  !standaloneBlameWindow.includes("inspectUpdateTarget") ||
  !standaloneBlameWindow.includes("getSvnBlame") ||
  !standaloneBlameWindow.includes("max_lines: 5000") ||
  !tauriLib.includes('Some("blame") => Some("NovaSVN Blame")') ||
  !systemIntegrationRs.includes('"blame"')
) {
  console.error("Explorer Blame 必须仅为文件打开不恢复工作副本的独立逐行历史窗口");
  failed = true;
}

const standaloneCommitStartupStart = appSvelte.indexOf('if (intent.action === "commit")');
const standaloneCommitStartupEnd = appSvelte.indexOf(
  'startupSurface = "main"',
  standaloneCommitStartupStart,
);
const standaloneCommitStartup = appSvelte.slice(
  standaloneCommitStartupStart,
  standaloneCommitStartupEnd,
);
if (
  standaloneCommitStartupStart < 0 ||
  standaloneCommitStartupEnd < 0 ||
  !standaloneCommitStartup.includes('startupSurface = "commit"') ||
  !standaloneCommitStartup.includes("standaloneCommitReady = true") ||
  standaloneCommitStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneCommitWindow") ||
  !standaloneCommitWindow.includes("inspectUpdateTarget") ||
  !standaloneCommitWindow.includes("scanWorkspaceStatus") ||
  !standaloneCommitWindow.includes("createCommitTask") ||
  !standaloneCommitWindow.includes("createSvnOperationTask") ||
  !standaloneCommitWindow.includes('kind: "revert_file"') ||
  !standaloneCommitWindow.includes("on:contextmenu") ||
  !standaloneCommitWindow.includes("selectedPaths") ||
  !standaloneCommitWindow.includes("commitMessage") ||
  !standaloneCommitWindow.includes("readCommitMessageSettings") ||
  !standaloneCommitWindow.includes("consumePendingCommitMessage") ||
  !standaloneLogWindow.includes("setPendingCommitMessage") ||
  !commitMessageHistory.includes("novasvn:commit-message-settings") ||
  !commitMessageHistory.includes("novasvn:pending-commit-message") ||
  !tauriLib.includes('Some("commit") => Some("NovaSVN Commit")')
) {
  console.error("Explorer Commit 必须打开独立提交窗口并支持文件选择、跨窗口日志历史和真实提交任务");
  failed = true;
}

const standaloneUpdateStartupStart = appSvelte.indexOf('if (intent.action === "update")');
const standaloneUpdateStartupEnd = appSvelte.indexOf(
  'startupSurface = "main"',
  standaloneUpdateStartupStart,
);
const standaloneUpdateStartup = appSvelte.slice(
  standaloneUpdateStartupStart,
  standaloneUpdateStartupEnd,
);
if (
  standaloneUpdateStartupStart < 0 ||
  standaloneUpdateStartupEnd < 0 ||
  !standaloneUpdateStartup.includes('startupSurface = "update"') ||
  !standaloneUpdateStartup.includes("standaloneUpdateReady = true") ||
  standaloneUpdateStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneUpdateWindow") ||
  !standaloneUpdateWindow.includes("inspectUpdateTarget") ||
  !standaloneUpdateWindow.includes('kind: target.relative_path ? "update_path" : "update"') ||
  !standaloneUpdateWindow.includes("scanWorkspaceStatus") ||
  !standaloneUpdateWindow.includes('"resolve_working"') ||
  !standaloneUpdateWindow.includes('"resolve_mine_full"') ||
  !standaloneUpdateWindow.includes('"resolve_theirs_full"') ||
  !tauriLib.includes('Some("update") => Some("NovaSVN Update")') ||
  !tauriLib.includes("inspect_update_target,") ||
  !workspaceRs.includes("pub fn inspect_update_target(")
) {
  console.error("Explorer Update 必须自动执行路径级更新、展示输出并提供独立冲突处理窗口");
  failed = true;
}

for (const check of startupActionViewChecks) {
  const caseBlock = extractSwitchCase(appSvelte, check.action);
  if (!caseBlock) {
    console.error(`启动意图分发缺少 action：${check.action}`);
    failed = true;
    continue;
  }

  if (!caseBlock.includes(`setCurrentView("${check.view}")`)) {
    console.error(`启动意图 action ${check.action} 必须进入 ${check.view} 视图`);
    failed = true;
  }

  if (check.operation && !caseBlock.includes(`runSvnOperation("${check.operation}")`)) {
    console.error(`启动意图 action ${check.action} 必须触发 ${check.operation} 操作`);
    failed = true;
  }

  if (check.extra && !caseBlock.includes(check.extra)) {
    console.error(`启动意图 action ${check.action} 缺少必要逻辑：${check.extra}`);
    failed = true;
  }
}

for (const action of systemIntegrationActions) {
  if (!systemIntegrationRs.includes(`"${action}"`)) {
    console.error(`后端启动意图白名单缺少 action：${action}`);
    failed = true;
  }
}

if (!changelog.includes(`## ${packageJson.version}`)) {
  console.error(`CHANGELOG.md 缺少当前版本条目：${packageJson.version}`);
  failed = true;
}

if (!tauriLib.includes("export_diagnostics")) {
  console.error("后端必须注册 export_diagnostics 诊断日志导出命令");
  failed = true;
}

if (!diagnosticsRs.includes("install_panic_hook") || !diagnosticsRs.includes("crash.log")) {
  console.error("诊断模块必须安装 panic hook 并收集 crash.log");
  failed = true;
}

if (!diagnosticsRs.includes("NovaSVN 诊断日志") || !diagnosticsRs.includes("== 任务日志 ==")) {
  console.error("诊断日志内容必须包含基础运行信息和任务日志");
  failed = true;
}

if (!frontendApi.includes('callBackend<DiagnosticExport>("export_diagnostics")')) {
  console.error("前端 API 必须封装 export_diagnostics");
  failed = true;
}

if (!appStore.includes("exportDiagnosticLog") || !appStore.includes("diagnosticExportPath")) {
  console.error("设置状态必须支持导出诊断日志并保存导出路径");
  failed = true;
}

if (!mainWorkspace.includes("导出诊断日志") || !mainWorkspace.includes("onExportDiagnosticLog")) {
  console.error("设置页必须提供导出诊断日志入口");
  failed = true;
}

if (!appSvelte.includes("refreshStatusAndSyncBranchPool")) {
  console.error("状态刷新后必须同步分支工作副本池统计");
  failed = true;
}

if (!appSvelte.includes("syncCurrentBranchPoolEntry") || !appSvelte.includes("localChanges: status.total")) {
  console.error("分支工作副本池必须回写当前工作副本 revision 和本地改动数量");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("发布脚本、性能基准入口、系统入口脚本、分支池同步、诊断导出和更新日志检查通过");

function extractSwitchCase(content, action) {
  const start = content.indexOf(`case "${action}":`);
  if (start < 0) {
    return "";
  }

  const rest = content.slice(start);
  const nextCase = rest.slice(`case "${action}":`.length).search(/\n\s*(case\s+"|default:)/);
  return nextCase >= 0
    ? rest.slice(0, `case "${action}":`.length + nextCase)
    : rest;
}
