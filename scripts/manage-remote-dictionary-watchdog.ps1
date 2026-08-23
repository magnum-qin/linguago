param(
  [ValidateSet('once', 'install', 'uninstall', 'status')]
  [string]$Action = 'once',
  [string]$Root = 'D:\linguago-runner',
  [string]$RunId = '',
  [int]$StallMinutes = 10,
  [int]$PollMinutes = 2,
  [int]$RestartCooldownMinutes = 10,
  [int]$MaxRestartsPerHour = 3,
  [switch]$NoRecovery
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$StateDir = Join-Path $Root 'state'
$StatusPath = Join-Path $StateDir 'dictionary-watchdog.json'
$LockPath = Join-Path $StateDir 'dictionary-watchdog.lock'
$TaskName = 'LinguaGo Dictionary Pipeline Watchdog'

if ($StallMinutes -lt 2) { throw 'StallMinutes must be at least 2' }
if ($PollMinutes -lt 1) { throw 'PollMinutes must be at least 1' }
if ($RestartCooldownMinutes -lt 1) { throw 'RestartCooldownMinutes must be at least 1' }
if ($MaxRestartsPerHour -lt 1) { throw 'MaxRestartsPerHour must be at least 1' }

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { return $null }
}

function Write-JsonAtomic([string]$Path, [object]$Value) {
  $Parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $Parent -Force | Out-Null
  $Temp = Join-Path $Parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
  [IO.File]::WriteAllText($Temp, ($Value | ConvertTo-Json -Depth 14), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $Temp -Destination $Path -Force
}

function Resolve-RunId([object]$PreviousStatus) {
  if (-not [string]::IsNullOrWhiteSpace($RunId)) { return $RunId }
  foreach ($Path in @(
    (Join-Path $StateDir 'remote-pipeline.lock.json'),
    (Join-Path $StateDir 'remote-pipeline-controller.json')
  )) {
    $State = Read-Json $Path
    if ($State -and -not [string]::IsNullOrWhiteSpace([string]$State.run_id)) {
      return [string]$State.run_id
    }
  }
  if ($PreviousStatus -and -not [string]::IsNullOrWhiteSpace([string]$PreviousStatus.run_id)) {
    $PreviousManifest = Read-Json (Join-Path $Root (Join-Path 'runs' (Join-Path ([string]$PreviousStatus.run_id) 'manifest.json')))
    if ($PreviousManifest -and [string]$PreviousManifest.status -eq 'running') {
      return [string]$PreviousStatus.run_id
    }
  }
  $LastRestart = @($PreviousStatus.restart_events) | Select-Object -Last 1
  if ($LastRestart -and -not [string]::IsNullOrWhiteSpace([string]$LastRestart.run_id)) {
    $RestartManifest = Read-Json (Join-Path $Root (Join-Path 'runs' (Join-Path ([string]$LastRestart.run_id) 'manifest.json')))
    if ($RestartManifest -and [string]$RestartManifest.status -eq 'running') {
      return [string]$LastRestart.run_id
    }
  }
  return $null
}

function Get-RunnerProcess([string]$ResolvedRunId, [string]$RunDir) {
  $Controller = Read-Json (Join-Path $RunDir 'controller.json')
  if ($Controller -and $Controller.pid) {
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Controller.pid)" -ErrorAction SilentlyContinue
    if ($Process -and [string]$Process.CommandLine -like "*$ResolvedRunId*") { return $Process }
  }
  return Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*run-dictionary-v2-remote-pipeline.mjs*' -and
      $_.CommandLine -like "*$ResolvedRunId*"
    } |
    Select-Object -First 1
}

function Get-CurrentStage([object]$Manifest) {
  if (-not $Manifest -or -not $Manifest.stages) { return $null }
  foreach ($Property in $Manifest.stages.PSObject.Properties) {
    if ([string]$Property.Value.status -eq 'running') {
      return [pscustomobject]@{ name = $Property.Name; value = $Property.Value }
    }
  }
  return $null
}

function Resolve-ArtifactPath([string]$RunDir, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $Candidate = if ([IO.Path]::IsPathRooted($Value)) { $Value } else { Join-Path $Root $Value }
  try { $Candidate = [IO.Path]::GetFullPath($Candidate) } catch { return $null }
  if (-not $Candidate.StartsWith($RunDir, [StringComparison]::OrdinalIgnoreCase)) { return $null }
  return $Candidate
}

function Get-StageArtifacts([string]$RunDir, [object]$Stage) {
  $Paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $LogPath = Resolve-ArtifactPath $RunDir ([string]$Stage.log)
  if ($LogPath) { [void]$Paths.Add($LogPath) }
  $Args = @($Stage.args)
  $OutputKeys = @('--out', '--approved-out', '--rejected-out', '--checkpoint', '--report-out')
  for ($Index = 0; $Index -lt ($Args.Count - 1); $Index++) {
    if ([string]$Args[$Index] -notin $OutputKeys) { continue }
    $Path = Resolve-ArtifactPath $RunDir ([string]$Args[$Index + 1])
    if ($Path) { [void]$Paths.Add($Path) }
  }
  return @($Paths)
}

function Get-ProgressSnapshot([string]$RunDir, [object]$CurrentStage, [datetime]$NowUtc) {
  if (-not $CurrentStage) {
    return [pscustomobject]@{ last_progress_at = $null; age_seconds = $null; completed = $null; total = $null; artifacts = @() }
  }
  $Stage = $CurrentStage.value
  $StartedAt = if ($Stage.started_at) { ([datetime]$Stage.started_at).ToUniversalTime() } else { $NowUtc }
  $LastProgressAt = $StartedAt
  $ArtifactStates = @()
  $Completed = $null
  $Total = $null
  foreach ($Path in Get-StageArtifacts $RunDir $Stage) {
    if (-not (Test-Path -LiteralPath $Path)) { continue }
    $Item = Get-Item -LiteralPath $Path
    if ($Item.LastWriteTimeUtc -gt $LastProgressAt) { $LastProgressAt = $Item.LastWriteTimeUtc }
    $ArtifactStates += [pscustomobject]@{
      path = $Path.Substring($Root.Length).TrimStart('\')
      bytes = $Item.Length
      last_write_at = $Item.LastWriteTimeUtc.ToString('o')
    }
    if ($Item.Extension -eq '.log') {
      $Line = Get-Content -LiteralPath $Path -Tail 300 -ErrorAction SilentlyContinue |
        Where-Object { [string]$_ -match '^\[(\d+)/(\d+)\]' } |
        Select-Object -Last 1
      if ($Line -and [string]$Line -match '^\[(\d+)/(\d+)\]') {
        $Completed = [int]$Matches[1]
        $Total = [int]$Matches[2]
      }
    }
  }
  return [pscustomobject]@{
    last_progress_at = $LastProgressAt.ToString('o')
    age_seconds = [math]::Max(0, [math]::Round(($NowUtc - $LastProgressAt).TotalSeconds, 1))
    completed = $Completed
    total = $Total
    artifacts = $ArtifactStates
  }
}

function Get-EndpointUrls([object]$CurrentStage, [object]$Launch) {
  $Urls = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  if ($CurrentStage -and $CurrentStage.value.endpoint_discovery) {
    foreach ($Item in @($CurrentStage.value.endpoint_discovery.selected)) {
      if ($Item.endpoint) { [void]$Urls.Add([string]$Item.endpoint) }
    }
  }
  if ($Urls.Count -eq 0 -and $Launch) {
    foreach ($Name in @('QwenEndpoints', 'GemmaEndpoints', 'ElasticEndpoints')) {
      foreach ($Url in ([string]$Launch.$Name -split ',')) {
        if (-not [string]::IsNullOrWhiteSpace($Url)) { [void]$Urls.Add($Url.Trim()) }
      }
    }
  }
  return @($Urls)
}

function Test-Endpoints([string[]]$Urls) {
  $Results = @()
  foreach ($Url in $Urls) {
    try {
      $Timer = [Diagnostics.Stopwatch]::StartNew()
      $Response = Invoke-RestMethod -Uri ($Url.TrimEnd('/') + '/api/health') -TimeoutSec 8
      $Timer.Stop()
      $Results += [pscustomobject]@{ endpoint = $Url; healthy = $true; milliseconds = $Timer.ElapsedMilliseconds; status = $Response.status; error = $null }
    } catch {
      $Results += [pscustomobject]@{ endpoint = $Url; healthy = $false; milliseconds = $null; status = $null; error = $_.Exception.Message }
    }
  }
  return $Results
}

function Restart-FromLaunch([string]$ResolvedRunId, [string]$RunDir, [object]$Launch) {
  if (-not $Launch) { throw "Launch configuration missing for $ResolvedRunId" }
  $Manager = Join-Path $Root 'scripts\manage-remote-dictionary-runner.ps1'
  & $Manager -Action stop -RunId $ResolvedRunId | Out-Null
  Start-Sleep -Seconds 3
  $RunnerTaskName = 'Linguago Remote Dictionary Pipeline'
  $RunnerTask = Get-ScheduledTask -TaskName $RunnerTaskName -ErrorAction SilentlyContinue
  if (-not $RunnerTask) {
    throw "Runner scheduled task is missing: $RunnerTaskName"
  }
  Start-ScheduledTask -TaskName $RunnerTaskName
  $Deadline = [DateTime]::UtcNow.AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 500
    $StartedProcess = Get-RunnerProcess $ResolvedRunId $RunDir
    if ($StartedProcess) { return }
    $TaskInfo = Get-ScheduledTaskInfo -TaskName $RunnerTaskName -ErrorAction SilentlyContinue
    $TaskState = (Get-ScheduledTask -TaskName $RunnerTaskName -ErrorAction SilentlyContinue).State
    if ($TaskState -ne 'Running' -and $TaskInfo -and $TaskInfo.LastTaskResult -notin @(0, 267009) -and $TaskInfo.LastRunTime -gt [DateTime]::MinValue) {
      throw "Runner scheduled task failed with result $($TaskInfo.LastTaskResult)"
    }
  } while ([DateTime]::UtcNow -lt $Deadline)
  throw "Runner scheduled task did not create a process within 45 seconds"
}

if ($Action -eq 'install') {
  $ScriptPath = Join-Path $Root 'scripts\manage-remote-dictionary-watchdog.ps1'
  if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Watchdog script not found: $ScriptPath" }
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Action once -Root `"$Root`" -StallMinutes $StallMinutes -PollMinutes $PollMinutes -RestartCooldownMinutes $RestartCooldownMinutes -MaxRestartsPerHour $MaxRestartsPerHour"
  $TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments -WorkingDirectory $Root
  $TaskTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes $PollMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
  $TaskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
  Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Settings $TaskSettings -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  [pscustomobject]@{ ok = $true; action = 'installed'; task = $TaskName; poll_minutes = $PollMinutes; stall_minutes = $StallMinutes } | ConvertTo-Json
  exit 0
}

if ($Action -eq 'uninstall') {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  [pscustomobject]@{ ok = $true; action = 'uninstalled'; task = $TaskName } | ConvertTo-Json
  exit 0
}

if ($Action -eq 'status') {
  $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  [pscustomobject]@{ installed = $null -ne $Task; task_state = if ($Task) { [string]$Task.State } else { $null }; status = Read-Json $StatusPath } | ConvertTo-Json -Depth 14
  exit 0
}

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
$LockStream = $null
try {
  try { $LockStream = [IO.File]::Open($LockPath, 'OpenOrCreate', 'ReadWrite', 'None') } catch { exit 0 }
  $NowUtc = [DateTime]::UtcNow
  $Previous = Read-Json $StatusPath
  $RestartEvents = @($Previous.restart_events | Where-Object {
    try { ($NowUtc - ([datetime]$_.at).ToUniversalTime()).TotalHours -le 24 } catch { $false }
  })
  $ResolvedRunId = Resolve-RunId $Previous
  if ([string]::IsNullOrWhiteSpace($ResolvedRunId)) {
    $Status = [ordered]@{ observed_at = $NowUtc.ToString('o'); status = 'idle'; run_id = $null; restart_events = $RestartEvents }
    Write-JsonAtomic $StatusPath $Status
    $Status | ConvertTo-Json -Depth 14
    exit 0
  }

  $RunDir = Join-Path $Root (Join-Path 'runs' $ResolvedRunId)
  $Manifest = Read-Json (Join-Path $RunDir 'manifest.json')
  $Launch = Read-Json (Join-Path $RunDir 'launch.json')
  $Process = Get-RunnerProcess $ResolvedRunId $RunDir
  $CurrentStage = Get-CurrentStage $Manifest
  $Progress = Get-ProgressSnapshot $RunDir $CurrentStage $NowUtc
  $ManifestStatus = if ($Manifest) { [string]$Manifest.status } else { 'not_started' }
  $State = 'healthy'
  $Reason = 'progress_recent'
  if ($ManifestStatus -in @('complete', 'completed', 'succeeded')) { $State = 'complete'; $Reason = 'manifest_complete' }
  elseif ($ManifestStatus -in @('failed', 'error')) { $State = 'failed'; $Reason = 'manifest_failed' }
  elseif (-not $Process) { $State = 'stalled'; $Reason = 'runner_missing' }
  elseif (-not $CurrentStage) { $State = 'attention'; $Reason = 'no_running_stage' }
  elseif ($Progress.age_seconds -ge ($StallMinutes * 60)) { $State = 'stalled'; $Reason = 'progress_timeout' }

  $EndpointResults = @()
  $Recovery = 'not_needed'
  if ($State -eq 'stalled') {
    $EndpointResults = @(Test-Endpoints (Get-EndpointUrls $CurrentStage $Launch))
    $HealthyEndpoints = @($EndpointResults | Where-Object healthy).Count
    $RecentRestarts = @($RestartEvents | Where-Object { ($NowUtc - ([datetime]$_.at).ToUniversalTime()).TotalHours -le 1 })
    $LastRestart = $RestartEvents | Select-Object -Last 1
    $CooldownActive = $false
    if ($LastRestart) { $CooldownActive = ($NowUtc - ([datetime]$LastRestart.at).ToUniversalTime()).TotalMinutes -lt $RestartCooldownMinutes }
    if ($NoRecovery) { $Recovery = 'disabled' }
    elseif ($HealthyEndpoints -eq 0) { $Recovery = 'waiting_for_healthy_endpoint' }
    elseif ($RecentRestarts.Count -ge $MaxRestartsPerHour) { $Recovery = 'hourly_restart_limit' }
    elseif ($CooldownActive) { $Recovery = 'restart_cooldown' }
    else {
      $Event = [ordered]@{ at = $NowUtc.ToString('o'); run_id = $ResolvedRunId; reason = $Reason; previous_pid = if ($Process) { $Process.ProcessId } else { $null }; last_progress_at = $Progress.last_progress_at }
      $RestartEvents += [pscustomobject]$Event
      $Recovery = 'restarting'
      $PreRestartStatus = [ordered]@{
        observed_at = $NowUtc.ToString('o'); status = $State; reason = $Reason; run_id = $ResolvedRunId
        manifest_status = $ManifestStatus; stage = if ($CurrentStage) { $CurrentStage.name } else { $null }
        running = $null -ne $Process; pid = if ($Process) { $Process.ProcessId } else { $null }
        progress = $Progress; endpoints = $EndpointResults; recovery = $Recovery; restart_events = $RestartEvents
      }
      Write-JsonAtomic $StatusPath $PreRestartStatus
      try { Restart-FromLaunch $ResolvedRunId $RunDir $Launch; $Recovery = 'restarted' } catch { $Recovery = 'restart_failed'; $Reason = $Reason + ':' + $_.Exception.Message }
    }
  }

  $Status = [ordered]@{
    observed_at = [DateTime]::UtcNow.ToString('o')
    status = $State
    reason = $Reason
    run_id = $ResolvedRunId
    manifest_status = $ManifestStatus
    stage = if ($CurrentStage) { $CurrentStage.name } else { $null }
    running = $null -ne $Process
    pid = if ($Process) { $Process.ProcessId } else { $null }
    progress = $Progress
    endpoints = $EndpointResults
    recovery = $Recovery
    restart_events = $RestartEvents
  }
  Write-JsonAtomic $StatusPath $Status
  $Status | ConvertTo-Json -Depth 14
} finally {
  if ($LockStream) { $LockStream.Dispose() }
}
