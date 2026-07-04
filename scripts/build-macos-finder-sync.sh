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
TAURI_APP_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/macos/NovaSVN.app"

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
  ARCHS=arm64 \
  ONLY_ACTIVE_ARCH=NO \
  build >/dev/null

cp -R "${XCODE_PRODUCTS_DIR}/NovaSVNFinderSync.appex" "${APP_EXT_DIR}"

chmod +x "${EXECUTABLE}"
codesign --force --sign - --entitlements "${SRC_DIR}/NovaSVNFinderSync.entitlements" "${APP_EXT_DIR}" >/dev/null

if [[ -d "${TAURI_APP_DIR}/Contents" ]]; then
  mkdir -p "${TAURI_APP_DIR}/Contents/PlugIns"
  rm -rf "${TAURI_APP_DIR}/Contents/PlugIns/NovaSVNFinderSync.appex"
  cp -R "${APP_EXT_DIR}" "${TAURI_APP_DIR}/Contents/PlugIns/NovaSVNFinderSync.appex"
  codesign --force --sign - "${TAURI_APP_DIR}" >/dev/null
fi

echo "${APP_EXT_DIR}"
