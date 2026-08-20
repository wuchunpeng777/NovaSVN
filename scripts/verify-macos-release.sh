#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="local"
if [[ "${1:-}" == "--mode" ]]; then
  MODE="${2:-}"
  shift 2
fi
if [[ "${MODE}" != "local" && "${MODE}" != "distribution" ]]; then
  echo "macOS 验收模式必须是 local 或 distribution" >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "用法：bash scripts/verify-macos-release.sh [--mode local|distribution] <DMG 路径>" >&2
  exit 1
fi

DMG_PATH="$1"
EXPECTED_APP_ID="com.novasvn.client"
EXPECTED_VERSION="$(node "${ROOT_DIR}/scripts/sync-version.mjs" --print)"
MOUNT_DIR="$(mktemp -d)"
TEMP_HOME="$(mktemp -d)"
MOUNTED=false

cleanup() {
  if [[ "${MOUNTED}" == "true" ]]; then
    hdiutil detach "${MOUNT_DIR}" >/dev/null 2>&1 || true
  fi
  rm -rf "${MOUNT_DIR}" "${TEMP_HOME}"
}
trap cleanup EXIT

if [[ ! -f "${DMG_PATH}" ]]; then
  echo "DMG 不存在：${DMG_PATH}" >&2
  exit 1
fi

hdiutil verify "${DMG_PATH}" >/dev/null
codesign --verify --strict --verbose=2 "${DMG_PATH}"
hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_DIR}" -nobrowse -readonly >/dev/null
MOUNTED=true

APP_PATH="${MOUNT_DIR}/NovaSVN.app"
APPEX_PATH="${APP_PATH}/Contents/PlugIns/NovaSVNFinderSync.appex"
APP_PLIST="${APP_PATH}/Contents/Info.plist"
APPEX_PLIST="${APPEX_PATH}/Contents/Info.plist"
APPEX_EXECUTABLE="${APPEX_PATH}/Contents/MacOS/NovaSVNFinderSync"

for path in "${APP_PATH}" "${APPEX_PATH}" "${APP_PLIST}" "${APPEX_PLIST}" "${APPEX_EXECUTABLE}"; do
  if [[ ! -e "${path}" ]]; then
    echo "DMG 缺少产物：${path}" >&2
    exit 1
  fi
done

plutil -lint "${APP_PLIST}" "${APPEX_PLIST}" >/dev/null
APP_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${APP_PLIST}")"
APPEX_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${APPEX_PLIST}")"
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${APP_PLIST}")"
APPEX_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "${APPEX_PLIST}")"
if [[ "${APP_ID}" != "${EXPECTED_APP_ID}" ]]; then
  echo "应用 Bundle Identifier 错误：${APP_ID}" >&2
  exit 1
fi
if [[ "${APPEX_ID}" != "${APP_ID}.finder-sync" ]]; then
  echo "Finder Sync Bundle Identifier 未使用应用前缀：${APPEX_ID}" >&2
  exit 1
fi
if [[ "${APP_VERSION}" != "${EXPECTED_VERSION}" ]]; then
  echo "应用版本错误：${APP_VERSION}，预期 ${EXPECTED_VERSION}" >&2
  exit 1
fi
if [[ "${APPEX_VERSION}" != "${EXPECTED_VERSION}" ]]; then
  echo "Finder Sync 版本错误：${APPEX_VERSION}，预期 ${EXPECTED_VERSION}" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "${APP_PATH}"
if ! codesign -d --entitlements :- "${APPEX_PATH}" 2>&1 | grep -q "com.apple.security.app-sandbox"; then
  echo "Finder Sync 扩展缺少 App Sandbox entitlement" >&2
  exit 1
fi
if ! lipo -archs "${APPEX_EXECUTABLE}" | tr ' ' '\n' | grep -Fx "$(uname -m)" >/dev/null; then
  echo "Finder Sync 扩展不包含当前架构：$(uname -m)" >&2
  exit 1
fi

# Finder 菜单图标（与 Windows explorer-icons 同源）
APPEX_RESOURCES="${APPEX_PATH}/Contents/Resources"
for action in open info diff blame revert delete ignore cleanup branch-workspace browse update commit log checkout; do
  if [[ ! -f "${APPEX_RESOURCES}/${action}.png" && ! -f "${APPEX_RESOURCES}/${action}@2x.png" ]]; then
    echo "Finder Sync 扩展缺少菜单图标：${action}.png" >&2
    exit 1
  fi
done

HOME="${TEMP_HOME}" bash "${ROOT_DIR}/scripts/macos-finder-quick-actions.sh" install >/dev/null
find "${TEMP_HOME}/Library/Services" -name Info.plist -print0 | xargs -0 -n1 plutil -lint >/dev/null
find "${TEMP_HOME}/Library/Services" -name document.wflow -print0 | xargs -0 -n1 plutil -lint >/dev/null
WORKFLOW_COUNT="$(find "${TEMP_HOME}/Library/Services" -maxdepth 1 -name '*.workflow' | wc -l | tr -d ' ')"
if [[ "${WORKFLOW_COUNT}" != "8" ]]; then
  echo "Finder Quick Actions 数量错误：${WORKFLOW_COUNT}" >&2
  exit 1
fi
HOME="${TEMP_HOME}" bash "${ROOT_DIR}/scripts/macos-finder-quick-actions.sh" uninstall >/dev/null
if find "${TEMP_HOME}/Library/Services" -maxdepth 1 -name '*.workflow' | grep -q .; then
  echo "Finder Quick Actions 卸载后仍有残留" >&2
  exit 1
fi

if [[ "${MODE}" == "distribution" ]]; then
  APP_SIGNATURE="$(codesign -d --verbose=4 "${APP_PATH}" 2>&1)"
  if grep -q "Signature=adhoc" <<<"${APP_SIGNATURE}"; then
    echo "正式应用不能使用 ad-hoc 签名" >&2
    exit 1
  fi
  if ! grep -q "Authority=Developer ID Application:" <<<"${APP_SIGNATURE}"; then
    echo "正式应用缺少 Developer ID Application 签名" >&2
    exit 1
  fi
  if grep -q "TeamIdentifier=not set" <<<"${APP_SIGNATURE}"; then
    echo "正式应用缺少 Team Identifier" >&2
    exit 1
  fi
  xcrun stapler validate "${DMG_PATH}"
  spctl --assess --type execute --verbose=4 "${APP_PATH}"
  spctl --assess --type open --context context:primary-signature --verbose=4 "${DMG_PATH}"
else
  echo "本地模式使用可验证签名；Gatekeeper 与 notarization 仅在 distribution 模式强制检查。"
fi

shasum -a 256 "${DMG_PATH}" | tee "${DMG_PATH}.sha256"
node "${ROOT_DIR}/scripts/release-artifacts.mjs" generate --root \
  "${ROOT_DIR}/src-tauri/target/release/bundle" --require macos
node "${ROOT_DIR}/scripts/release-artifacts.mjs" verify --root \
  "${ROOT_DIR}/src-tauri/target/release/bundle" --require macos
echo "macOS ${MODE} 产物验收通过"
