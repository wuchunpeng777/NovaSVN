#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/dmg"
MODE="local"

if [[ "${1:-}" == "--notarize" ]]; then
  MODE="distribution"
elif [[ $# -gt 0 ]]; then
  echo "未知 macOS 发布参数：$1" >&2
  exit 1
fi

for tool in xcodebuild codesign hdiutil xcrun; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "macOS 发布缺少工具：${tool}" >&2
    exit 1
  fi
done

SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
if [[ "${MODE}" == "distribution" ]]; then
  if [[ "${SIGNING_IDENTITY}" == "-" || "${SIGNING_IDENTITY}" != Developer\ ID\ Application:* ]]; then
    echo "正式 macOS 发布必须设置 APPLE_SIGNING_IDENTITY=Developer ID Application: ..." >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -F -- "\"${SIGNING_IDENTITY}\"" >/dev/null; then
    echo "钥匙串中没有可用签名身份：${SIGNING_IDENTITY}" >&2
    exit 1
  fi
  if [[ -z "${NOVASVN_NOTARY_PROFILE:-}" ]]; then
    echo "正式 macOS 发布必须设置 NOVASVN_NOTARY_PROFILE" >&2
    echo "请先使用 xcrun notarytool store-credentials 创建钥匙串凭据。" >&2
    exit 1
  fi
fi

cd "${ROOT_DIR}"
bash scripts/build-macos-finder-sync.sh
mkdir -p "${DMG_DIR}"
rm -f "${DMG_DIR}"/NovaSVN_*.dmg "${DMG_DIR}"/NovaSVN_*.dmg.sha256
env \
  -u APPLE_SIGNING_IDENTITY \
  -u APPLE_ID \
  -u APPLE_PASSWORD \
  -u APPLE_TEAM_ID \
  npx tauri build --bundles dmg --no-sign

bash scripts/inject-macos-finder-sync-into-dmg.sh
DMG_CANDIDATES=("${DMG_DIR}"/NovaSVN_*.dmg)
if [[ ${#DMG_CANDIDATES[@]} -ne 1 || ! -f "${DMG_CANDIDATES[0]}" ]]; then
  echo "macOS 构建后无法唯一定位 DMG" >&2
  exit 1
fi
DMG_PATH="${DMG_CANDIDATES[0]}"

if [[ "${MODE}" == "distribution" ]]; then
  bash scripts/notarize-macos-release.sh "${DMG_PATH}"
fi
bash scripts/verify-macos-release.sh --mode "${MODE}" "${DMG_PATH}"

echo "macOS ${MODE} 发布产物：${DMG_PATH}"
