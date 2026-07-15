#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/dmg"
DMG_PATH="${1:-}"
APPEX_PATH="${ROOT_DIR}/src-tauri/target/macos-finder-sync/NovaSVNFinderSync.appex"
ENTITLEMENTS_PATH="${ROOT_DIR}/src-tauri/macos-finder-sync/NovaSVNFinderSync.entitlements"
WORK_DIR="${ROOT_DIR}/src-tauri/target/macos-finder-sync-dmg"
RW_DMG="${WORK_DIR}/NovaSVN_rw.dmg"
MOUNT_DIR="${WORK_DIR}/mount"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"

if [[ -z "${DMG_PATH}" ]]; then
  DMG_CANDIDATES=("${DMG_DIR}"/NovaSVN_*.dmg)
  if [[ ${#DMG_CANDIDATES[@]} -ne 1 || ! -f "${DMG_CANDIDATES[0]}" ]]; then
    echo "无法唯一定位 NovaSVN DMG，请传入明确路径" >&2
    exit 1
  fi
  DMG_PATH="${DMG_CANDIDATES[0]}"
elif [[ "${DMG_PATH}" != /* ]]; then
  DMG_PATH="${ROOT_DIR}/${DMG_PATH}"
fi

if [[ ! -f "${DMG_PATH}" ]]; then
  echo "DMG 不存在：${DMG_PATH}" >&2
  exit 1
fi

if [[ ! -d "${APPEX_PATH}" ]]; then
  echo "Finder Sync 扩展不存在：${APPEX_PATH}" >&2
  exit 1
fi

rm -rf "${WORK_DIR}"
mkdir -p "${MOUNT_DIR}"

hdiutil convert "${DMG_PATH}" -format UDRW -o "${RW_DMG%.dmg}" >/dev/null
hdiutil attach "${RW_DMG}" -mountpoint "${MOUNT_DIR}" -nobrowse -readwrite >/dev/null

cleanup() {
  hdiutil detach "${MOUNT_DIR}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

APP_DIR="${MOUNT_DIR}/NovaSVN.app"
PLUGINS_DIR="${APP_DIR}/Contents/PlugIns"
mkdir -p "${PLUGINS_DIR}"
rm -rf "${PLUGINS_DIR}/NovaSVNFinderSync.appex"
cp -R "${APPEX_PATH}" "${PLUGINS_DIR}/NovaSVNFinderSync.appex"
if [[ "${SIGNING_IDENTITY}" == "-" ]]; then
  codesign --force --sign - --entitlements "${ENTITLEMENTS_PATH}" \
    "${PLUGINS_DIR}/NovaSVNFinderSync.appex" >/dev/null
  codesign --force --sign - "${APP_DIR}" >/dev/null
else
  codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" \
    --entitlements "${ENTITLEMENTS_PATH}" \
    "${PLUGINS_DIR}/NovaSVNFinderSync.appex" >/dev/null
  codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" \
    "${APP_DIR}" >/dev/null
fi

cleanup
trap - EXIT

rm -f "${DMG_PATH}"
hdiutil convert "${RW_DMG}" -format UDZO -o "${DMG_PATH%.dmg}" >/dev/null
rm -rf "${WORK_DIR}"

if [[ "${SIGNING_IDENTITY}" == "-" ]]; then
  codesign --force --sign - "${DMG_PATH}" >/dev/null
else
  codesign --force --timestamp --sign "${SIGNING_IDENTITY}" "${DMG_PATH}" >/dev/null
fi
echo "${DMG_PATH}"
