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
  @{ Key = "Open"; Label = "Open"; Action = "open" },
  @{ Key = "Checkout"; Label = "Checkout"; Action = "checkout"; DirectoriesOnly = $true },
  @{ Key = "Commit"; Label = "Commit"; Action = "commit" },
  @{ Key = "Update"; Label = "Update"; Action = "update" },
  @{ Key = "Info"; Label = "SVN Info"; Action = "info" },
  @{ Key = "Diff"; Label = "Diff"; Action = "diff" },
  @{ Key = "Log"; Label = "Log"; Action = "log" },
  @{ Key = "Blame"; Label = "Blame"; Action = "blame"; FilesOnly = $true },
  @{ Key = "Revert"; Label = "Revert"; Action = "revert" },
  @{ Key = "Cleanup"; Label = "Cleanup"; Action = "cleanup" },
  @{ Key = "BranchWorkspace"; Label = "Branch Workspace"; Action = "branch-workspace" }
)

$roots = @(
  @{ Path = "HKCU:\Software\Classes\Directory\shell"; Placeholder = "%1" },
  @{ Path = "HKCU:\Software\Classes\Directory\Background\shell"; Placeholder = "%V" },
  @{ Path = "HKCU:\Software\Classes\*\shell"; Placeholder = "%1" }
)

foreach ($root in $roots) {
  $menuPath = Join-Path $root.Path "NovaSVN"
  foreach ($item in $actions) {
    Remove-Item -LiteralPath (Join-Path $root.Path "NovaSVN.$($item.Key)") -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($Mode -eq "Uninstall") {
    Remove-Item -LiteralPath $menuPath -Recurse -Force -ErrorAction SilentlyContinue
    continue
  }

  $submenuPath = Join-Path $menuPath "shell"
  New-Item -Path $submenuPath -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "MUIVerb" -Value "NovaSVN" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "Icon" -Value $NovaSvnExe -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SubCommands" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SeparatorBefore" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SeparatorAfter" -Value "" -PropertyType String -Force | Out-Null

  for ($index = 0; $index -lt $actions.Count; $index += 1) {
    $item = $actions[$index]
    if ($item.FilesOnly -eq $true -and $root.Path -ne "HKCU:\Software\Classes\*\shell") {
      continue
    }
    if ($item.DirectoriesOnly -eq $true -and $root.Path -eq "HKCU:\Software\Classes\*\shell") {
      continue
    }

    $keyPath = Join-Path $submenuPath ("{0:D2}.$($item.Key)" -f ($index + 1))
    $commandPath = Join-Path $keyPath "command"
    New-Item -Path $commandPath -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$($root.Placeholder)`""
    (Get-Item -LiteralPath $commandPath).SetValue("", $command)
  }
}

Write-Host "NovaSVN Explorer menu $Mode complete."
