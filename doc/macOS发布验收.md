# macOS 发布验收

## 发布模式

本地实机产物：

```bash
npm run release:macos
```

该入口使用 ad-hoc 签名，适合验证构建、DMG、Finder Sync、Quick Actions 和产物结构。它不会把 Gatekeeper 或 notarization 标记为通过。

正式公证产物：

```bash
export APPLE_SIGNING_IDENTITY='Developer ID Application: Example (TEAMID)'
export NOVASVN_NOTARY_PROFILE='NovaSVN-notary'
npm run release:macos:notarized
```

公证凭据必须预先保存在钥匙串，不把 Apple ID 密码放入命令、环境日志或仓库：

```bash
xcrun notarytool store-credentials 'NovaSVN-notary' \
  --apple-id 'developer@example.com' \
  --team-id 'TEAMID'
```

正式入口在构建前要求可用的 `Developer ID Application` 身份和 `NOVASVN_NOTARY_PROFILE`。缺少任一项会立即失败。

## 构建顺序

1. 校验主应用、Rust crate、Tauri 配置和 Finder Sync 的版本一致性。
2. 使用 Xcode 构建 Finder Sync extension，并按本地或正式模式签名。
3. Tauri 使用 `--no-sign` 生成原始 DMG，避免在嵌入扩展前提前 notarize。
4. 把 extension 写入 `NovaSVN.app/Contents/PlugIns`。
5. 按从内到外的顺序签名 extension、应用和 DMG；正式模式启用 hardened runtime 和时间戳。
6. 正式模式提交 `notarytool --wait`，然后 staple 并验证 DMG ticket。
7. 重新挂载最终 DMG 执行统一产物验收。

主应用 Bundle Identifier 为 `com.novasvn.client`，Finder Sync 为 `com.novasvn.client.finder-sync`。应用标识不再以 `.app` 结尾。

## 自动验收

`scripts/verify-macos-release.sh` 检查：

- DMG checksum 和代码签名。
- 主应用及嵌套 Finder Sync 的 strict/deep 签名。
- 两个 Info.plist、Bundle Identifier 前缀、extension sandbox entitlement 和当前 CPU 架构。
- 8 个 Finder Quick Actions 的隔离安装、plist/workflow 解析和无残留卸载。
- SHA-256 校验文件。
- 正式模式额外检查 Developer ID Authority、Team Identifier、stapled ticket 和 Gatekeeper。

## 2026-07-15 实测

环境：macOS 27.0、Apple Silicon、Xcode 26.6、`notarytool` 1.1.2。

- `npm run release:macos` 通过。
- 生成 `NovaSVN_0.1.0_aarch64.dmg`，最终 DMG、应用和 Finder Sync 签名均可验证。
- Finder Sync 位于应用 `Contents/PlugIns`，包含 arm64，App Sandbox entitlement 存在。
- 8 个 Quick Actions 可在隔离 HOME 安装并全部卸载。
- ad-hoc 和本机 Apple Development 两条本地签名分支均通过；证书分支的应用与 Finder Sync 启用了 hardened runtime，包含时间戳和 Team Identifier。
- Apple Development 当次 SHA-256：`2968c73c8ba9b3ea2ecb519fd997e68f1390efd462c6c33bf3bc32cca71cbdd5`。
- 本机仅有 Apple Development 身份，没有 Developer ID Application 身份，也未配置 notarization 钥匙串 profile；正式入口已验证会在构建前稳定拒绝该环境。

因此，本地 DMG 与 Finder 集成自动验收已完成，正式签名、Apple notarization/stapling 和 Finder 菜单人工可见性仍待具备发布凭据后验证。
