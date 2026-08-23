param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedMainSha256,
  [int]$PollSeconds = 60
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
$ScriptPath = Join-Path $Root 'scripts\complete-remote-dictionary-production-run.ps1'
$TaskName = 'LinguaGo Dictionary Production Supervisor'
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Supervisor script not found: $ScriptPath" }

$Existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*complete-remote-dictionary-production-run.ps1*' -and
    $_.CommandLine -like "*$RunId*"
  } |
  Select-Object -First 1
if ($Existing) {
  [pscustomobject]@{ Ok = $true; RunId = $RunId; AlreadyRunning = $true; Pid = $Existing.ProcessId } |
    ConvertTo-Json
  exit 0
}

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
$Stdout = Join-Path $RunDir 'production-supervisor.stdout.log'
$Stderr = Join-Path $RunDir 'production-supervisor.stderr.log'
$Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -Root `"$Root`" -RunId `"$RunId`" -ExpectedMainSha256 `"$ExpectedMainSha256`" -PollSeconds $PollSeconds"
$TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $Arguments -WorkingDirectory $Root
# The task is started on demand. The distant trigger keeps the task definition valid
# without accidentally launching an obsolete run after a reboot.
$TaskTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddYears(5))
$TaskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $TaskAction -Trigger $TaskTrigger -Settings $TaskSettings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$Deadline = [DateTime]::UtcNow.AddSeconds(15)
$Process = $null
do {
  Start-Sleep -Milliseconds 250
  $Process = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*complete-remote-dictionary-production-run.ps1*' -and
      $_.CommandLine -like "*$RunId*"
    } |
    Select-Object -First 1
} while (-not $Process -and [DateTime]::UtcNow -lt $Deadline)
if (-not $Process) {
  $TaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  throw "Supervisor scheduled task did not create a process; last_result=$($TaskInfo.LastTaskResult)"
}

[pscustomobject]@{
  Ok = $true
  RunId = $RunId
  AlreadyRunning = $false
  Pid = $Process.ProcessId
  TaskName = $TaskName
  Stdout = $Stdout
  Stderr = $Stderr
} | ConvertTo-Json
