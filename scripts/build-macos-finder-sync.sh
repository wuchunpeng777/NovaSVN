#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${ROOT_DIR}/src-tauri/macos-finder-sync"
BUILD_DIR="${ROOT_DIR}/src-tauri/target/macos-finder-sync"
APP_EXT_DIR="${BUILD_DIR}/NovaSVNFinderSync.appex"
CONTENTS_DIR="${APP_EXT_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
EXECUTABLE="${MACOS_DIR}/NovaSVNFinderSync"
TAURI_APP_DIR="${ROOT_DIR}/src-tauri/target/release/bundle/macos/NovaSVN.app"

rm -rf "${APP_EXT_DIR}"
mkdir -p "${MACOS_DIR}"

cp "${SRC_DIR}/Info.plist" "${CONTENTS_DIR}/Info.plist"

swiftc \
  -emit-library \
  -module-name NovaSVNFinderSync \
  -target arm64-apple-macos13.0 \
  -sdk "$(xcrun --sdk macosx --show-sdk-path)" \
  -framework Cocoa \
  -framework FinderSync \
  -o "${EXECUTABLE}" \
  "${SRC_DIR}/NovaSVNFinderSync.swift"

chmod +x "${EXECUTABLE}"
codesign --force --sign - "${APP_EXT_DIR}" >/dev/null

if [[ -d "${TAURI_APP_DIR}/Contents" ]]; then
  mkdir -p "${TAURI_APP_DIR}/Contents/PlugIns"
  rm -rf "${TAURI_APP_DIR}/Contents/PlugIns/NovaSVNFinderSync.appex"
  cp -R "${APP_EXT_DIR}" "${TAURI_APP_DIR}/Contents/PlugIns/NovaSVNFinderSync.appex"
  codesign --force --deep --sign - "${TAURI_APP_DIR}" >/dev/null
fi

echo "${APP_EXT_DIR}"
