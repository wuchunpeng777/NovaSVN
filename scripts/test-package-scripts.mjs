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
const appSvelte = fs.readFileSync(path.join(root, "src", "App.svelte"), "utf8");
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");

const releaseScripts = ["release:windows", "release:macos"];
const benchmarkScripts = ["benchmark:svn", "benchmark:svn:reset"];
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

for (const action of systemIntegrationActions.filter((value) => value !== "open")) {
  if (!appSvelte.includes(`case "${action}":`)) {
    console.error(`启动意图分发缺少 action：${action}`);
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
