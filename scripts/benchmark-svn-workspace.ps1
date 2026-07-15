param(
  [string]$Root = ".benchmark\svn-large",
  [int]$FileCount = 50000,
  [int]$ChangedCount = 5000,
  [int]$HistoryCount = 200,
  [string]$SvnExe = "svn",
  [string]$SvnAdminExe = "svnadmin",
  [switch]$Reset,
  [switch]$Quick
)

$ErrorActionPreference = "Stop"
if ($Quick -and !$PSBoundParameters.ContainsKey("Root")) {
  $Root = ".benchmark\svn-quick"
}
$cargoArguments = @(
  "run",
  "--manifest-path", "src-tauri/Cargo.toml",
  "--example", "performance_benchmark",
  "--",
  "--root", $Root,
  "--file-count", $FileCount,
  "--changed-count", $ChangedCount,
  "--history-count", $HistoryCount,
  "--svn", $SvnExe,
  "--svnadmin", $SvnAdminExe
)
if ($Reset) {
  $cargoArguments += "--reset"
}
if ($Quick) {
  $cargoArguments += "--quick"
}

& cargo @cargoArguments
if ($LASTEXITCODE -ne 0) {
  throw "NovaSVN 性能基准失败，退出码：$LASTEXITCODE"
}
