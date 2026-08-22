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
const tauriWindowsConfig = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.windows.conf.json"), "utf8"),
);
const nsisHooks = fs.readFileSync(path.join(root, "src-tauri", "nsis-hooks.nsh"), "utf8");
const tauriCargo = fs.readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf8");
const windowsShellCargo = fs.readFileSync(
  path.join(root, "src-tauri", "windows-shell-extension", "Cargo.toml"),
  "utf8",
);
const windowsShellSource = fs.readFileSync(
  path.join(root, "src-tauri", "windows-shell-extension", "src", "lib.rs"),
  "utf8",
);
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
const svnLogRevisionList = fs.readFileSync(
  path.join(root, "src", "components", "SvnLogRevisionList.svelte"),
  "utf8",
);
const logMergeDialog = fs.readFileSync(
  path.join(root, "src", "components", "LogMergeDialog.svelte"),
  "utf8",
);
const logMergeDialogTest = fs.readFileSync(
  path.join(root, "src", "components", "LogMergeDialog.test.ts"),
  "utf8",
);
const standaloneMergePreviewWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneMergePreviewWindow.svelte"),
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
const standaloneRevertWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneRevertWindow.svelte"),
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
const svnConflict = fs.readFileSync(
  path.join(root, "src", "lib", "svn-conflict.ts"),
  "utf8",
);
const standaloneCheckoutWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneCheckoutWindow.svelte"),
  "utf8",
);
const standaloneCleanupWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneCleanupWindow.svelte"),
  "utf8",
);
const standaloneInfoWindow = fs.readFileSync(
  path.join(root, "src", "components", "StandaloneInfoWindow.svelte"),
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
const mergePreviewRs = fs.readFileSync(
  path.join(root, "src-tauri", "src", "merge_preview.rs"),
  "utf8",
);
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
  { action: "diff", view: "changes" },
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

const windowsShellExtensionResource =
  tauriWindowsConfig.bundle?.resources?.[
    "windows-shell-extension/target/release/novasvn_shell_extension.dll"
  ];
if (
  packageJson.scripts?.["build:windows-shell-extension"] !==
    "cargo build --release --manifest-path src-tauri/windows-shell-extension/Cargo.toml" ||
  packageJson.scripts?.["build:windows"] !==
    "npm run build && npm run build:windows-shell-extension" ||
  tauriWindowsConfig.build?.beforeBuildCommand !== "npm run build:windows" ||
  windowsShellExtensionResource !== "shell-extension/novasvn_shell_extension.pending" ||
  !windowsShellCargo.includes('crate-type = ["cdylib"]') ||
  !windowsShellCargo.includes('windows = { version = "0.61.3"')
) {
  console.error("Windows 发布必须先构建 Explorer 状态处理 DLL 并将其打入 NSIS 安装包");
  failed = true;
}

const windowsStateHandlers = [
  ["ROOT_MENU", "{0B2DD325-75D0-461D-9FC5-F191AD22FFF6}"],
  ["SVN_ONLY", "{4D64F10A-B42A-45E5-9034-02F83A16F0AB}"],
  ["CHECKOUT", "{6A5EA9FB-A012-4F3D-BE8A-07C41CE53B1B}"],
];
for (const [name, clsid] of windowsStateHandlers) {
  const rustClsid = clsid.slice(1, -1).toLowerCase().replaceAll("-", "_");
  if (
    !nsisHooks.includes(`!define NOVASVN_${name}_STATE_CLSID "${clsid}"`) ||
    !nsisHooks.includes(`DeleteRegKey HKCU "Software\\Classes\\CLSID\\\${NOVASVN_${name}_STATE_CLSID}"`) ||
    !windowsExplorerScript.includes(clsid) ||
    !windowsShellSource.includes(rustClsid)
  ) {
    console.error(`Windows Explorer 状态处理器缺少注册或卸载清理：${name}`);
    failed = true;
  }
}

if (
  nsisHooks.includes("!define MUI_FINISHPAGE_REBOOTLATER_DEFAULT") ||
  nsisHooks.includes("Delete /REBOOTOK") ||
  nsisHooks.includes("taskkill.exe") ||
  nsisHooks.includes("/IM explorer.exe") ||
  !nsisHooks.includes("SetRebootFlag false") ||
  !nsisHooks.includes("$INSTDIR\\shell-extension\\novasvn_shell_extension.pending") ||
  !nsisHooks.includes("GetTempFileName $NovaSvnActiveShellExtension") ||
  !nsisHooks.includes('WriteRegStr HKCU "Software\\Classes\\CLSID\\${CLSID}\\InprocServer32" "" "$NovaSvnActiveShellExtension"') ||
  !nsisHooks.includes('Delete "$INSTDIR\\shell-extension\\*.tmp.dll"') ||
  !nsisHooks.includes("!macro NSIS_HOOK_PREINSTALL") ||
  !nsisHooks.includes("!macro NOVASVN_TRY_DELETE_SHELL_EXTENSIONS") ||
  !nsisHooks.includes("!macro NSIS_HOOK_POSTUNINSTALL") ||
  !nsisHooks.includes("shell32::SHChangeNotify") ||
  !nsisHooks.includes('"ThreadingModel" "Apartment"') ||
  !nsisHooks.includes('"CommandStateHandler" "${NOVASVN_ROOT_MENU_STATE_CLSID}"') ||
  !nsisHooks.includes('"CommandStateHandler" "${STATE_HANDLER}"') ||
  !nsisHooks.includes('"CommandStateHandler" "${NOVASVN_SVN_ONLY_STATE_CLSID}"') ||
  !nsisHooks.includes('"CommandStateHandler" "${NOVASVN_CHECKOUT_STATE_CLSID}"') ||
  !nsisHooks.includes('WriteRegDWORD HKCU "${ROOT}\\NovaSVN" "ImpliedSelectionModel" 1') ||
  !windowsExplorerScript.includes('Name "CommandStateHandler" -Value $stateHandlers.RootMenu') ||
  !windowsExplorerScript.includes('GetValue("")') ||
  !windowsExplorerScript.includes("[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey") ||
  !windowsExplorerScript.includes('Set-Item -LiteralPath $commandPath -Value $command') ||
  !windowsExplorerScript.includes('-Filter "*.tmp.dll"') ||
  !windowsExplorerScript.includes('Name "CommandStateHandler" -Value $stateHandlers.Checkout') ||
  !windowsExplorerScript.includes('Name "ImpliedSelectionModel" -Value 1 -PropertyType DWord') ||
  !windowsExplorerScript.includes('Name "CommandStateHandler" -Value $stateHandlers.SvnOnly') ||
  !windowsShellSource.includes('directory.join(".svn").is_dir()') ||
  !windowsShellSource.includes("ECS_HIDDEN.0 as u32")
) {
  console.error("Windows Explorer 菜单必须按工作副本状态隐藏不适用的 SVN 操作，且安装不得强制关闭 Explorer");
  failed = true;
}

const windowsExplorerMenus = [
  {
    root: "Software\\Classes\\Directory\\shell",
    placeholder: "%1",
    submenu: [
      ["01.Open", "Open", "open"],
      ["02.Info", "SVN Info", "info"],
      ["03.Diff", "Diff", "diff"],
      ["04.Revert", "Revert", "revert"],
      ["05.Delete", "Delete", "delete"],
      ["06.Ignore", "Ignore", "ignore"],
      ["07.Cleanup", "Cleanup", "cleanup"],
      ["08.BranchWorkspace", "Branch Workspace", "branch-workspace"],
      ["09.RepoBrowser", "Repo Browser", "browse"],
    ],
    checkout: true,
    direct: [
      ["Update", "NovaSVN Update", "update"],
      ["Commit", "NovaSVN Commit", "commit"],
      ["Log", "NovaSVN Log", "log"],
    ],
  },
  {
    root: "Software\\Classes\\Directory\\Background\\shell",
    placeholder: "%V",
    submenu: [
      ["01.Open", "Open", "open"],
      ["02.Info", "SVN Info", "info"],
      ["03.Diff", "Diff", "diff"],
      ["04.Revert", "Revert", "revert"],
      ["05.Delete", "Delete", "delete"],
      ["06.Ignore", "Ignore", "ignore"],
      ["07.Cleanup", "Cleanup", "cleanup"],
      ["08.BranchWorkspace", "Branch Workspace", "branch-workspace"],
      ["09.RepoBrowser", "Repo Browser", "browse"],
    ],
    checkout: true,
    background: true,
    direct: [
      ["Update", "NovaSVN Update", "update"],
      ["Commit", "NovaSVN Commit", "commit"],
      ["Log", "NovaSVN Log", "log"],
    ],
  },
  {
    root: "Software\\Classes\\*\\shell",
    placeholder: "%1",
    submenu: [
      ["01.Open", "Open", "open"],
      ["02.Info", "SVN Info", "info"],
      ["03.Diff", "Diff", "diff"],
      ["04.Blame", "Blame", "blame"],
      ["05.Revert", "Revert", "revert"],
      ["06.Delete", "Delete", "delete"],
      ["07.Ignore", "Ignore", "ignore"],
      ["08.Cleanup", "Cleanup", "cleanup"],
      ["09.BranchWorkspace", "Branch Workspace", "branch-workspace"],
      ["10.RepoBrowser", "Repo Browser", "browse"],
    ],
    direct: [
      ["Update", "NovaSVN Update", "update"],
      ["Commit", "NovaSVN Commit", "commit"],
      ["Log", "NovaSVN Log", "log"],
    ],
  },
];

const windowsExplorerIconActions = [
  "checkout",
  ...new Set(
    windowsExplorerMenus.flatMap((menu) =>
      [...menu.submenu, ...menu.direct].map(([, , action]) => action),
    ),
  ),
];

for (const action of windowsExplorerIconActions) {
  const svgPath = path.join(root, "src-tauri", "icons", "explorer", `${action}.svg`);
  const icoPath = path.join(root, "src-tauri", "icons", "explorer", `${action}.ico`);
  if (!fs.existsSync(svgPath) || !fs.existsSync(icoPath)) {
    console.error(`Windows Explorer 菜单缺少 ${action} 图标源或 ICO 文件`);
    failed = true;
    continue;
  }
  const svg = fs.readFileSync(svgPath, "utf8");
  const ico = fs.readFileSync(icoPath);
  if (
    ico.length < 6 ||
    ico.readUInt16LE(0) !== 0 ||
    ico.readUInt16LE(2) !== 1 ||
    ico.readUInt16LE(4) < 5
  ) {
    console.error(`Windows Explorer 菜单图标不是有效的多尺寸 ICO：${action}`);
    failed = true;
    continue;
  }

  const firstEntryOffset = 6;
  const width = ico[firstEntryOffset] || 256;
  const height = ico[firstEntryOffset + 1] || 256;
  const firstImageOffset = ico.readUInt32LE(firstEntryOffset + 12);
  const dibHeaderSize = ico.readUInt32LE(firstImageOffset);
  const bitsPerPixel = ico.readUInt16LE(firstImageOffset + 14);
  const pixelOffset = firstImageOffset + dibHeaderSize;
  const pixelBytes = ico.subarray(pixelOffset, pixelOffset + width * height * 4);
  let hasTransparentPixel = false;
  let hasVisiblePixel = false;
  for (let index = 3; index < pixelBytes.length; index += 4) {
    hasTransparentPixel ||= pixelBytes[index] === 0;
    hasVisiblePixel ||= pixelBytes[index] > 0;
  }
  if (
    svg.includes("<rect") ||
    !svg.includes('stroke-width="3.6"') ||
    bitsPerPixel !== 32 ||
    !hasTransparentPixel ||
    !hasVisiblePixel
  ) {
    console.error(`Windows Explorer 菜单图标必须使用透明背景：${action}`);
    failed = true;
  }
}

const explorerResourceTarget = tauriConfig.bundle?.resources?.["icons/explorer/*.ico"];
const actionIconRegistration = '"Icon" "$INSTDIR\\explorer-icons\\${ACTION}.ico"';
if (
  explorerResourceTarget !== "explorer-icons/" ||
  nsisHooks.split(actionIconRegistration).length - 1 !== 2 ||
  !windowsExplorerScript.includes('Join-Path $explorerIconRoot "$($item.Action).ico"') ||
  !windowsExplorerScript.includes('Name "Icon" -Value $iconPath')
) {
  console.error("Windows Explorer 一级和二级菜单必须注册各自的动作图标");
  failed = true;
}

for (const menu of windowsExplorerMenus) {
  if (
    !nsisHooks.includes(`!insertmacro NOVASVN_REGISTER_MENU "${menu.root}"`) ||
    !nsisHooks.includes(`DeleteRegKey HKCU "${menu.root}\\NovaSVN"`) ||
    !nsisHooks.includes(`!insertmacro NOVASVN_DELETE_LEGACY_ACTIONS "${menu.root}"`)
  ) {
    console.error(`Windows 安装/卸载缺少 NovaSVN Explorer 级联菜单：${menu.root}`);
    failed = true;
  }
  for (const [key, label, action] of menu.submenu) {
    const registration =
      `!insertmacro NOVASVN_REGISTER_ACTION "${menu.root}" "${key}" "${label}" "${action}" "${menu.placeholder}"`;
    if (!nsisHooks.includes(registration)) {
      console.error(`Windows Explorer 级联菜单缺少 ${label}：${menu.root}`);
      failed = true;
    }
  }
  for (const [key, label, action] of menu.direct) {
    const registration =
      `!insertmacro NOVASVN_REGISTER_DIRECT_ACTION "${menu.root}" "${key}" "${label}" "${action}" "${menu.placeholder}"`;
    if (!nsisHooks.includes(registration)) {
      console.error(`Windows Explorer 一级菜单缺少 ${label}：${menu.root}`);
      failed = true;
    }
  }
  if (menu.checkout) {
    const registration =
      `!insertmacro NOVASVN_REGISTER_CHECKOUT_ACTION "${menu.root}" "${menu.placeholder}"`;
    if (!nsisHooks.includes(registration)) {
      console.error(`Windows Explorer 一级菜单缺少 NovaSVN Checkout：${menu.root}`);
      failed = true;
    }
  }
  if (
    menu.background &&
    !nsisHooks.includes(`!insertmacro NOVASVN_MARK_BACKGROUND_CONTEXT "${menu.root}"`)
  ) {
    console.error(`Windows Explorer 空白处菜单缺少隐含文件夹上下文：${menu.root}`);
    failed = true;
  }
}

const registeredDirectActions = [
  ...nsisHooks.matchAll(/NOVASVN_REGISTER_DIRECT_ACTION\s+"[^"]+"\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"/g),
].map((match) => match.slice(1, 4).join("|"));
const expectedDirectActions = windowsExplorerMenus.flatMap((menu) =>
  menu.direct.map(([key, label, action]) => [key, label, action].join("|")),
);
if (
  registeredDirectActions.length !== expectedDirectActions.length ||
  registeredDirectActions.some((action, index) => action !== expectedDirectActions[index])
) {
  console.error("Windows Explorer SVN 一级菜单只能包含带 NovaSVN 前缀的 Update、Commit、Log");
  failed = true;
}

if (
  !nsisHooks.includes('"SubCommands" ""') ||
  !nsisHooks.includes('"Position" "Bottom"') ||
  !nsisHooks.includes('"SeparatorBefore" ""') ||
  !nsisHooks.includes('"SeparatorAfter" ""') ||
  !nsisHooks.includes("--novasvn-action") ||
  !nsisHooks.includes("%1") ||
  !nsisHooks.includes("%V")
) {
  console.error("Windows Explorer 操作必须包含 NovaSVN 二级菜单及独立分隔的一级 Checkout");
  failed = true;
}

if (
  !windowsExplorerScript.includes('Name "Position" -Value "Bottom"') ||
  !windowsExplorerScript.includes('Action = "delete"') ||
  !windowsExplorerScript.includes('Action = "ignore"') ||
  !systemIntegrationRs.includes('"delete"') ||
  !systemIntegrationRs.includes('"ignore"') ||
  !appSvelte.includes('case "delete":') ||
  !appSvelte.includes('case "ignore":')
) {
  console.error("Windows Explorer NovaSVN 菜单必须靠下显示，并提供可执行的 Delete、Ignore 二级操作");
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
const fileBrowserEnd = mainWorkspace.indexOf('class="workspace-context-menu"', fileBrowserStart);
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
  if (!mainWorkspace.includes(`label: "${column}", ariaLabel: "${column}"`)) {
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
  !mainWorkspace.includes('aria-label="工作副本内容"') ||
  !mainWorkspace.includes("工作副本") ||
  !mainWorkspace.includes("时间线") ||
  !mainWorkspace.includes("<ConflictResolver")
) {
  console.error("工作台必须用可访问标签切换工作副本和时间线，并保留冲突解决入口");
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
  !mainWorkspace.includes("<SvnLogRevisionList") ||
  !svnLogRevisionList.includes('class="svn-log-entry"') ||
  !svnLogRevisionList.includes('class="svn-log-changed-paths"') ||
  !mainWorkspace.includes("expandedTimelineRevisions")
) {
  console.error("Timeline 必须完整展示可展开的 revision 改变路径");
  failed = true;
}

if (
  !mainWorkspace.includes("openChangedPathRevisionDiff") ||
  !svnLogRevisionList.includes('class="svn-log-changed-path-button"') ||
  !mainWorkspace.includes("repositoryPathUrlAtRevision") ||
  !mainWorkspace.includes("getRevisionFileContentDiff") ||
  !frontendApi.includes('callBackend<FileContentDiff>("get_revision_file_content_diff"')
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
  !mainWorkspace.includes("timelineMergeRevisions") ||
  !mainWorkspace.includes("selectedTimelineMergeRevisions") ||
  !mainWorkspace.includes('aria-label="Revision 批量操作"') ||
  !mainWorkspace.includes("撤销选中 Revision") ||
  !mainWorkspace.includes("onRevertSelectedRevisions") ||
  !mainWorkspace.includes("<LogMergeDialog") ||
  !svnLogRevisionList.includes('aria-label={`选择 r${entry.revision}`}')
) {
  console.error("Timeline 多 Revision 选择必须支持批量撤销和 Merge 预览流程");
  failed = true;
}

if (
  !logMergeDialog.includes("createMergeTask") ||
  !logMergeDialog.includes("getFileContentDiff") ||
  !logMergeDialog.includes('aria-label="Merge 差异文件"') ||
  !logMergeDialog.includes("<MonacoDiffViewer") ||
  !logMergeDialogTest.includes("验证目标后直接 Merge，并展示差异与 Diff") ||
  !standaloneMergePreviewWindow.includes("getMergePreview") ||
  !standaloneMergePreviewWindow.includes("getMergePreviewFile") ||
  !standaloneMergePreviewWindow.includes("createApplyMergePreviewTask") ||
  !appSvelte.includes('startupSurface === "merge-preview"') ||
  !tauriLib.includes("launch_merge_preview_window") ||
  !tauriLib.includes("create_apply_merge_preview_task") ||
  !mergePreviewRs.includes("workspace_snapshot_digest") ||
  !mergePreviewRs.includes("SESSION_LIFETIME_MILLIS")
) {
  console.error("Merge 必须验证目标后直接执行，并在对话框内展示逐文件 Diff");
  failed = true;
}

if (
  !svnLogRevisionList.includes('class="svn-log-revert"') ||
  !mainWorkspace.includes("onRevert={revertTimelineEntry}") ||
  !mainWorkspace.includes("onRevertToRevision(entry.revision)") ||
  !appSvelte.includes("revertWorkspaceToRevision") ||
  !appSvelte.includes("按从新到旧的顺序反向应用") ||
  !appSvelte.includes("targetPath") ||
  !appSvelte.includes("sourceUrl") ||
  !appSvelte.includes("targetRevisions") ||
  !taskRs.includes("fn execute_revert_revision(") ||
  !taskRs.includes("normalize_revert_target_revisions") ||
  !taskRs.includes('args(["--ignore-ancestry", "--allow-mixed-revisions"])') ||
  !taskRs.includes('let source_url = format!("{source_url}@HEAD")') ||
  !taskRs.includes('payload.target_revisions.join(",-")') ||
  !taskRs.includes('command.arg("-r").arg(format!("HEAD:{target_revision}"))') ||
  !taskRs.includes('command.arg(&source_url).arg(&target).current_dir(&root)') ||
  !tauriLib.includes("create_revert_revision_task")
) {
  console.error("Timeline 日志回退必须保持 TortoiseSVN 的目标、peg 和混合 Revision 语义");
  failed = true;
}

if (
  !appStore.includes("revisionDiffResult") ||
  !appStore.includes("result.patch_file_path") ||
  !appStore.includes("openGeneratedFileLocation") ||
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
  !logMergeDialog.includes("scanWorkspaceStatus") ||
  !logMergeDialog.includes("launchConflictWindow") ||
  !appSvelte.includes("workspaceStore.focusConflictResolution()") ||
  !appStore.includes("function focusConflictResolution()") ||
  !mainWorkspace.includes("<ConflictResolver")
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

if (!defaultCapability.includes('"core:window:allow-close"')) {
  console.error("独立窗口必须具备 Tauri window close 权限");
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
  !mainWorkspace.includes('workingCopyTreeFilter === "unversioned"')
) {
  console.error("工作副本必须区分本地、远端和组合状态，并提供本地改动与未管理文件筛选");
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
  "launch_commit_window",
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

if (!logMergeDialogTest.includes("createMergeTask")) {
  console.error("Merge 对话框测试必须覆盖 createMergeTask");
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
  !macosFinderSyncSource.includes("FIMenuKind") ||
  !macosFinderSyncSource.includes("targetPathForMenuKind") ||
  !macosFinderSyncSource.includes('@"path"') ||
  !macosFinderSyncSource.includes("createsNewApplicationInstance")
) {
  console.error(
    "macOS Finder Sync 扩展必须提供 Finder 右键菜单、在菜单构建时固化选中路径，并强制新开应用实例",
  );
  failed = true;
}

// 菜单项必须加载与 Windows 同源的 action 图标
if (
  !macosFinderSyncSource.includes("menuIconForAction") ||
  !macosFinderSyncSource.includes("item.image") ||
  !macosFinderSyncBuildScript.includes("export-macos-menu-icons.py") ||
  !macosFinderSyncBuildScript.includes('RESOURCES_DIR="${CONTENTS_DIR}/Resources"')
) {
  console.error("macOS Finder Sync 菜单必须嵌入并显示 Explorer 同源图标");
  failed = true;
}

const exportMenuIconsScript = fs.readFileSync(
  path.join(root, "scripts", "export-macos-menu-icons.py"),
  "utf8",
);
if (
  !exportMenuIconsScript.includes("write_png") ||
  !exportMenuIconsScript.includes("branch-workspace") ||
  !exportMenuIconsScript.includes("checkout")
) {
  console.error("macOS 菜单图标导出脚本必须覆盖全部 Explorer action");
  failed = true;
}

// 层级对齐 Windows：顶层 Update/Commit/Log，其余进 More 子菜单；非 WC 目录提供 Checkout
if (
  !macosFinderSyncSource.includes("rootItem.submenu = submenu") ||
  !macosFinderSyncSource.includes('addMenuItem:@"Update"') ||
  !macosFinderSyncSource.includes('addMenuItem:@"Commit"') ||
  !macosFinderSyncSource.includes('addMenuItem:@"Log"') ||
  !macosFinderSyncSource.includes('initWithTitle:@"More"') ||
  !macosFinderSyncSource.includes('addMenuItem:@"Checkout"') ||
  !macosFinderSyncSource.includes("pathIsInWorkingCopy")
) {
  console.error("macOS Finder Sync 扩展菜单层级必须与 Windows 一致（顶层常用项 + 子菜单 + Checkout）");
  failed = true;
}

// 主程序启动时必须启用 Finder Sync，并清理会落入「服务」的旧 Quick Actions
if (
  !systemIntegrationRs.includes("ensure_macos_shell_integration") ||
  !systemIntegrationRs.includes("remove_legacy_finder_services") ||
  !systemIntegrationRs.includes("enable_finder_sync_extension") ||
  !systemIntegrationRs.includes("pluginkit") ||
  !tauriLib.includes("ensure_macos_shell_integration")
) {
  console.error("macOS 启动必须注册 Finder Sync 并卸载 Library/Services 中的旧菜单");
  failed = true;
}

if (
  !macosFinderSyncInfo.includes("<string>NovaSVN</string>") ||
  macosFinderSyncInfo.includes("NovaSVN Finder")
) {
  console.error("Finder Sync CFBundleDisplayName 必须为 NovaSVN，避免菜单名多余后缀");
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
  !windowsExplorerScript.includes('Action = "checkout"') ||
  !systemIntegrationRs.includes('"checkout"')
) {
  console.error("Windows Explorer Checkout 必须注册菜单 action 并加入后端启动白名单");
  failed = true;
}

if (
  !windowsExplorerScript.includes('Action = "browse"') ||
  !windowsExplorerScript.includes('Label = "Repo Browser"') ||
  !systemIntegrationRs.includes('"browse"') ||
  !systemIntegrationRs.includes("launch_repo_browser_window") ||
  !tauriLib.includes('Some("browse") => Some("NovaSVN Repository Browser")') ||
  !tauriLib.includes("launch_repo_browser_window,") ||
  !appSvelte.includes('if (intent.action === "browse")') ||
  !appSvelte.includes('startupSurface = "browse"') ||
  !appSvelte.includes("<StandaloneRepoBrowserWindow") ||
  !frontendApi.includes("launchRepoBrowserWindow") ||
  !nsisHooks.includes('09.RepoBrowser" "Repo Browser" "browse"')
) {
  console.error("Windows Explorer Repo Browser 必须注册菜单、独立窗口和后端启动白名单");
  failed = true;
}

if (
  !windowsExplorerScript.includes('Action = "blame"; FilesOnly = $true') ||
  !windowsExplorerScript.includes('$item.FilesOnly -eq $true')
) {
  console.error("Windows Explorer 脚本必须仅为文件注册 Blame 菜单");
  failed = true;
}

if (
  !windowsExplorerScript.includes('Action = "info"') ||
  !windowsExplorerScript.includes('Label = "SVN Info"') ||
  !windowsExplorerScript.includes('Join-Path $menuPath "shell"') ||
  !windowsExplorerScript.includes('Name "SubCommands"') ||
  !windowsExplorerScript.includes('Name "SeparatorBefore"') ||
  !windowsExplorerScript.includes('Name "SeparatorAfter"') ||
  !systemIntegrationRs.includes('"info"') ||
  !appSvelte.includes('startupSurface = "info"') ||
  !appSvelte.includes("<StandaloneInfoWindow") ||
  !standaloneInfoWindow.includes("getSvnInfo") ||
  !standaloneInfoWindow.includes("SvnAuthenticationDialog") ||
  !frontendApi.includes('"get_svn_info"') ||
  !tauriLib.includes("get_svn_info,") ||
  !workspaceRs.includes("pub fn get_svn_info(")
) {
  console.error("Windows Explorer Info 必须打开独立 SVN 信息窗口并接通后端读取");
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
  !standaloneCommitWindow.includes("createSvnBatchOperationTask") ||
  !standaloneCommitWindow.includes('kind: "revert_file"') ||
  !standaloneCommitWindow.includes('kind: "revert_paths"') ||
  !standaloneCommitWindow.includes("on:contextmenu") ||
  !standaloneCommitWindow.includes("selectedPaths") ||
  !standaloneCommitWindow.includes("commitMessage") ||
  !standaloneCommitWindow.includes("readCommitMessageSettings") ||
  !standaloneCommitWindow.includes("consumePendingCommitMessage") ||
  !commitMessageHistory.includes("novasvn:commit-message-settings") ||
  !commitMessageHistory.includes("novasvn:pending-commit-message") ||
  !tauriLib.includes('Some("commit") => Some("NovaSVN Commit")')
) {
  console.error("Explorer Commit 必须打开独立提交窗口并支持文件选择、跨窗口日志历史和真实提交任务");
  failed = true;
}

const standaloneRevertStartupStart = appSvelte.indexOf('if (intent.action === "revert")');
const standaloneRevertStartupEnd = appSvelte.indexOf(
  'if (intent.action === "info")',
  standaloneRevertStartupStart,
);
const standaloneRevertStartup = appSvelte.slice(
  standaloneRevertStartupStart,
  standaloneRevertStartupEnd,
);
if (
  standaloneRevertStartupStart < 0 ||
  standaloneRevertStartupEnd < 0 ||
  !standaloneRevertStartup.includes('startupSurface = "revert"') ||
  !standaloneRevertStartup.includes("standaloneRevertReady = true") ||
  standaloneRevertStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneRevertWindow") ||
  !standaloneRevertWindow.includes("inspectUpdateTarget") ||
  !standaloneRevertWindow.includes("scanWorkspaceStatus") ||
  !standaloneRevertWindow.includes("createSvnBatchOperationTask") ||
  !standaloneRevertWindow.includes('kind: "revert_paths"') ||
  !tauriLib.includes('Some("revert") => Some("NovaSVN Revert")')
) {
  console.error("Explorer Revert 必须打开独立窗口并对勾选的版本化修改执行批量 Revert");
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
  !standaloneUpdateWindow.includes("conflictResolutionActions") ||
  !standaloneUpdateWindow.includes("commonConflictResolutionActions") ||
  !standaloneUpdateWindow.includes("kind: action.kind as SvnOperationKind") ||
  !svnConflict.includes('kind: "resolve_working"') ||
  !svnConflict.includes('kind: "resolve_mine_full"') ||
  !svnConflict.includes('kind: "resolve_theirs_full"') ||
  !tauriLib.includes('Some("update") => Some("NovaSVN Update")') ||
  !tauriLib.includes("inspect_update_target,") ||
  !workspaceRs.includes("pub fn inspect_update_target(")
) {
  console.error("Explorer Update 必须自动执行路径级更新、展示输出并提供独立冲突处理窗口");
  failed = true;
}

const standaloneCheckoutStartupStart = appSvelte.indexOf('if (intent.action === "checkout")');
const standaloneCheckoutStartupEnd = appSvelte.indexOf(
  'if (intent.action === "update")',
  standaloneCheckoutStartupStart,
);
const standaloneCheckoutStartup = appSvelte.slice(
  standaloneCheckoutStartupStart,
  standaloneCheckoutStartupEnd,
);
if (
  standaloneCheckoutStartupStart < 0 ||
  standaloneCheckoutStartupEnd < 0 ||
  !standaloneCheckoutStartup.includes('startupSurface = "checkout"') ||
  !standaloneCheckoutStartup.includes("standaloneCheckoutReady = true") ||
  standaloneCheckoutStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneCheckoutWindow") ||
  !standaloneCheckoutWindow.includes("createRepositoryCheckoutTask") ||
  !standaloneCheckoutWindow.includes("getTask") ||
  !standaloneCheckoutWindow.includes("cancelTask") ||
  !standaloneCheckoutWindow.includes("chooseCheckoutTargetDirectory") ||
  !tauriLib.includes('Some("checkout") => Some("NovaSVN Checkout")')
) {
  console.error("Explorer Checkout 必须打开独立窗口并执行真实仓库 Checkout 任务");
  failed = true;
}

const standaloneCleanupStartupStart = appSvelte.indexOf('if (intent.action === "cleanup")');
const standaloneCleanupStartupEnd = appSvelte.indexOf(
  'if (intent.action === "merge-preview")',
  standaloneCleanupStartupStart,
);
const standaloneCleanupStartup = appSvelte.slice(
  standaloneCleanupStartupStart,
  standaloneCleanupStartupEnd,
);
if (
  standaloneCleanupStartupStart < 0 ||
  standaloneCleanupStartupEnd < 0 ||
  !standaloneCleanupStartup.includes('startupSurface = "cleanup"') ||
  !standaloneCleanupStartup.includes("standaloneCleanupReady = true") ||
  standaloneCleanupStartup.includes("workspaceStore") ||
  !appSvelte.includes("<StandaloneCleanupWindow") ||
  !standaloneCleanupWindow.includes("inspectUpdateTarget") ||
  !standaloneCleanupWindow.includes("createSvnOperationTask") ||
  !standaloneCleanupWindow.includes('kind: "cleanup"') ||
  !standaloneCleanupWindow.includes("getTask") ||
  !standaloneCleanupWindow.includes("cancelTask") ||
  !tauriLib.includes('Some("cleanup") => Some("NovaSVN Clean Up")')
) {
  console.error("Explorer Clean Up 必须打开可取消的独立任务窗口");
  failed = true;
}

for (const check of startupActionViewChecks) {
  const caseBlock = extractSwitchCase(appSvelte, check.action);
  if (!caseBlock) {
    console.error(`启动意图分发缺少 action：${check.action}`);
    failed = true;
    continue;
  }

  if (!caseBlock.includes(`setActiveWorkspaceView("${check.view}")`)) {
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

if (
  !appSvelte.includes("syncCurrentBranchPoolEntry") ||
  !appSvelte.includes("const localChanges = status?.total") ||
  !appSvelte.includes("localChanges,")
) {
  console.error("分支工作副本池必须回写当前工作副本 revision 和本地改动数量");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("发布脚本、性能基准入口、系统入口脚本、分支池同步和诊断导出检查通过");

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
