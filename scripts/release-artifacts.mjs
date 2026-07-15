import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
);
const [command = "generate", ...rawArguments] = process.argv.slice(2);
const options = parseArguments(rawArguments);
const bundleRoot = path.resolve(
  projectRoot,
  options.root ?? "src-tauri/target/release/bundle",
);
const manifestPath = path.resolve(
  projectRoot,
  options.manifest ?? path.join(bundleRoot, "release-manifest.json"),
);
const requiredPlatforms = new Set(
  (options.require ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

if (command === "generate") {
  const artifacts = discoverArtifacts(bundleRoot, packageJson.version);
  validateRequiredPlatforms(artifacts, requiredPlatforms);
  const manifest = {
    schema_version: 1,
    product: "NovaSVN",
    version: packageJson.version,
    upgrade_strategy: "manual_signed_installer",
    artifacts,
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`发布产物清单：${manifestPath}`);
} else if (command === "verify") {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  verifyManifest(manifest, bundleRoot, packageJson.version, requiredPlatforms);
  console.log(`发布产物清单校验通过：${manifestPath}`);
} else {
  fail(`未知命令：${command}`);
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!["--root", "--manifest", "--require"].includes(argument)) {
      fail(`未知参数：${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value) {
      fail(`参数 ${argument} 缺少值`);
    }
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

function discoverArtifacts(root, version) {
  if (!fs.existsSync(root)) {
    fail(`发布产物目录不存在：${root}`);
  }
  const candidates = walkFiles(root)
    .filter((filePath) => isInstaller(root, filePath))
    .sort((left, right) => left.localeCompare(right));
  if (candidates.length === 0) {
    fail(`没有找到 DMG 或 NSIS 产物：${root}`);
  }

  const artifacts = candidates.map((filePath) => {
    const relativePath = normalizeRelativePath(path.relative(root, filePath));
    const metadata = artifactMetadata(relativePath, version);
    const stats = fs.statSync(filePath);
    return {
      ...metadata,
      file: relativePath,
      bytes: stats.size,
      sha256: sha256File(filePath),
    };
  });
  rejectDuplicateArtifacts(artifacts);
  return artifacts;
}

function verifyManifest(manifest, root, version, required) {
  if (manifest.schema_version !== 1) {
    fail(`不支持的产物清单版本：${manifest.schema_version}`);
  }
  if (manifest.product !== "NovaSVN" || manifest.version !== version) {
    fail("产物清单产品或版本与当前工程不一致");
  }
  if (manifest.upgrade_strategy !== "manual_signed_installer") {
    fail("产物清单升级策略无效");
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    fail("产物清单为空");
  }
  for (const artifact of manifest.artifacts) {
    validateArtifactRecord(artifact, version);
  }
  rejectDuplicateArtifacts(manifest.artifacts);
  validateRequiredPlatforms(manifest.artifacts, required);

  for (const artifact of manifest.artifacts) {
    const artifactPath = safeArtifactPath(root, artifact.file);
    if (!fs.statSync(artifactPath).isFile()) {
      fail(`产物不是普通文件：${artifact.file}`);
    }
    const bytes = fs.statSync(artifactPath).size;
    if (bytes !== artifact.bytes) {
      fail(`产物大小不匹配：${artifact.file}`);
    }
    const digest = sha256File(artifactPath);
    if (digest !== artifact.sha256) {
      fail(`产物 SHA-256 不匹配：${artifact.file}`);
    }
  }
}

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      return [];
    }
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function isInstaller(root, filePath) {
  const normalized = normalizeRelativePath(path.relative(root, filePath)).toLowerCase();
  return (
    /^dmg\/[^/]+\.dmg$/.test(normalized) ||
    /^nsis\/[^/]+-setup\.exe$/.test(normalized)
  );
}

function artifactMetadata(relativePath, version) {
  if (typeof relativePath !== "string") {
    fail("产物清单缺少文件路径");
  }
  const normalized = relativePath.toLowerCase();
  let platform;
  let type;
  if (/^dmg\/[^/]+\.dmg$/.test(normalized)) {
    platform = "macos";
    type = "dmg";
  } else if (/^nsis\/[^/]+-setup\.exe$/.test(normalized)) {
    platform = "windows";
    type = "nsis";
  } else {
    fail(`产物路径或类型无效：${relativePath}`);
  }

  const fileName = path.posix.basename(relativePath);
  if (!fileName.includes(`_${version}_`)) {
    fail(`产物版本与 package.json 不一致：${relativePath}`);
  }
  const architecture = artifactArchitecture(fileName);
  if (architecture === "unknown") {
    fail(`无法识别产物架构：${relativePath}`);
  }
  return { platform, type, architecture };
}

function validateArtifactRecord(artifact, version) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    fail("产物清单包含无效记录");
  }
  const expected = artifactMetadata(artifact.file, version);
  if (
    artifact.platform !== expected.platform ||
    artifact.type !== expected.type ||
    artifact.architecture !== expected.architecture
  ) {
    fail(`产物平台、类型或架构与文件名不一致：${artifact.file}`);
  }
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) {
    fail(`产物字节数无效：${artifact.file}`);
  }
  if (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
    fail(`产物 SHA-256 格式无效：${artifact.file}`);
  }
}

function artifactArchitecture(fileName) {
  const normalized = fileName.toLowerCase();
  if (normalized.includes("universal")) return "universal";
  if (normalized.includes("aarch64") || normalized.includes("arm64")) return "aarch64";
  if (normalized.includes("x86_64") || normalized.includes("x64")) return "x86_64";
  if (normalized.includes("x86")) return "x86";
  return "unknown";
}

function rejectDuplicateArtifacts(artifacts) {
  const identities = new Set();
  const files = new Set();
  for (const artifact of artifacts) {
    const identity = `${artifact.platform}:${artifact.type}:${artifact.architecture}`;
    if (identities.has(identity)) {
      fail(`产物清单包含重复目标：${identity}`);
    }
    if (files.has(artifact.file)) {
      fail(`产物清单包含重复文件：${artifact.file}`);
    }
    identities.add(identity);
    files.add(artifact.file);
  }
}

function validateRequiredPlatforms(artifacts, required) {
  for (const platform of required) {
    if (!["macos", "windows"].includes(platform)) {
      fail(`未知必需平台：${platform}`);
    }
    if (!artifacts.some((artifact) => artifact.platform === platform)) {
      fail(`缺少必需平台产物：${platform}`);
    }
  }
}

function safeArtifactPath(root, relativePath) {
  if (
    typeof relativePath !== "string" ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\\")
  ) {
    fail("产物清单包含无效路径");
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`产物路径逃逸发布目录：${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, ...segments);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(`产物路径逃逸发布目录：${relativePath}`);
  }
  if (!fs.existsSync(resolved)) {
    fail(`产物不存在：${relativePath}`);
  }
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) {
      fail(`产物路径不能包含符号链接：${relativePath}`);
    }
  }
  return resolved;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
