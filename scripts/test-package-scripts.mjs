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
const macosFinderSyncSource = fs.readFileSync(
  path.join(root, "src-tauri", "macos-finder-sync", "NovaSVNFinderSync.m"),
  "utf8",
);
const macosFinderSyncEntitlements = fs.readFileSync(
  path.join(root, "src-tauri", "macos-finder-sync", "NovaSVNFinderSync.entitlements"),
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
const benchmarkDoc = fs.readFileSync(path.join(root, "doc", "性能基准.md"), "utf8");
const syncVersionScript = fs.readFileSync(path.join(root, "scripts", "sync-version.mjs"), "utf8");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const playwrightConfig = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");
const e2eSmokeSpec = fs.readFileSync(
  path.join(root, "tests", "e2e", "workbench-smoke.spec.ts"),
  "utf8",
);
const appSvelte = fs.readFileSync(path.join(root, "src", "App.svelte"), "utf8");
const frontendApi = fs.readFileSync(path.join(root, "src", "lib", "api.ts"), "utf8");
const mainWorkspace = fs.readFileSync(
  path.join(root, "src", "components", "workbench", "MainWorkspace.svelte"),
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
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

const releaseScripts = ["release:windows", "release:macos"];
const requiredBundleTargets = ["nsis", "dmg"];
const benchmarkScripts = ["benchmark:svn", "benchmark:svn:reset"];
const e2eSmokeAssertions = [
  "NovaSVN",
  "连接后端",
  "提交区",
  "任务队列",
  "提交选中 Hunk",
  "影子工作副本",
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
  { action: "commit", view: "staging" },
  { action: "update", view: "changes", operation: "update" },
  { action: "cleanup", view: "changes", operation: "cleanup" },
  { action: "diff", view: "changes" },
  { action: "log", view: "history", extra: "setSvnLogFileOnly(true)" },
  { action: "revert", view: "changes" },
  { action: "branch-workspace", view: "branches" },
];
let failed = false;

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

if (!packageJson.scripts?.["release:macos"]?.includes("--bundles dmg")) {
  console.error("release:macos 必须构建 DMG 安装包");
  failed = true;
}

if (
  !packageJson.scripts?.["release:macos"]?.includes("build-macos-finder-sync.sh") ||
  !packageJson.scripts?.["release:macos"]?.includes("inject-macos-finder-sync-into-dmg.sh")
) {
  console.error("release:macos 必须构建 Finder Sync 扩展并注入 DMG");
  failed = true;
}

if (
  !macosFinderSyncDmgInjectScript.includes("Contents/PlugIns") ||
  !macosFinderSyncDmgInjectScript.includes("codesign --force --sign -") ||
  !macosFinderSyncDmgInjectScript.includes("hdiutil convert")
) {
  console.error("Finder Sync DMG 注入脚本必须嵌入扩展并重新签名 App");
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
  !macosFinderSyncEntitlements.includes("com.apple.security.app-sandbox") ||
  !macosFinderSyncBuildScript.includes("--entitlements") ||
  !macosFinderSyncDmgInjectScript.includes("--entitlements")
) {
  console.error("Finder Sync 扩展必须启用 App Sandbox entitlement");
  failed = true;
}

for (const scriptName of benchmarkScripts) {
  const command = packageJson.scripts?.[scriptName];
  if (typeof command !== "string") {
    console.error(`${scriptName} 脚本不存在`);
    failed = true;
    continue;
  }

  if (!command.includes("scripts/benchmark-svn-workspace.ps1")) {
    console.error(`${scriptName} 必须调用性能基准脚本`);
    failed = true;
  }
}

if (!packageJson.scripts?.["benchmark:svn:reset"]?.includes("-Reset")) {
  console.error("benchmark:svn:reset 必须传入 -Reset");
  failed = true;
}

if (!benchmarkScript.includes("benchmark-results.md")) {
  console.error("性能基准脚本必须生成 Markdown 摘要");
  failed = true;
}

if (!benchmarkScript.includes("revert -R")) {
  console.error("性能基准脚本每次运行前必须还原工作副本，避免累积改动影响对比");
  failed = true;
}

if (!benchmarkDoc.includes("benchmark-results.md")) {
  console.error("性能基准文档必须说明 Markdown 摘要输出");
  failed = true;
}

if (!benchmarkDoc.includes("svn revert -R")) {
  console.error("性能基准文档必须说明脚本会在每次运行前还原工作副本");
  failed = true;
}

if (packageJson.scripts?.["test:e2e"] !== "playwright test") {
  console.error("test:e2e 必须执行 Playwright 测试");
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

for (const assertion of e2eSmokeAssertions) {
  if (!e2eSmokeSpec.includes(assertion)) {
    console.error(`E2E 冒烟测试缺少关键断言：${assertion}`);
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

for (const action of systemIntegrationActions.filter((value) => value !== "open")) {
  if (!appSvelte.includes(`case "${action}":`)) {
    console.error(`启动意图分发缺少 action：${action}`);
    failed = true;
  }
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
