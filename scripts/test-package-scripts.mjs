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
const benchmarkScript = fs.readFileSync(
  path.join(root, "scripts", "benchmark-svn-workspace.ps1"),
  "utf8",
);
const benchmarkDoc = fs.readFileSync(path.join(root, "doc", "性能基准.md"), "utf8");
const tauriConfig = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const playwrightConfig = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");
const e2eSmokeSpec = fs.readFileSync(
  path.join(root, "tests", "e2e", "workbench-smoke.spec.ts"),
  "utf8",
);
const appSvelte = fs.readFileSync(path.join(root, "src", "App.svelte"), "utf8");
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

if (!benchmarkDoc.includes("benchmark-results.md")) {
  console.error("性能基准文档必须说明 Markdown 摘要输出");
  failed = true;
}

if (packageJson.scripts?.["test:e2e"] !== "playwright test") {
  console.error("test:e2e 必须执行 Playwright 测试");
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
}

if (!windowsExplorerScript.includes("--novasvn-path")) {
  console.error("Windows Explorer 菜单命令必须传递 --novasvn-path");
  failed = true;
}

if (!windowsExplorerScript.includes("%1") || !windowsExplorerScript.includes("%V")) {
  console.error("Windows Explorer 菜单必须同时支持文件/目录和目录背景路径占位符");
  failed = true;
}

if (!macosFinderScript.includes("--novasvn-path \"$f\"")) {
  console.error("macOS Finder Quick Action 必须传递选中的 Finder 路径");
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

if (failed) {
  process.exit(1);
}

console.log("发布脚本、性能基准入口、系统入口脚本和更新日志检查通过");

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
