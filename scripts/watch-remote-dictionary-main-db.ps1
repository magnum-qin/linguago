param(
  [string]$Root = 'D:\linguago-runner',
  [int]$IntervalMinutes = 10,
  [ValidateSet('install', 'once', 'status', 'remove')]
  [string]$Action = 'once'
)

$ErrorActionPreference = 'Stop'
$TaskName = 'LinguaGo Runner Main DB Custodian'
$MainDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$TrailPath = Join-Path $Root 'state\main-db-audit-trail.jsonl'

function Get-LastTrailEntry([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $last = $null
  foreach ($line in [IO.File]::ReadLines($Path)) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { $last = $line }
  }
  if ($null -eq $last) { return $null }
  try { return $last | ConvertFrom-Json } catch { return $null }
}

function Get-ChangeAttribution {
  $pipelineLock = Test-Path (Join-Path $Root 'state\remote-pipeline.lock.json')
  $releaseLock = Test-Path (Join-Path $Root 'state\dictionary-release.lock.json')
  $lockRunId = $null
  foreach ($lockName in @('remote-pipeline.lock.json', 'dictionary-release.lock.json')) {
    $lockPath = Join-Path $Root "state\$lockName"
    if (Test-Path -LiteralPath $lockPath) {
      try { $lockRunId = (Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json).run_id } catch {}
    }
  }
  $recentRuns = @()
  if (Test-Path (Join-Path $Root 'runs')) {
    $recentRuns = @(Get-ChildItem (Join-Path $Root 'runs') -Directory |
      Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
      ForEach-Object { '{0}@{1:u}' -f $_.Name, $_.LastWriteTime })
  }
  $recentBackups = @()
  if (Test-Path (Join-Path $Root 'backups')) {
    $recentBackups = @(Get-ChildItem (Join-Path $Root 'backups') -File -Filter '*.db' |
      Sort-Object LastWriteTime -Descending | Select-Object -First 3 |
      ForEach-Object { '{0}@{1:u}' -f $_.Name, $_.LastWriteTime })
  }
  $cutoff = [DateTime]::UtcNow.AddMinutes(-2 * $IntervalMinutes).ToLocalTime()
  $runActiveRecently = (@($recentRuns) | Where-Object { $_ -match '@(.+)$' -and ([DateTime]$Matches[1]) -gt $cutoff }).Count -gt 0
  [pscustomobject]@{
    pipeline_lock = $pipelineLock
    release_lock = $releaseLock
    lock_run_id = $lockRunId
    run_active_within_window = $runActiveRecently
    recent_runs = $recentRuns
    recent_backups = $recentBackups
    classification = if ($lockRunId) { 'locked_operation' }
      elseif ($runActiveRecently) { 'pipeline_run_activity' }
      elseif ((@($recentBackups) | Where-Object { $_ -match '@(.+)$' -and ([DateTime]$Matches[1]) -gt $cutoff }).Count -gt 0) { 'backup_taken_no_lock' }
      else { 'UNATTRIBUTED_CHANGE' }
  }
}

if ($Action -eq 'remove') {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  "removed task=$TaskName"
  exit 0
}

if ($Action -eq 'status') {
  if (-not (Test-Path -LiteralPath $TrailPath)) { 'no trail yet'; exit 0 }
  Get-Content -LiteralPath $TrailPath -Tail 5
  exit 0
}

if ($Action -eq 'install') {
  $ScriptPath = Join-Path $Root 'scripts\watch-remote-dictionary-main-db.ps1'
  if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Custodian script not found: $ScriptPath" }
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Action once -Root `"$Root`" -IntervalMinutes $IntervalMinutes"
  $TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments -WorkingDirectory $Root
  $TaskTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
  $TaskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Settings $TaskSettings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  [pscustomobject]@{ ok = $true; action = 'installed'; task = $TaskName; interval_minutes = $IntervalMinutes; trail = $TrailPath } | ConvertTo-Json
  exit 0
}

if (-not (Test-Path -LiteralPath $MainDb)) { throw "Main DB not found: $MainDb" }
$item = Get-Item -LiteralPath $MainDb
$hash = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash
$previous = Get-LastTrailEntry $TrailPath
$entry = [ordered]@{
  recorded_at = [DateTime]::UtcNow.ToString('o')
  event = if ($previous -and $previous.sha256 -ne $hash) { 'CHANGE' } else { 'heartbeat' }
  sha256 = $hash
  bytes = $item.Length
  last_write_utc = $item.LastWriteTimeUtc.ToString('o')
}
if ($entry.event -eq 'CHANGE') {
  $entry.previous_sha256 = $previous.sha256
  $entry.previous_recorded_at = $previous.recorded_at
  $entry.attribution = Get-ChangeAttribution
}
$line = $entry | ConvertTo-Json -Depth 5 -Compress
[System.IO.File]::AppendAllText($TrailPath, $line + "`n", (New-Object System.Text.UTF8Encoding($false)))
$line
