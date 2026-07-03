#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-install}"
APP_NAME="${NOVASVN_APP_NAME:-NovaSVN}"
SERVICES_DIR="${HOME}/Library/Services"

declare -a ACTIONS=(
  "Open in NovaSVN|open"
  "NovaSVN Commit|commit"
  "NovaSVN Update|update"
  "NovaSVN Diff|diff"
  "NovaSVN Log|log"
  "NovaSVN Revert|revert"
  "NovaSVN Cleanup|cleanup"
  "NovaSVN Branch Workspace|branch-workspace"
)

workflow_name() {
  local label="$1"
  printf "%s.workflow" "$label"
}

install_action() {
  local label="$1"
  local action="$2"
  local workflow_dir="${SERVICES_DIR}/$(workflow_name "$label")"
  mkdir -p "${workflow_dir}/Contents"

  cat > "${workflow_dir}/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>${label}</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSSendFileTypes</key>
      <array>
        <string>public.item</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

  cat > "${workflow_dir}/Contents/document.wflow" <<WFLOW
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>actions</key>
  <array>
    <dict>
      <key>action</key>
      <dict>
        <key>AMAccepts</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.path</string>
          </array>
        </dict>
        <key>AMActionVersion</key>
        <string>2.0.3</string>
        <key>AMApplication</key>
        <array>
          <string>Automator</string>
        </array>
        <key>AMParameterProperties</key>
        <dict>
          <key>COMMAND_STRING</key>
          <dict>
            <key>isPathPopUp</key>
            <false/>
          </dict>
        </dict>
        <key>AMProvides</key>
        <dict>
          <key>Container</key>
          <string>List</string>
          <key>Types</key>
          <array>
            <string>com.apple.cocoa.string</string>
          </array>
        </dict>
        <key>ActionBundlePath</key>
        <string>/System/Library/Automator/Run Shell Script.action</string>
        <key>ActionName</key>
        <string>Run Shell Script</string>
        <key>ActionParameters</key>
        <dict>
          <key>COMMAND_STRING</key>
          <string>for f in "$@"; do
  open -a "${APP_NAME}" --args --novasvn-action "${action}" --novasvn-path "$f"
done</string>
          <key>CheckedForUserDefaultShell</key>
          <true/>
          <key>inputMethod</key>
          <integer>1</integer>
          <key>shell</key>
          <string>/bin/zsh</string>
        </dict>
      </dict>
    </dict>
  </array>
</dict>
</plist>
WFLOW
}

mkdir -p "$SERVICES_DIR"

for entry in "${ACTIONS[@]}"; do
  IFS="|" read -r label action <<< "$entry"
  workflow_dir="${SERVICES_DIR}/$(workflow_name "$label")"
  if [[ "$MODE" == "uninstall" ]]; then
    rm -rf "$workflow_dir"
  else
    install_action "$label" "$action"
  fi
done

echo "NovaSVN macOS Finder Quick Actions ${MODE} complete."
