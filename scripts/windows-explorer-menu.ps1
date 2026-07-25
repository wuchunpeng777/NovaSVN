param(
  [ValidateSet("Install", "Uninstall")]
  [string]$Mode = "Install",
  [string]$NovaSvnExe = "",
  [string]$ShellExtensionDll = ""
)

$ErrorActionPreference = "Stop"
$usingDefaultExecutable = [string]::IsNullOrWhiteSpace($NovaSvnExe)

if ($Mode -eq "Install" -and $usingDefaultExecutable) {
  $NovaSvnExe = Join-Path $PSScriptRoot "..\src-tauri\target\release\NovaSVN.exe"
}

if ($Mode -eq "Install" -and !(Test-Path -LiteralPath $NovaSvnExe -PathType Leaf)) {
  throw "NovaSVN executable not found: $NovaSvnExe. Build the app first or pass -NovaSvnExe with the installed NovaSVN.exe path."
}

if ($Mode -eq "Install" -and [string]::IsNullOrWhiteSpace($ShellExtensionDll)) {
  if ($usingDefaultExecutable) {
    $ShellExtensionDll = Join-Path $PSScriptRoot "..\src-tauri\windows-shell-extension\target\release\novasvn_shell_extension.dll"
  } else {
    $ShellExtensionDll = Join-Path (Split-Path -Parent $NovaSvnExe) "shell-extension\novasvn_shell_extension.dll"
  }
}

if ($Mode -eq "Install" -and !(Test-Path -LiteralPath $ShellExtensionDll -PathType Leaf)) {
  throw "NovaSVN shell extension not found: $ShellExtensionDll. Build it first or pass -ShellExtensionDll with the installed DLL path."
}

$stateHandlers = @{
  RootMenu = "{0B2DD325-75D0-461D-9FC5-F191AD22FFF6}"
  SvnOnly = "{4D64F10A-B42A-45E5-9034-02F83A16F0AB}"
  Checkout = "{6A5EA9FB-A012-4F3D-BE8A-07C41CE53B1B}"
}
$classRoot = "HKCU:\Software\Classes\CLSID"

foreach ($entry in $stateHandlers.GetEnumerator()) {
  $classPath = Join-Path $classRoot $entry.Value
  Remove-Item -LiteralPath $classPath -Recurse -Force -ErrorAction SilentlyContinue
  if ($Mode -eq "Uninstall") {
    continue
  }

  $serverPath = Join-Path $classPath "InprocServer32"
  New-Item -Path $serverPath -Force | Out-Null
  (Get-Item -LiteralPath $classPath).SetValue("", "NovaSVN $($entry.Key) state")
  (Get-Item -LiteralPath $serverPath).SetValue("", $ShellExtensionDll)
  New-ItemProperty -Path $serverPath -Name "ThreadingModel" -Value "Apartment" -PropertyType String -Force | Out-Null
}

$explorerIconRoot = Join-Path $PSScriptRoot "..\src-tauri\icons\explorer"

$submenuActions = @(
  @{ Key = "Open"; Label = "Open"; Action = "open" },
  @{ Key = "Checkout"; Label = "Checkout"; Action = "checkout"; DirectoriesOnly = $true },
  @{ Key = "Info"; Label = "SVN Info"; Action = "info" },
  @{ Key = "Diff"; Label = "Diff"; Action = "diff" },
  @{ Key = "Blame"; Label = "Blame"; Action = "blame"; FilesOnly = $true },
  @{ Key = "Revert"; Label = "Revert"; Action = "revert" },
  @{ Key = "Delete"; Label = "Delete"; Action = "delete" },
  @{ Key = "Ignore"; Label = "Ignore"; Action = "ignore" },
  @{ Key = "Cleanup"; Label = "Cleanup"; Action = "cleanup" },
  @{ Key = "BranchWorkspace"; Label = "Branch Workspace"; Action = "branch-workspace" }
)
$directActions = @(
  @{ Key = "Update"; Label = "NovaSVN Update"; Action = "update" },
  @{ Key = "Commit"; Label = "NovaSVN Commit"; Action = "commit" },
  @{ Key = "Log"; Label = "NovaSVN Log"; Action = "log" }
)

if ($Mode -eq "Install") {
  foreach ($item in @($submenuActions + $directActions)) {
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    if (!(Test-Path -LiteralPath $iconPath -PathType Leaf)) {
      throw "NovaSVN Explorer icon not found: $iconPath"
    }
  }
}

$roots = @(
  @{ Path = "HKCU:\Software\Classes\Directory\shell"; Placeholder = "%1" },
  @{ Path = "HKCU:\Software\Classes\Directory\Background\shell"; Placeholder = "%V" },
  @{ Path = "HKCU:\Software\Classes\*\shell"; Placeholder = "%1" }
)

foreach ($root in $roots) {
  $menuPath = Join-Path $root.Path "NovaSVN"
  foreach ($item in @($submenuActions + $directActions)) {
    Remove-Item -LiteralPath (Join-Path $root.Path "NovaSVN.$($item.Key)") -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $menuPath -Recurse -Force -ErrorAction SilentlyContinue
  if ($Mode -eq "Uninstall") {
    continue
  }

  $submenuPath = Join-Path $menuPath "shell"
  New-Item -Path $submenuPath -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "MUIVerb" -Value "NovaSVN" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "Icon" -Value $NovaSvnExe -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SubCommands" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "Position" -Value "Bottom" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SeparatorBefore" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "SeparatorAfter" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -Path $menuPath -Name "CommandStateHandler" -Value $stateHandlers.RootMenu -PropertyType String -Force | Out-Null

  $submenuIndex = 1
  foreach ($item in $submenuActions) {
    if ($item.FilesOnly -eq $true -and $root.Path -ne "HKCU:\Software\Classes\*\shell") {
      continue
    }
    if ($item.DirectoriesOnly -eq $true -and $root.Path -eq "HKCU:\Software\Classes\*\shell") {
      continue
    }

    $keyPath = Join-Path $submenuPath ("{0:D2}.$($item.Key)" -f $submenuIndex)
    $submenuIndex += 1
    $commandPath = Join-Path $keyPath "command"
    New-Item -Path $commandPath -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    New-ItemProperty -Path $keyPath -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    $stateHandler = if ($item.Action -eq "checkout") { $stateHandlers.Checkout } else { $stateHandlers.SvnOnly }
    New-ItemProperty -Path $keyPath -Name "CommandStateHandler" -Value $stateHandler -PropertyType String -Force | Out-Null
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$($root.Placeholder)`""
    (Get-Item -LiteralPath $commandPath).SetValue("", $command)
  }

  foreach ($item in $directActions) {
    if ($item.FilesOnly -eq $true -and $root.Path -ne "HKCU:\Software\Classes\*\shell") {
      continue
    }
    $keyPath = Join-Path $root.Path "NovaSVN.$($item.Key)"
    $commandPath = Join-Path $keyPath "command"
    New-Item -Path $commandPath -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    New-ItemProperty -Path $keyPath -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "Position" -Value "Bottom" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $keyPath -Name "CommandStateHandler" -Value $stateHandlers.SvnOnly -PropertyType String -Force | Out-Null
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$($root.Placeholder)`""
    (Get-Item -LiteralPath $commandPath).SetValue("", $command)
  }
}

Write-Host "NovaSVN Explorer menu $Mode complete."
