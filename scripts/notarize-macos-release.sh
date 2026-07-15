#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法：bash scripts/notarize-macos-release.sh <DMG 路径>" >&2
  exit 1
fi

DMG_PATH="$1"
NOTARY_PROFILE="${NOVASVN_NOTARY_PROFILE:-}"
NOTARY_TIMEOUT="${NOVASVN_NOTARY_TIMEOUT:-30m}"

if [[ ! -f "${DMG_PATH}" ]]; then
  echo "Notarization DMG 不存在：${DMG_PATH}" >&2
  exit 1
fi
if [[ -z "${NOTARY_PROFILE}" ]]; then
  echo "缺少 NOVASVN_NOTARY_PROFILE" >&2
  exit 1
fi

xcrun notarytool submit "${DMG_PATH}" \
  --keychain-profile "${NOTARY_PROFILE}" \
  --wait \
  --timeout "${NOTARY_TIMEOUT}"
xcrun stapler staple "${DMG_PATH}"
xcrun stapler validate "${DMG_PATH}"
