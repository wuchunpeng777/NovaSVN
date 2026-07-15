import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "release-artifacts.mjs");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const version = packageJson.version;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "novasvn-release-artifacts-"));
const bundle = path.join(fixture, "bundle");
const manifest = path.join(fixture, "release-manifest.json");

try {
  fs.mkdirSync(path.join(bundle, "dmg"), { recursive: true });
  fs.mkdirSync(path.join(bundle, "nsis"), { recursive: true });
  const dmg = path.join(bundle, "dmg", `NovaSVN_${version}_aarch64.dmg`);
  const nsis = path.join(bundle, "nsis", `NovaSVN_${version}_x64-setup.exe`);
  fs.writeFileSync(dmg, "dmg fixture");
  fs.writeFileSync(nsis, "nsis fixture");

  execFileSync(process.execPath, [
    script,
    "generate",
    "--root",
    bundle,
    "--manifest",
    manifest,
    "--require",
    "macos,windows",
  ]);
  execFileSync(process.execPath, [
    script,
    "verify",
    "--root",
    bundle,
    "--manifest",
    manifest,
    "--require",
    "macos,windows",
  ]);

  const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (
    parsed.version !== version ||
    parsed.artifacts.length !== 2 ||
    !parsed.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256))
  ) {
    throw new Error("发布产物清单内容无效");
  }

  fs.appendFileSync(dmg, "tampered");
  const tampered = spawnSync(process.execPath, [
    script,
    "verify",
    "--root",
    bundle,
    "--manifest",
    manifest,
  ]);
  if (tampered.status === 0 || !tampered.stderr.toString().includes("产物大小不匹配")) {
    throw new Error("发布产物被修改后必须校验失败");
  }

  console.log("发布产物清单生成、防篡改校验和平台要求检查通过");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
