#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src-tauri/macos-finder-sync"
BUILD_DIR="${ROOT_DIR}/src-tauri/target/macos-finder-sync"
XCODE_PROJECT="${SRC_DIR}/NovaSVNFinderSync.xcodeproj"
XCODE_DERIVED_DATA="${BUILD_DIR}/DerivedData"
XCODE_PRODUCTS_DIR="${BUILD_DIR}/Products"
APP_EXT_DIR="${BUILD_DIR}/NovaSVNFinderSync.appex"
CONTENTS_DIR="${APP_EXT_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
EXECUTABLE="${MACOS_DIR}/NovaSVNFinderSync"
SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
BUILD_ARCHS="${NOVASVN_MACOS_ARCHS:-$(uname -m)}"

rm -rf "${APP_EXT_DIR}" "${XCODE_DERIVED_DATA}" "${XCODE_PRODUCTS_DIR}"
mkdir -p "${BUILD_DIR}"

xcodebuild \
  -project "${XCODE_PROJECT}" \
  -scheme NovaSVNFinderSync \
  -configuration Release \
  -destination "generic/platform=macOS" \
  -derivedDataPath "${XCODE_DERIVED_DATA}" \
  CONFIGURATION_BUILD_DIR="${XCODE_PRODUCTS_DIR}" \
  CODE_SIGNING_ALLOWED=NO \
  ARCHS="${BUILD_ARCHS}" \
  ONLY_ACTIVE_ARCH=NO \
  build >/dev/null

cp -R "${XCODE_PRODUCTS_DIR}/NovaSVNFinderSync.appex" "${APP_EXT_DIR}"

# 将与 Windows 共用的 Explorer 菜单图标嵌入 appex Resources
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
mkdir -p "${RESOURCES_DIR}"
python3 "${ROOT_DIR}/scripts/export-macos-menu-icons.py" \
  --source "${ROOT_DIR}/src-tauri/icons/explorer" \
  --dest "${RESOURCES_DIR}" \
  --size 32

chmod +x "${EXECUTABLE}"
if [[ "${SIGNING_IDENTITY}" == "-" ]]; then
  codesign --force --sign - \
    --entitlements "${SRC_DIR}/NovaSVNFinderSync.entitlements" \
    "${APP_EXT_DIR}" >/dev/null
else
  codesign --force --timestamp --options runtime --sign "${SIGNING_IDENTITY}" \
    --entitlements "${SRC_DIR}/NovaSVNFinderSync.entitlements" \
    "${APP_EXT_DIR}" >/dev/null
fi

echo "${APP_EXT_DIR}"
