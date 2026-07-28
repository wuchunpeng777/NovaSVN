param(
  [ValidateSet("Install", "Uninstall")]
  [string]$Mode = "Install",
  [string]$NovaSvnExe = "",
  [string]$ShellExtensionDll = ""
)

$ErrorActionPreference = "Stop"
$usingDefaultExecutable = [string]::IsNullOrWhiteSpace($NovaSvnExe)

function New-LiteralRegistryKey {
  param([string]$Path)

  $prefix = "HKCU:\"
  if (!$Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsupported registry path: $Path"
  }

  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($Path.Substring($prefix.Length))
  if ($null -eq $key) {
    throw "Unable to create registry key: $Path"
  }
  $key.Dispose()
}

$stateHandlers = @{
  RootMenu = "{0B2DD325-75D0-461D-9FC5-F191AD22FFF6}"
  SvnOnly = "{4D64F10A-B42A-45E5-9034-02F83A16F0AB}"
  Checkout = "{6A5EA9FB-A012-4F3D-BE8A-07C41CE53B1B}"
}

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
    $registeredHandler = Get-Item -LiteralPath "HKCU:\Software\Classes\CLSID\$($stateHandlers.RootMenu)\InprocServer32" -ErrorAction SilentlyContinue
    if ($null -ne $registeredHandler) {
      $ShellExtensionDll = [string]$registeredHandler.GetValue("")
    }
    if ([string]::IsNullOrWhiteSpace($ShellExtensionDll)) {
      $ShellExtensionDll = Get-ChildItem (Join-Path (Split-Path -Parent $NovaSvnExe) "shell-extension") -Filter "*.tmp.dll" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    }
  }
}

if ($Mode -eq "Install" -and !(Test-Path -LiteralPath $ShellExtensionDll -PathType Leaf)) {
  throw "NovaSVN shell extension not found: $ShellExtensionDll. Build it first or pass -ShellExtensionDll with the installed DLL path."
}

$classRoot = "HKCU:\Software\Classes\CLSID"

foreach ($entry in $stateHandlers.GetEnumerator()) {
  $classPath = Join-Path $classRoot $entry.Value
  Remove-Item -LiteralPath $classPath -Recurse -Force -ErrorAction SilentlyContinue
  if ($Mode -eq "Uninstall") {
    continue
  }

  $serverPath = Join-Path $classPath "InprocServer32"
  New-LiteralRegistryKey $serverPath
  Set-Item -LiteralPath $classPath -Value "NovaSVN $($entry.Key) state"
  Set-Item -LiteralPath $serverPath -Value $ShellExtensionDll
  New-ItemProperty -LiteralPath $serverPath -Name "ThreadingModel" -Value "Apartment" -PropertyType String -Force | Out-Null
}

$explorerIconRoot = Join-Path $PSScriptRoot "..\src-tauri\icons\explorer"

$submenuActions = @(
  @{ Key = "Open"; Label = "Open"; Action = "open" },
  @{ Key = "Info"; Label = "SVN Info"; Action = "info" },
  @{ Key = "Diff"; Label = "Diff"; Action = "diff" },
  @{ Key = "Blame"; Label = "Blame"; Action = "blame"; FilesOnly = $true },
  @{ Key = "Revert"; Label = "Revert"; Action = "revert" },
  @{ Key = "Delete"; Label = "Delete"; Action = "delete" },
  @{ Key = "Ignore"; Label = "Ignore"; Action = "ignore" },
  @{ Key = "Cleanup"; Label = "Cleanup"; Action = "cleanup" },
  @{ Key = "BranchWorkspace"; Label = "Branch Workspace"; Action = "branch-workspace" },
  @{ Key = "RepoBrowser"; Label = "Repo Browser"; Action = "browse" }
)
$checkoutAction = @{ Key = "Checkout"; Label = "NovaSVN Checkout"; Action = "checkout" }
$directActions = @(
  @{ Key = "Update"; Label = "NovaSVN Update"; Action = "update" },
  @{ Key = "Commit"; Label = "NovaSVN Commit"; Action = "commit" },
  @{ Key = "Log"; Label = "NovaSVN Log"; Action = "log" }
)

if ($Mode -eq "Install") {
  foreach ($item in @($submenuActions + $directActions + $checkoutAction)) {
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    if (!(Test-Path -LiteralPath $iconPath -PathType Leaf)) {
      throw "NovaSVN Explorer icon not found: $iconPath"
    }
  }
}

$roots = @(
  @{ Path = "HKCU:\Software\Classes\Directory\shell"; Placeholder = "%1"; SupportsCheckout = $true },
  @{ Path = "HKCU:\Software\Classes\Directory\Background\shell"; Placeholder = "%V"; SupportsCheckout = $true; Background = $true },
  @{ Path = "HKCU:\Software\Classes\*\shell"; Placeholder = "%1" }
)

foreach ($root in $roots) {
  $menuPath = Join-Path $root.Path "NovaSVN"
  foreach ($item in @($submenuActions + $directActions)) {
    Remove-Item -LiteralPath (Join-Path $root.Path "NovaSVN.$($item.Key)") -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath (Join-Path $root.Path "NovaSVN.Checkout") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $root.Path "NovaSVN.CheckoutOnly") -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $menuPath -Recurse -Force -ErrorAction SilentlyContinue
  if ($Mode -eq "Uninstall") {
    continue
  }

  $submenuPath = Join-Path $menuPath "shell"
  New-LiteralRegistryKey $submenuPath
  New-ItemProperty -LiteralPath $menuPath -Name "MUIVerb" -Value "NovaSVN" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "Icon" -Value $NovaSvnExe -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "SubCommands" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "Position" -Value "Bottom" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "SeparatorBefore" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "SeparatorAfter" -Value "" -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $menuPath -Name "CommandStateHandler" -Value $stateHandlers.RootMenu -PropertyType String -Force | Out-Null
  if ($root.Background -eq $true) {
    New-ItemProperty -LiteralPath $menuPath -Name "ImpliedSelectionModel" -Value 1 -PropertyType DWord -Force | Out-Null
  }

  $submenuIndex = 1
  foreach ($item in $submenuActions) {
    if ($item.FilesOnly -eq $true -and $root.Path -ne "HKCU:\Software\Classes\*\shell") {
      continue
    }
    $keyPath = Join-Path $submenuPath ("{0:D2}.$($item.Key)" -f $submenuIndex)
    $submenuIndex += 1
    $commandPath = Join-Path $keyPath "command"
    New-LiteralRegistryKey $commandPath
    New-ItemProperty -LiteralPath $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    New-ItemProperty -LiteralPath $keyPath -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "CommandStateHandler" -Value $stateHandlers.SvnOnly -PropertyType String -Force | Out-Null
    if ($root.Background -eq $true) {
      New-ItemProperty -LiteralPath $keyPath -Name "ImpliedSelectionModel" -Value 1 -PropertyType DWord -Force | Out-Null
    }
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$($root.Placeholder)`""
    Set-Item -LiteralPath $commandPath -Value $command
  }

  if ($root.SupportsCheckout -eq $true) {
    $keyPath = Join-Path $root.Path "NovaSVN.$($checkoutAction.Key)"
    $commandPath = Join-Path $keyPath "command"
    New-LiteralRegistryKey $commandPath
    New-ItemProperty -LiteralPath $keyPath -Name "MUIVerb" -Value $checkoutAction.Label -PropertyType String -Force | Out-Null
    $iconPath = Join-Path $explorerIconRoot "$($checkoutAction.Action).ico"
    New-ItemProperty -LiteralPath $keyPath -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "Position" -Value "Bottom" -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "SeparatorBefore" -Value "" -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "SeparatorAfter" -Value "" -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "CommandStateHandler" -Value $stateHandlers.Checkout -PropertyType String -Force | Out-Null
    if ($root.Background -eq $true) {
      New-ItemProperty -LiteralPath $keyPath -Name "ImpliedSelectionModel" -Value 1 -PropertyType DWord -Force | Out-Null
    }
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($checkoutAction.Action)`" --novasvn-path `"$($root.Placeholder)`""
    Set-Item -LiteralPath $commandPath -Value $command
  }

  foreach ($item in $directActions) {
    if ($item.FilesOnly -eq $true -and $root.Path -ne "HKCU:\Software\Classes\*\shell") {
      continue
    }
    $keyPath = Join-Path $root.Path "NovaSVN.$($item.Key)"
    $commandPath = Join-Path $keyPath "command"
    New-LiteralRegistryKey $commandPath
    New-ItemProperty -LiteralPath $keyPath -Name "MUIVerb" -Value $item.Label -PropertyType String -Force | Out-Null
    $iconPath = Join-Path $explorerIconRoot "$($item.Action).ico"
    New-ItemProperty -LiteralPath $keyPath -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "Position" -Value "Bottom" -PropertyType String -Force | Out-Null
    New-ItemProperty -LiteralPath $keyPath -Name "CommandStateHandler" -Value $stateHandlers.SvnOnly -PropertyType String -Force | Out-Null
    if ($root.Background -eq $true) {
      New-ItemProperty -LiteralPath $keyPath -Name "ImpliedSelectionModel" -Value 1 -PropertyType DWord -Force | Out-Null
    }
    $command = "`"$NovaSvnExe`" --novasvn-action `"$($item.Action)`" --novasvn-path `"$($root.Placeholder)`""
    Set-Item -LiteralPath $commandPath -Value $command
  }
}

Write-Host "NovaSVN Explorer menu $Mode complete."
