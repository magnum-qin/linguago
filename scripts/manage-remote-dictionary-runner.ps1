param(
  [ValidateSet('start', 'run', 'status', 'stop')]
  [string]$Action = 'status',
  [string]$Batch = 'batches\v97-20c.json',
  [string]$RunId = 'v97-20c-fixed-contract',
  [int]$GenerationTarget = 20,
  [string]$SupplementalSourceDb = '',
  [string]$SourceRunDir = '',
  [string]$QwenEndpoints = 'http://127.0.0.1:11441,http://127.0.0.1:11448,http://127.0.0.1:11447',
  [string]$QwenVariants = '11441=UD-Q4_K_XL,11448=UD-IQ4_NL,11447=UD-IQ4_NL',
  [string]$GemmaEndpoints = 'http://127.0.0.1:11442,http://127.0.0.1:11445,http://127.0.0.1:11446',
  [string]$GemmaVariants = '11442=UD-Q4_K_XL,11445=UD-Q4_K_XL,11446=UD-Q4_K_XL',
  [string]$ElasticEndpoints = 'http://127.0.0.1:11442,http://127.0.0.1:11445',
  [string]$ElasticQwenVariants = '11442=UD-Q4_K_XL,11445=UD-Q4_K_XL',
  [int]$ElasticMinimumItems = 20,
  [bool]$ElasticModelSwap = $true
)

$ErrorActionPreference = 'Stop'
$Root = 'D:\linguago-runner'
$RunDir = Join-Path $Root (Join-Path 'runs' $RunId)
$ControllerPath = Join-Path $RunDir 'controller.json'
$ManifestPath = Join-Path $RunDir 'manifest.json'

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Get-RunnerProcess {
  $Controller = Read-JsonFile $ControllerPath
  if (-not $Controller -or -not $Controller.pid) { return $null }
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Controller.pid)" -ErrorAction SilentlyContinue
  if (-not $Process) { return $null }
  $CommandLine = [string]$Process.CommandLine
  if (
    $CommandLine -notlike '*run-dictionary-v2-remote-pipeline.mjs*' -or
    $CommandLine -notlike "*$RunId*"
  ) { return $null }
  return Get-Process -Id $Controller.pid -ErrorAction SilentlyContinue
}

if ($Action -eq 'status') {
  $Process = Get-RunnerProcess
  $Manifest = Read-JsonFile $ManifestPath
  [pscustomobject]@{
    RunId = $RunId
    Running = $null -ne $Process
    Pid = if ($Process) { $Process.Id } else { $null }
    ManifestStatus = if ($Manifest) { $Manifest.status } else { 'not_started' }
    CurrentStages = if ($Manifest) { $Manifest.stages } else { $null }
    Summary = if ($Manifest) { $Manifest.summary } else { $null }
  } | ConvertTo-Json -Depth 8
  exit 0
}

if ($Action -eq 'stop') {
  $Process = Get-RunnerProcess
  if ($Process) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
    Write-Output "stopped pid=$($Process.Id)"
  } else {
    Write-Output 'not running'
  }
  exit 0
}

if (Get-RunnerProcess) { throw "Runner $RunId is already running" }
$Key = [Environment]::GetEnvironmentVariable('UNSLOTH_API_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($Key)) { throw 'User UNSLOTH_API_KEY is missing' }
$env:UNSLOTH_API_KEY = $Key

$BatchPath = [IO.Path]::GetFullPath((Join-Path $Root $Batch))
if (-not $BatchPath.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Batch path must stay under D:\linguago-runner'
}
if (-not (Test-Path -LiteralPath $BatchPath)) { throw "Batch not found: $BatchPath" }

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
$Stdout = Join-Path $RunDir 'controller.stdout.log'
$Stderr = Join-Path $RunDir 'controller.stderr.log'
$Arguments = @(
  'scripts\run-dictionary-v2-remote-pipeline.mjs',
  '--batch', $BatchPath,
  '--run-id', $RunId,
  '--run-dir', $RunDir,
  '--resume', 'true',
  '--generation-target', $GenerationTarget,
  '--qwen-endpoints', $QwenEndpoints,
  '--qwen-variants', $QwenVariants,
  '--gemma-endpoints', $GemmaEndpoints,
  '--gemma-variants', $GemmaVariants,
  '--elastic-endpoints', $ElasticEndpoints,
  '--elastic-qwen-variants', $ElasticQwenVariants,
  '--elastic-minimum-items', $ElasticMinimumItems,
  '--elastic-model-swap', $ElasticModelSwap.ToString().ToLowerInvariant()
)
if (-not [string]::IsNullOrWhiteSpace($SourceRunDir)) {
  $ResolvedSourceRunDir = [IO.Path]::GetFullPath((Join-Path $Root $SourceRunDir))
  if (-not $ResolvedSourceRunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Source run path must stay under D:\linguago-runner'
  }
  $Arguments += @('--source-run-dir', $ResolvedSourceRunDir)
}
if (-not [string]::IsNullOrWhiteSpace($SupplementalSourceDb)) {
  $ResolvedSupplementalSourceDb = [IO.Path]::GetFullPath((Join-Path $Root $SupplementalSourceDb))
  if (-not $ResolvedSupplementalSourceDb.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Supplemental source DB path must stay under D:\linguago-runner'
  }
  if (-not (Test-Path -LiteralPath $ResolvedSupplementalSourceDb)) {
    throw "Supplemental source DB not found: $ResolvedSupplementalSourceDb"
  }
  $Arguments += @('--supplemental-source-db', $ResolvedSupplementalSourceDb)
}
if ($Action -eq 'run') {
  @{
    pid = $PID
    run_id = $RunId
    batch = $BatchPath
    mode = 'foreground'
    started_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $ControllerPath -Encoding UTF8
  try {
    Set-Location -LiteralPath $Root
    & node.exe @Arguments
    exit $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $ControllerPath -Force -ErrorAction SilentlyContinue
  }
}
$Process = Start-Process -FilePath 'node.exe' -ArgumentList $Arguments -WorkingDirectory $Root `
  -WindowStyle Hidden -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru
@{
  pid = $Process.Id
  run_id = $RunId
  batch = $BatchPath
  started_at = [DateTime]::UtcNow.ToString('o')
  stdout = $Stdout
  stderr = $Stderr
} | ConvertTo-Json | Set-Content -LiteralPath $ControllerPath -Encoding UTF8
Write-Output "started pid=$($Process.Id) run_id=$RunId"
