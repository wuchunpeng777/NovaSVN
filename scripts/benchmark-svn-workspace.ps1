param(
  [string]$Root = ".benchmark\svn-large",
  [int]$FileCount = 50000,
  [int]$ChangedCount = 5000,
  [string]$SvnExe = "svn",
  [string]$SvnAdminExe = "svnadmin"
)

$ErrorActionPreference = "Stop"
$rootPath = Resolve-Path -LiteralPath "." | ForEach-Object { Join-Path $_ $Root }
$repoPath = Join-Path $rootPath "repo"
$wcPath = Join-Path $rootPath "wc"
$resultPath = Join-Path $rootPath "benchmark-results.json"

function Measure-Step {
  param(
    [string]$Name,
    [scriptblock]$Script
  )

  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  & $Script
  $watch.Stop()
  [pscustomobject]@{
    name = $Name
    elapsed_ms = $watch.ElapsedMilliseconds
  }
}

New-Item -ItemType Directory -Path $rootPath -Force | Out-Null
if (!(Test-Path -LiteralPath $repoPath)) {
  & $SvnAdminExe create $repoPath
}
if (!(Test-Path -LiteralPath $wcPath)) {
  & $SvnExe checkout "file:///$($repoPath.Replace('\', '/'))" $wcPath | Out-Null
}

$dataDir = Join-Path $wcPath "Assets\Benchmark"
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null

$existing = Get-ChildItem -LiteralPath $dataDir -Filter "*.txt" -ErrorAction SilentlyContinue
if ($existing.Count -lt $FileCount) {
  for ($i = $existing.Count; $i -lt $FileCount; $i++) {
    $file = Join-Path $dataDir ("file-{0:D5}.txt" -f $i)
    Set-Content -LiteralPath $file -Value "baseline $i" -Encoding UTF8
  }
  & $SvnExe add $dataDir --force | Out-Null
  & $SvnExe commit $wcPath -m "初始化性能基准数据" | Out-Null
}

for ($i = 0; $i -lt [Math]::Min($ChangedCount, $FileCount); $i++) {
  $file = Join-Path $dataDir ("file-{0:D5}.txt" -f $i)
  Add-Content -LiteralPath $file -Value "changed $([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
}

$results = @()
$results += Measure-Step "svn status --xml" { & $SvnExe status --xml $wcPath | Out-Null }
$results += Measure-Step "svn diff first file" {
  & $SvnExe diff (Join-Path $dataDir "file-00000.txt") | Out-Null
}
$results += Measure-Step "svn diff working copy" { & $SvnExe diff $wcPath | Out-Null }

$payload = [pscustomobject]@{
  created_at = (Get-Date).ToString("o")
  file_count = $FileCount
  changed_count = $ChangedCount
  working_copy = $wcPath
  results = $results
}

$payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
Write-Host "Benchmark results written to $resultPath"
