param(
  [string]$Root = ".test-svn\partial-commit",
  [string]$SvnExe = "svn",
  [string]$SvnAdminExe = "svnadmin",
  [switch]$Keep
)

$ErrorActionPreference = "Stop"

$rootPath = Join-Path (Resolve-Path -LiteralPath ".") $Root
$repoPath = Join-Path $rootPath "repo"
$wcPath = Join-Path $rootPath "wc"
$shadowPath = Join-Path $rootPath "shadow"
$verifyPath = Join-Path $rootPath "verify"
$patchPath = Join-Path $rootPath "selected.patch"

function Invoke-Svn {
  param([string[]]$Arguments)

  $output = & $SvnExe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "svn $($Arguments -join ' ') failed: $output"
  }

  $output
}

function Assert-Contains {
  param(
    [string]$Text,
    [string]$Expected,
    [string]$Message
  )

  if (!$Text.Contains($Expected)) {
    throw "$Message. Expected to find: $Expected"
  }
}

function Assert-NotContains {
  param(
    [string]$Text,
    [string]$Unexpected,
    [string]$Message
  )

  if ($Text.Contains($Unexpected)) {
    throw "$Message. Unexpected content: $Unexpected"
  }
}

if (Test-Path -LiteralPath $rootPath) {
  Remove-Item -LiteralPath $rootPath -Recurse -Force
}
New-Item -ItemType Directory -Path $rootPath -Force | Out-Null

try {
  & $SvnAdminExe create $repoPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "svnadmin create failed"
  }

  $repoUrl = "file:///$($repoPath.Replace('\', '/'))"
  Invoke-Svn @("checkout", $repoUrl, $wcPath) | Out-Null
  Invoke-Svn @("checkout", $repoUrl, $shadowPath) | Out-Null

  $srcDir = Join-Path $wcPath "src"
  New-Item -ItemType Directory -Path $srcDir -Force | Out-Null
  $filePath = Join-Path $srcDir "partial.txt"
  $baseline = 1..30 | ForEach-Object { "line {0:D2}" -f $_ }
  Set-Content -LiteralPath $filePath -Value $baseline -Encoding UTF8
  Invoke-Svn @("add", $srcDir) | Out-Null
  Invoke-Svn @("commit", $wcPath, "-m", "初始化部分提交测试仓库") | Out-Null
  Invoke-Svn @("update", $shadowPath) | Out-Null
  $baseRevision = ((Invoke-Svn @("info", "--show-item", "revision", $wcPath)) -join "").Trim()

  $workingLines = Get-Content -LiteralPath $filePath
  $workingLines[2] = "line 03 selected"
  $workingLines[23] = "line 24 unselected"
  Set-Content -LiteralPath $filePath -Value $workingLines -Encoding UTF8

  $selectedPatch = @(
    "Index: src/partial.txt",
    "===================================================================",
    "--- src/partial.txt`t(revision $baseRevision)",
    "+++ src/partial.txt`t(working copy)",
    "@@ -1,6 +1,6 @@",
    " line 01",
    " line 02",
    "-line 03",
    "+line 03 selected",
    " line 04",
    " line 05",
    " line 06"
  )
  Set-Content -LiteralPath $patchPath -Value $selectedPatch -Encoding UTF8

  Invoke-Svn @("patch", $patchPath, $shadowPath) | Out-Null
  $shadowFile = Join-Path $shadowPath "src\partial.txt"
  $shadowContent = (Get-Content -LiteralPath $shadowFile) -join "`n"
  Assert-Contains $shadowContent "line 03 selected" "影子工作副本未应用选中 hunk"
  Assert-NotContains $shadowContent "line 24 unselected" "影子工作副本错误包含未选中 hunk"

  Invoke-Svn @("commit", $shadowFile, "-m", "验证Hunk级部分提交") | Out-Null
  Invoke-Svn @("checkout", $repoUrl, $verifyPath) | Out-Null
  $verifyContent = (Get-Content -LiteralPath (Join-Path $verifyPath "src\partial.txt")) -join "`n"
  Assert-Contains $verifyContent "line 03 selected" "仓库未提交选中 hunk"
  Assert-NotContains $verifyContent "line 24 unselected" "仓库错误提交未选中 hunk"

  $realContent = (Get-Content -LiteralPath $filePath) -join "`n"
  Assert-Contains $realContent "line 03 selected" "真实工作副本丢失选中改动"
  Assert-Contains $realContent "line 24 unselected" "真实工作副本丢失未选中改动"

  Write-Host "NovaSVN partial commit workflow test complete: $wcPath"
} finally {
  if (!$Keep -and (Test-Path -LiteralPath $rootPath)) {
    Remove-Item -LiteralPath $rootPath -Recurse -Force
  }
}
