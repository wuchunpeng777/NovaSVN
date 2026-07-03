param(
  [ValidateSet("Install", "Uninstall")]
  [string]$Mode = "Install",
  [string]$NovaSvnExe = ""
)

$ErrorActionPreference = "Stop"

if ($Mode -eq "Install" -and [string]::IsNullOrWhiteSpace($NovaSvnExe)) {
  $NovaSvnExe = Join-Path $PSScriptRoot "..\src-tauri\target\release\NovaSVN.exe"
}

if ($Mode -eq "Install" -and !(Test-Path -LiteralPath $NovaSvnExe -PathType Leaf)) {
  throw "NovaSVN executable not found: $NovaSvnExe. Build the app first or pass -NovaSvnExe with the installed NovaSVN.exe path."
}

$actions = @(
  @{ Key = "Open"; Label = "Open in NovaSVN"; Action = "open" },
  @{ Key = "Commit"; Label = "NovaSVN Commit"; Action = "commit" },
  @{ Key = "Update"; Label = "NovaSVN Update"; Action = "update" },
  @{ Key = "Diff"; Label = "NovaSVN Diff"; Action = "diff" },
  @{ Key = "Log"; Label = "NovaSVN Log"; Action = "log" },
  @{ Key = "Revert"; Label = "NovaSVN Revert"; Action = "revert" },
  @{ Key = "Cleanup"; Label = "NovaSVN Cleanup"; Action = "cleanup" },
  @{ Key = "BranchWorkspace"; Label = "NovaSVN Branch Workspace"; Action = "branch-workspace" }
)

$roots = @(
  "HKCU:\Software\Classes\Directory\shell",
  "HKCU:\Software\Classes\Directory\Background\shell",
  "HKCU:\Software\Classes\*\shell"
)

foreach ($root in $roots) {
  foreach ($item in $actions) {
    $keyPath = Join-Path $root "NovaSVN.$($item.Key)"
    if ($Mode -eq "Uninstall") {
      Remove-Item -LiteralPath $keyPath -Recurse -Force -ErrorAction SilentlyContinue
      continue
    }

    $commandPath = Join-Path $keyPath "command"
    New-Item -Path $commandPath -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "Icon" -Value $NovaSvnExe -PropertyType String -Force | Out-Null
    $pathPlaceholder = if ($root -like "*\Directory\Background\shell") { "%V" } else { "%1" }
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$pathPlaceholder`""
    (Get-Item -LiteralPath $commandPath).SetValue("", $command)
  }
}

Write-Host "NovaSVN Explorer menu $Mode complete."
