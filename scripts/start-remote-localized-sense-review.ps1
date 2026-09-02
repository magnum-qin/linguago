param(
  [ValidateSet('start','status','stop')][string]$Action = 'start',
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)][string]$RunId,
  [int]$Limit = 500,
  [int]$Concurrency = 5,
  [int]$TimeoutMs = 60000,
  [int]$CheckpointEvery = 10,
  [string]$RiskInput = '',
  [string]$QwenOut = '',
  [string]$GemmaOut = '',
  [string]$ConsensusOut = '',
  [switch]$SecondaryReviewAll
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$runDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $runDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw 'RunId escapes runner root' }
$configPath = Join-Path $runDir 'localized-sense-launch.json'
$taskName = 'LinguaGo Localized Sense Review'
$statusPath = Join-Path $runDir 'localized-sense-status.json'
$AllJobs = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*run-remote-localized-sense-review-job.ps1*' })
$Existing = $AllJobs | Where-Object { $_.CommandLine -like "*$RunId*" } | Select-Object -First 1
if ($Action -eq 'status') {
  $Status = if(Test-Path -LiteralPath $statusPath){[IO.File]::ReadAllText($statusPath,[Text.Encoding]::UTF8)|ConvertFrom-Json}else{$null}
  [pscustomobject]@{Ok=$true;RunId=$RunId;Running=$null -ne $Existing;Pid=if($Existing){$Existing.ProcessId}else{$null};TaskName=$taskName;Status=$Status}|ConvertTo-Json -Depth 8
  exit 0
}
if ($Action -eq 'stop') {
  if($Existing){& taskkill.exe /PID $Existing.ProcessId /T /F | Out-Null}
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  [pscustomobject]@{Ok=$true;RunId=$RunId;Stopped=$null -ne $Existing;Pid=if($Existing){$Existing.ProcessId}else{$null}}|ConvertTo-Json
  exit 0
}
if ($AllJobs.Count -gt 0 -and -not $Existing) { throw "Another localized-sense review is already running (pid=$($AllJobs[0].ProcessId))" }
New-Item -ItemType Directory -Path $runDir -Force | Out-Null
if ($Existing) { [pscustomobject]@{Ok=$true;RunId=$RunId;AlreadyRunning=$true;Pid=$Existing.ProcessId;TaskName=$taskName}|ConvertTo-Json; exit 0 }
$Config = [ordered]@{ Root=$Root; RunId=$RunId; Limit=$Limit; Concurrency=$Concurrency; TimeoutMs=$TimeoutMs; CheckpointEvery=$CheckpointEvery; RiskInput=$RiskInput; QwenOut=$QwenOut; GemmaOut=$GemmaOut; ConsensusOut=$ConsensusOut; SecondaryReviewAll=[bool]$SecondaryReviewAll }
[IO.File]::WriteAllText($configPath, ($Config | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$job = Join-Path $Root 'scripts\run-remote-localized-sense-review-job.ps1'
$arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$job`" -Config `"$configPath`""
$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $Root
$trigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddYears(5))
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
$deadline=[DateTime]::UtcNow.AddSeconds(20);$process=$null
do { Start-Sleep -Milliseconds 250; $process=Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object{$_.CommandLine -like '*run-remote-localized-sense-review-job.ps1*' -and $_.CommandLine -like "*$RunId*"}|Select-Object -First 1 } while(-not $process -and [DateTime]::UtcNow -lt $deadline)
if(-not $process){$info=Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction SilentlyContinue;throw "Localized-sense task did not start; last_result=$($info.LastTaskResult)"}
[pscustomobject]@{Ok=$true;RunId=$RunId;AlreadyRunning=$false;Pid=$process.ProcessId;TaskName=$taskName;Config=$configPath}|ConvertTo-Json
