$ErrorActionPreference = 'Stop'
$Root = Join-Path (Resolve-Path (Join-Path $PSScriptRoot '..')).Path '.tmp\watchdog-test'
$Script = Join-Path $PSScriptRoot 'manage-remote-dictionary-watchdog.ps1'
Remove-Item -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path (Join-Path $Root 'state') -Force | Out-Null

function Write-Utf8Json([string]$Path, [object]$Value) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
}

$CompleteRun = 'complete-fixture'
$CompleteDir = Join-Path $Root "runs\$CompleteRun"
Write-Utf8Json (Join-Path $CompleteDir 'manifest.json') @{ status = 'complete'; stages = @{} }
& $Script -Action once -Root $Root -RunId $CompleteRun -NoRecovery | Out-Null
$Complete = Get-Content (Join-Path $Root 'state\dictionary-watchdog.json') -Raw | ConvertFrom-Json
if ($Complete.status -ne 'complete' -or $Complete.recovery -ne 'not_needed') { throw 'Complete fixture classification failed' }

$StalledRun = 'stalled-fixture'
$StalledDir = Join-Path $Root "runs\$StalledRun"
$Old = [DateTime]::UtcNow.AddMinutes(-30).ToString('o')
Write-Utf8Json (Join-Path $StalledDir 'manifest.json') @{
  status = 'running'
  stages = @{ review = @{ status = 'running'; started_at = $Old; log = "runs\$StalledRun\review.log"; args = @() } }
}
Write-Utf8Json (Join-Path $StalledDir 'launch.json') @{ Action = 'run'; RunId = $StalledRun; Batch = 'batches\fixture.json' }
[IO.File]::WriteAllText((Join-Path $StalledDir 'review.log'), '[1/10] fixture', [Text.UTF8Encoding]::new($false))
(Get-Item (Join-Path $StalledDir 'review.log')).LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(-30)
& $Script -Action once -Root $Root -RunId $StalledRun -StallMinutes 5 -NoRecovery | Out-Null
$Stalled = Get-Content (Join-Path $Root 'state\dictionary-watchdog.json') -Raw | ConvertFrom-Json
if ($Stalled.status -ne 'stalled' -or $Stalled.reason -ne 'runner_missing' -or $Stalled.recovery -ne 'disabled') {
  throw 'Stalled fixture classification failed'
}
if ($Stalled.progress.completed -ne 1 -or $Stalled.progress.total -ne 10) { throw 'Progress parsing failed' }

# A failed restart may remove the global lock before the next watchdog pass.
# The watchdog must continue tracking the still-running manifest from its last
# restart event instead of becoming idle.
Write-Utf8Json (Join-Path $Root 'state\dictionary-watchdog.json') @{
  observed_at = [DateTime]::UtcNow.AddMinutes(-1).ToString('o')
  status = 'idle'
  run_id = $null
  restart_events = @(@{ at = [DateTime]::UtcNow.AddMinutes(-1).ToString('o'); run_id = $StalledRun; reason = 'runner_missing' })
}
& $Script -Action once -Root $Root -StallMinutes 5 -NoRecovery | Out-Null
$RecoveredIdentity = Get-Content (Join-Path $Root 'state\dictionary-watchdog.json') -Raw | ConvertFrom-Json
if ($RecoveredIdentity.run_id -ne $StalledRun -or $RecoveredIdentity.status -ne 'stalled') {
  throw 'Run identity fallback after failed restart failed'
}

Write-Output 'remote dictionary watchdog tests passed'
