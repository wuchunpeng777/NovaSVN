param(
  [string]$Root = ".test-svn\workflow",
  [string]$SvnExe = "svn",
  [string]$SvnAdminExe = "svnadmin",
  [switch]$Keep
)

$ErrorActionPreference = "Stop"

$rootPath = Join-Path (Resolve-Path -LiteralPath ".") $Root
$repoPath = Join-Path $rootPath "repo"
$wcPath = Join-Path $rootPath "wc"
$conflictWcPath = Join-Path $rootPath "wc-conflict"

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

if (Test-Path -LiteralPath $rootPath) {
  Remove-Item -LiteralPath $rootPath -Recurse -Force
}
New-Item -ItemType Directory -Path $rootPath -Force | Out-Null

try {
  & $SvnAdminExe create $repoPath | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "svnadmin create failed"
  }

  Invoke-Svn @("checkout", "file:///$($repoPath.Replace('\', '/'))", $wcPath) | Out-Null

  $srcDir = Join-Path $wcPath "src"
  New-Item -ItemType Directory -Path $srcDir -Force | Out-Null
  Set-Content -LiteralPath (Join-Path $srcDir "main.txt") -Value "line 1" -Encoding UTF8
  Set-Content -LiteralPath (Join-Path $srcDir "delete-me.txt") -Value "remove" -Encoding UTF8
  Invoke-Svn @("add", $srcDir) | Out-Null
  Invoke-Svn @("commit", $wcPath, "-m", "初始化SVN流程测试仓库") | Out-Null

  Add-Content -LiteralPath (Join-Path $srcDir "main.txt") -Value "line 2"
  Set-Content -LiteralPath (Join-Path $srcDir "added.txt") -Value "added" -Encoding UTF8
  Invoke-Svn @("add", (Join-Path $srcDir "added.txt")) | Out-Null
  Invoke-Svn @("delete", (Join-Path $srcDir "delete-me.txt")) | Out-Null
  Set-Content -LiteralPath (Join-Path $srcDir "unversioned.tmp") -Value "temp" -Encoding UTF8

  $statusXml = (Invoke-Svn @("status", "--xml", $wcPath)) -join "`n"
  Assert-Contains $statusXml 'item="modified"' "modified 状态未出现"
  Assert-Contains $statusXml 'item="added"' "added 状态未出现"
  Assert-Contains $statusXml 'item="deleted"' "deleted 状态未出现"
  Assert-Contains $statusXml 'item="unversioned"' "unversioned 状态未出现"

  $missingPath = Join-Path $srcDir "main.txt"
  Remove-Item -LiteralPath $missingPath -Force
  $missingXml = (Invoke-Svn @("status", "--xml", $wcPath)) -join "`n"
  Assert-Contains $missingXml 'item="missing"' "missing 状态未出现"

  Invoke-Svn @("revert", $missingPath) | Out-Null
  Invoke-Svn @("commit", (Join-Path $srcDir "added.txt"), (Join-Path $srcDir "delete-me.txt"), "-m", "验证文件级提交") | Out-Null

  Add-Content -LiteralPath $missingPath -Value "line 3"
  $diff = (Invoke-Svn @("diff", $missingPath)) -join "`n"
  Assert-Contains $diff "+line 3" "diff 未包含新增行"

  $log = (Invoke-Svn @("log", "--xml", "--limit", "2", $wcPath)) -join "`n"
  Assert-Contains $log "<logentry" "log XML 未包含 revision"

  Invoke-Svn @("revert", $missingPath) | Out-Null
  Invoke-Svn @("checkout", "file:///$($repoPath.Replace('\', '/'))", $conflictWcPath) | Out-Null
  $primaryConflictFile = Join-Path $srcDir "main.txt"
  $secondaryConflictFile = Join-Path $conflictWcPath "src\main.txt"
  Set-Content -LiteralPath $primaryConflictFile -Value @("line 1", "remote conflict") -Encoding UTF8
  Invoke-Svn @("commit", $primaryConflictFile, "-m", "制造远端冲突变更") | Out-Null
  Set-Content -LiteralPath $secondaryConflictFile -Value @("line 1", "local conflict") -Encoding UTF8
  & $SvnExe update $conflictWcPath | Out-Null
  $conflictStatusXml = (Invoke-Svn @("status", "--xml", $conflictWcPath)) -join "`n"
  Assert-Contains $conflictStatusXml 'item="conflicted"' "conflict 状态未出现"
  Invoke-Svn @("revert", "-R", $conflictWcPath) | Out-Null

  Write-Host "NovaSVN SVN workflow test complete: $wcPath"
} finally {
  if (!$Keep -and (Test-Path -LiteralPath $rootPath)) {
    Remove-Item -LiteralPath $rootPath -Recurse -Force
  }
}
