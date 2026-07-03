import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packagePath = path.join(root, "package.json");
const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(root, "src-tauri", "tauri.conf.json");

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

if (!version) {
  fail("package.json 中缺少 version 字段");
}

if (shouldCheck) {
  const cargoToml = fs.readFileSync(cargoPath, "utf8");
  const cargoVersion = readPackageVersion(cargoToml);
  const tauriConfig = readJson(tauriConfigPath);
  const mismatches = [
    ["src-tauri/Cargo.toml", cargoVersion],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
  ].filter(([, current]) => current !== version);

  if (mismatches.length > 0) {
    for (const [filePath, current] of mismatches) {
      console.error(`${filePath} 版本 ${current ?? "<missing>"} 与 package.json ${version} 不一致`);
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

function fail(message) {
  console.error(message);
  process.exit(1);
}
