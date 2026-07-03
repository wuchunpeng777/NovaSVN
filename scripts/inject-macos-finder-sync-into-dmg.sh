#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DMG_PATH="${ROOT_DIR}/src-tauri/target/release/bundle/dmg/NovaSVN_0.1.0_aarch64.dmg"
APPEX_PATH="${ROOT_DIR}/src-tauri/target/macos-finder-sync/NovaSVNFinderSync.appex"
WORK_DIR="${ROOT_DIR}/src-tauri/target/macos-finder-sync-dmg"
RW_DMG="${WORK_DIR}/NovaSVN_rw.dmg"
MOUNT_DIR="${WORK_DIR}/mount"

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
codesign --force --deep --sign - "${APP_DIR}" >/dev/null

cleanup
trap - EXIT

rm -f "${DMG_PATH}"
hdiutil convert "${RW_DMG}" -format UDZO -o "${DMG_PATH%.dmg}" >/dev/null
rm -rf "${WORK_DIR}"
echo "${DMG_PATH}"
