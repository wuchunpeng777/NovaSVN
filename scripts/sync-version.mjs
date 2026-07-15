import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packagePath = path.join(root, "package.json");
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");
const finderInfoPath = path.join(
  root,
  "src-tauri",
  "macos-finder-sync",
  "Info.plist",
);
const finderProjectPath = path.join(
  root,
  "src-tauri",
  "macos-finder-sync",
  "NovaSVNFinderSync.xcodeproj",
  "project.pbxproj",
);

const args = process.argv.slice(2);
const setIndex = args.indexOf("--set");
const shouldPrint = args.includes("--print");
const shouldCheck = args.includes("--check");
const requestedVersion = setIndex >= 0 ? args[setIndex + 1] : null;

if (setIndex >= 0 && !requestedVersion) {
  fail("缺少 --set 后面的版本号，例如 0.2.0");
}

if (requestedVersion && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedVersion)) {
  fail("版本号必须符合 semver，例如 0.2.0 或 0.2.0-beta.1");
}

const packageJson = readJson(packagePath);
const version = requestedVersion ?? packageJson.version;
const bundleVersion = version?.split(/[-+]/, 1)[0];

if (!version) {
  fail("package.json 中缺少 version 字段");
}

if (shouldPrint && !requestedVersion) {
  console.log(version);
  process.exit(0);
}

if (shouldCheck) {
  const cargoToml = fs.readFileSync(cargoPath, "utf8");
  const cargoVersion = readPackageVersion(cargoToml);
  const tauriConfig = readJson(tauriConfigPath);
  const finderInfo = fs.readFileSync(finderInfoPath, "utf8");
  const finderProject = fs.readFileSync(finderProjectPath, "utf8");
  const mismatches = [
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
    [
      "src-tauri/macos-finder-sync/Info.plist CFBundleShortVersionString",
      readPlistValue(finderInfo, "CFBundleShortVersionString"),
    ],
    [
      "src-tauri/macos-finder-sync/Info.plist CFBundleVersion",
      readPlistValue(finderInfo, "CFBundleVersion"),
      bundleVersion,
    ],
  ].filter(([, current, expected = version]) => current !== expected);

  for (const [setting, expected] of [
    ["MARKETING_VERSION", version],
    ["CURRENT_PROJECT_VERSION", bundleVersion],
  ]) {
    const values = readXcodeSettingValues(finderProject, setting);
    if (values.length === 0 || values.some((current) => current !== expected)) {
      mismatches.push([
        `src-tauri/macos-finder-sync/NovaSVNFinderSync.xcodeproj ${setting}`,
        values.join(", ") || "<missing>",
        expected,
      ]);
    }
  }

  if (mismatches.length > 0) {
    for (const [filePath, current, expected = version] of mismatches) {
      console.error(`${filePath} 版本 ${current ?? "<missing>"} 与预期 ${expected} 不一致`);
    }
    process.exit(1);
  }

  console.log(`NovaSVN 版本一致：${version}`);
  process.exit(0);
}

packageJson.version = version;
writeJson(packagePath, packageJson);

const cargoToml = fs.readFileSync(cargoPath, "utf8");
const updatedCargoToml = replacePackageVersion(cargoToml, version);
fs.writeFileSync(cargoPath, updatedCargoToml);

const tauriConfig = readJson(tauriConfigPath);
tauriConfig.version = version;
writeJson(tauriConfigPath, tauriConfig);

const finderInfo = fs.readFileSync(finderInfoPath, "utf8");
fs.writeFileSync(
  finderInfoPath,
  replacePlistValue(
    replacePlistValue(finderInfo, "CFBundleShortVersionString", version),
    "CFBundleVersion",
    bundleVersion,
  ),
);

const finderProject = fs.readFileSync(finderProjectPath, "utf8");
fs.writeFileSync(
  finderProjectPath,
  replaceXcodeSetting(
    replaceXcodeSetting(finderProject, "MARKETING_VERSION", version),
    "CURRENT_PROJECT_VERSION",
    bundleVersion,
  ),
);

if (shouldPrint) {
  console.log(version);
} else {
  console.log(`NovaSVN 版本已同步为 ${version}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function replacePackageVersion(content, version) {
  let inPackageSection = false;
  let replaced = false;

  const lines = content.split(/\r?\n/).map((line) => {
    if (/^\[.+\]\s*$/.test(line)) {
      inPackageSection = line.trim() === "[package]";
    }

    if (inPackageSection && /^version\s*=/.test(line)) {
      replaced = true;
      return `version = "${version}"`;
    }

    return line;
  });

  if (!replaced) {
    fail("src-tauri/Cargo.toml 的 [package] 段缺少 version 字段");
  }

  return lines.join("\n");
}

function readPackageVersion(content) {
  let inPackageSection = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\[.+\]\s*$/.test(line)) {
      inPackageSection = line.trim() === "[package]";
    }

    if (inPackageSection) {
      const match = line.match(/^version\s*=\s*"([^"]+)"/);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

function readPlistValue(content, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.match(
    new RegExp(`<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`),
  )?.[1] ?? null;
}

function replacePlistValue(content, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(<key>${escapedKey}</key>\\s*<string>)([^<]+)(</string>)`);
  if (!pattern.test(content)) {
    fail(`Finder Sync Info.plist 缺少 ${key}`);
  }
  return content.replace(pattern, (_match, prefix, _current, suffix) => `${prefix}${value}${suffix}`);
}

function readXcodeSettingValues(content, setting) {
  const pattern = new RegExp(`\\b${setting}\\s*=\\s*([^;]+);`, "g");
  return [...content.matchAll(pattern)].map((match) => match[1].trim());
}

function replaceXcodeSetting(content, setting, value) {
  const pattern = new RegExp(`(\\b${setting}\\s*=\\s*)([^;]+)(;)`, "g");
  if (!pattern.test(content)) {
    fail(`Finder Sync Xcode 工程缺少 ${setting}`);
  }
  pattern.lastIndex = 0;
  return content.replace(pattern, (_match, prefix, _current, suffix) => `${prefix}${value}${suffix}`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
