# Explorer menu icons

These Windows Explorer action icons are based on Lucide symbols (ISC license),
with NovaSVN-specific colors and backgrounds for legibility at menu sizes.

Regenerate the multi-resolution ICO files with ImageMagick:

```powershell
Get-ChildItem -Filter *.svg | ForEach-Object {
  magick $_.FullName -background none -define icon:auto-resize=64,48,32,24,16 `
    ([System.IO.Path]::ChangeExtension($_.FullName, ".ico"))
}
```
