param(
  [string]$Root = 'D:\linguago-runner',
  [string]$RunId,
  [switch]$UseAgy,
  [int]$AgyTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RunId)) { throw 'RunId is required' }

$RunDir = Join-Path $Root (Join-Path 'runs' $RunId)
$ManifestPath = Join-Path $RunDir 'manifest.json'
$SummaryPath = Join-Path $RunDir 'summary.json'
$ControllerPath = Join-Path $RunDir 'controller.json'

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return $null }
}

$Controller = Read-Json $ControllerPath
$Manifest = Read-Json $ManifestPath
$Summary = Read-Json $SummaryPath
$Process = if ($Controller -and $Controller.pid) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$($Controller.pid)" -ErrorAction SilentlyContinue
} else { $null }
if (-not $Process) {
  $Process = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*run-dictionary-v2-remote-pipeline.mjs*' -and
      $_.CommandLine -like "*$RunId*"
    } |
    Select-Object -First 1
}
$Errors = @()
foreach ($Log in Get-ChildItem -LiteralPath $RunDir -Filter '*.log' -File -ErrorAction SilentlyContinue) {
  $Tail = Get-Content -LiteralPath $Log.FullName -Tail 80 -ErrorAction SilentlyContinue
  $Matches = @($Tail | Where-Object { $_ -match '(?i)error|failed|timeout|fetch failed|no model loaded|out of memory' })
  if ($Matches.Count) {
    $Errors += [pscustomobject]@{ log = $Log.Name; lines = @($Matches | Select-Object -Last 5) }
  }
}

$Status = [ordered]@{
  run_id = $RunId
  observed_at = [DateTime]::UtcNow.ToString('o')
  running = $null -ne $Process
  pid = if ($Process) { $Process.ProcessId } else { $null }
  manifest_status = if ($Manifest) { $Manifest.status } else { 'not_started' }
  stages = if ($Manifest) { $Manifest.stages } else { $null }
  summary = if ($Summary) { $Summary.summary } elseif ($Manifest) { $Manifest.summary } else { $null }
  recent_errors = $Errors
}
$StatusJson = $Status | ConvertTo-Json -Depth 12
$StatusJson

if (-not $UseAgy) { exit 0 }
if (-not (Get-Command agy -ErrorAction SilentlyContinue)) {
  Write-Warning 'agy is not installed; deterministic status was emitted only.'
  exit 0
}

$Prompt = @"
You are a read-only supervisor for a dictionary generation pipeline.
Do not run commands, edit files, restart processes, or publish data.
Classify the supplied status as healthy, attention, or failed. Return concise JSON with
status, reasons, and recommended_operator_action. Treat a non-running process with a
complete manifest as healthy. Never include secrets.

$StatusJson
"@
& agy --print $Prompt --output-format json --print-timeout "${AgyTimeoutSeconds}s" --mode plan --sandbox
if ($LASTEXITCODE -ne 0) {
  Write-Warning "agy supervision failed with exit code $LASTEXITCODE; deterministic status remains authoritative."
}
