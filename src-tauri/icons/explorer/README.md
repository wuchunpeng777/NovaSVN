# Explorer menu icons

These Windows Explorer / macOS Finder action icons are based on Lucide symbols (ISC license),
with NovaSVN-specific colors on transparent backgrounds for menu-size legibility.

- **Windows**：安装包将 `*.ico` 注册到资源管理器右键菜单  
- **macOS**：`scripts/export-macos-menu-icons.py` 在构建 Finder Sync 时从 `*.ico` 导出 PNG，嵌入扩展 Resources

Regenerate the multi-resolution ICO files with ImageMagick:

```powershell
Get-ChildItem -Filter *.svg | ForEach-Object {
  magick -background none $_.FullName -define icon:auto-resize=64,48,32,24,16 `
    ([System.IO.Path]::ChangeExtension($_.FullName, ".ico"))
}
```
