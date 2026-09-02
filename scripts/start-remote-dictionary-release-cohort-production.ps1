param(
  [string]$Root = 'D:\linguago-runner',
  [string]$CurrentRunId = '',
  [string]$RunPrefix = 'native-daily-release',
  [int]$BatchLimit = 5000,
  [int]$MaxBatches = 30,
  [int]$PollSeconds = 60,
  [ValidateSet('native-daily', 'additional-sense', 'daily-mixed')]
  [string]$CandidateMode = 'daily-mixed'
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$ScriptPath = Join-Path $Root 'scripts\run-remote-dictionary-production-until-release.ps1'
$TaskName = 'LinguaGo Release Cohort Production'
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Orchestrator script not found: $ScriptPath" }

$Existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*run-remote-dictionary-production-until-release.ps1*' } |
  Select-Object -First 1
if ($Existing) {
  [pscustomobject]@{ Ok = $true; AlreadyRunning = $true; Pid = $Existing.ProcessId; TaskName = $TaskName } | ConvertTo-Json
  exit 0
}

$StateRoot = Join-Path $Root 'state'
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$Stdout = Join-Path $StateRoot 'release-cohort-production.stdout.log'
$Stderr = Join-Path $StateRoot 'release-cohort-production.stderr.log'
$Arguments = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $ScriptPath),
  '-Root', ('"{0}"' -f $Root),
  '-RunPrefix', ('"{0}"' -f $RunPrefix),
  '-BatchLimit', $BatchLimit,
  '-MaxBatches', $MaxBatches,
  '-PollSeconds', $PollSeconds,
  '-CandidateMode', $CandidateMode
)
if (-not [string]::IsNullOrWhiteSpace($CurrentRunId)) {
  $Arguments += @('-CurrentRunId', ('"{0}"' -f $CurrentRunId))
}

$TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($Arguments -join ' ') -WorkingDirectory $Root
$TaskTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddYears(5))
$TaskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Settings $TaskSettings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$Deadline = [DateTime]::UtcNow.AddSeconds(15)
$Process = $null
do {
  Start-Sleep -Milliseconds 250
  $Process = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*run-remote-dictionary-production-until-release.ps1*' } |
    Select-Object -First 1
} while (-not $Process -and [DateTime]::UtcNow -lt $Deadline)
if (-not $Process) {
  $TaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  throw "Release cohort task did not create a process; last_result=$($TaskInfo.LastTaskResult)"
}

[pscustomobject]@{
  Ok = $true
  AlreadyRunning = $false
  Pid = $Process.ProcessId
  TaskName = $TaskName
  State = (Join-Path $StateRoot 'release-cohort-production.json')
  Stdout = $Stdout
  Stderr = $Stderr
} | ConvertTo-Json
