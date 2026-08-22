param(
  [ValidateSet('start', 'run', 'status', 'stop')]
  [string]$Action = 'status',
  [string]$Batch = 'batches\v97-20c.json',
  [string]$RunId = 'v97-20c-fixed-contract',
  [int]$GenerationTarget = 20,
  [string]$SupplementalSourceDb = '',
  [string]$SourceRunDir = '',
  [ValidateSet('legacy', 'simplified')]
  [string]$PipelineMode = 'simplified',
  [object]$ProductionPrefilter = $true,
  [object]$RequireAuthoritativeSourceSense = $true,
  [object]$DailyPrimarySenseSelection = $false,
  [object]$SourceSenseAlignment = $false,
  [object]$AllowNativeSourceFallback = $false,
  [object]$ReverseEvidencePrefilter = $false,
  [int]$ReverseEvidenceMinTargetLangs = 2,
  [int]$ReverseEvidencePrefilterLimit = 1000000,
  [object]$EnforceGenerationHintTerms = $false,
  [object]$AllowModelDownload = $false,
  [string]$QwenEndpoints = 'http://127.0.0.1:11441,http://127.0.0.1:11448,http://127.0.0.1:11447',
  [string]$QwenVariants = '11441=UD-Q4_K_XL,11448=UD-IQ4_NL,11447=UD-IQ4_NL',
  [string]$GemmaEndpoints = 'http://127.0.0.1:11442,http://127.0.0.1:11445,http://127.0.0.1:11446',
  [string]$GemmaVariants = '11442=UD-Q4_K_XL,11445=UD-Q4_K_XL,11446=UD-Q4_K_XL',
  [string]$ElasticEndpoints = 'http://127.0.0.1:11442,http://127.0.0.1:11445',
  [string]$ElasticQwenVariants = '11442=UD-Q4_K_XL,11445=UD-Q4_K_XL',
  [int]$ElasticMinimumItems = 20,
  [object]$ElasticModelSwap = $true,
  [object]$DynamicEndpointDiscovery = $true,
  [string]$ClusterStatusUrl = 'http://127.0.0.1:18080/api/status',
  [string]$ClusterServiceUser = 'g24tka12',
  [int]$StartTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'

function ConvertTo-RunnerBoolean([object]$Value, [string]$Name) {
  if ($Value -is [bool]) { return $Value }
  $Text = ([string]$Value).Trim().ToLowerInvariant()
  if ($Text -in @('true', '1', 'yes', 'on')) { return $true }
  if ($Text -in @('false', '0', 'no', 'off')) { return $false }
  throw "$Name must be true/false or 1/0"
}

$ProductionPrefilter = ConvertTo-RunnerBoolean $ProductionPrefilter 'ProductionPrefilter'
$RequireAuthoritativeSourceSense = ConvertTo-RunnerBoolean $RequireAuthoritativeSourceSense 'RequireAuthoritativeSourceSense'
$DailyPrimarySenseSelection = ConvertTo-RunnerBoolean $DailyPrimarySenseSelection 'DailyPrimarySenseSelection'
$SourceSenseAlignment = ConvertTo-RunnerBoolean $SourceSenseAlignment 'SourceSenseAlignment'
$AllowNativeSourceFallback = ConvertTo-RunnerBoolean $AllowNativeSourceFallback 'AllowNativeSourceFallback'
$ReverseEvidencePrefilter = ConvertTo-RunnerBoolean $ReverseEvidencePrefilter 'ReverseEvidencePrefilter'
$EnforceGenerationHintTerms = ConvertTo-RunnerBoolean $EnforceGenerationHintTerms 'EnforceGenerationHintTerms'
$AllowModelDownload = ConvertTo-RunnerBoolean $AllowModelDownload 'AllowModelDownload'
$ElasticModelSwap = ConvertTo-RunnerBoolean $ElasticModelSwap 'ElasticModelSwap'
$DynamicEndpointDiscovery = ConvertTo-RunnerBoolean $DynamicEndpointDiscovery 'DynamicEndpointDiscovery'

$Root = 'D:\linguago-runner'
$RunDir = Join-Path $Root (Join-Path 'runs' $RunId)
$ControllerPath = Join-Path $RunDir 'controller.json'
$ManifestPath = Join-Path $RunDir 'manifest.json'
$StartupPath = Join-Path $RunDir 'startup.json'
$StateDir = Join-Path $Root 'state'
$GlobalControllerPath = Join-Path $StateDir 'remote-pipeline-controller.json'
$GlobalLockPath = Join-Path $StateDir 'remote-pipeline.lock.json'
$ScheduledTaskName = 'Linguago Remote Dictionary Pipeline'

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Get-RunnerProcess {
  $Controller = Read-JsonFile $ControllerPath
  if ($Controller -and $Controller.pid) {
    $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Controller.pid)" -ErrorAction SilentlyContinue
    $CommandLine = [string]$Process.CommandLine
    if ($Process -and $CommandLine -like "*$RunId*") {
      return Get-Process -Id $Controller.pid -ErrorAction SilentlyContinue
    }
  }
  $NodeProcess = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*run-dictionary-v2-remote-pipeline.mjs*' -and
      $_.CommandLine -like "*$RunId*"
    } |
    Select-Object -First 1
  if ($NodeProcess) { return Get-Process -Id $NodeProcess.ProcessId -ErrorAction SilentlyContinue }
  return $null
}

function Get-GlobalRunnerProcess {
  $Controller = Read-JsonFile $GlobalControllerPath
  if (-not $Controller -or -not $Controller.pid) { return $null }
  $Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Controller.pid)" -ErrorAction SilentlyContinue
  if (-not $Process) {
    Remove-Item -LiteralPath $GlobalControllerPath -Force -ErrorAction SilentlyContinue
    return $null
  }
  $CommandLine = [string]$Process.CommandLine
  if (
    $CommandLine -notlike '*run-dictionary-v2-remote-pipeline.mjs*' -and
    $CommandLine -notlike '*manage-remote-dictionary-runner.ps1*'
  ) { return $null }
  return $Process
}

function Get-CoverageScannerProcesses {
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -like '*find-dictionary-v2-product-coverage-gaps.mjs*' -or
      $_.CommandLine -like '*find-dictionary-v2-native-daily-coverage-gaps.mjs*'
    })
}

function Get-ScheduledLaunchProcesses {
  @(
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        $_.CommandLine -like '*run-remote-dictionary-runner-job.ps1*' -and
        $_.CommandLine -like "*$RunId*"
      }
  )
}

function Write-StartupState([string]$Status, [hashtable]$Details = @{}) {
  $State = [ordered]@{
    run_id = $RunId
    status = $Status
    observed_at = [DateTime]::UtcNow.ToString('o')
  }
  foreach ($Key in $Details.Keys) { $State[$Key] = $Details[$Key] }
  $State | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $StartupPath -Encoding UTF8
}

if ($Action -eq 'status') {
  $Process = Get-RunnerProcess
  $GlobalProcess = Get-GlobalRunnerProcess
  $Manifest = Read-JsonFile $ManifestPath
  [pscustomobject]@{
    RunId = $RunId
    Running = $null -ne $Process
    Pid = if ($Process) { $Process.Id } else { $null }
    ManifestStatus = if ($Manifest) { $Manifest.status } else { 'not_started' }
    CurrentStages = if ($Manifest) { $Manifest.stages } else { $null }
    Summary = if ($Manifest) { $Manifest.summary } else { $null }
    GlobalRunner = if ($GlobalProcess) {
      [pscustomobject]@{ Pid = $GlobalProcess.ProcessId; CommandLine = $GlobalProcess.CommandLine }
    } else { $null }
    Lock = Read-JsonFile $GlobalLockPath
  } | ConvertTo-Json -Depth 8
  exit 0
}

if ($Action -eq 'stop') {
  $Process = Get-RunnerProcess
  if ($Process) {
    & taskkill.exe /PID $Process.Id /T /F | Out-Null
    Write-Output "stopped pid=$($Process.Id)"
    Remove-Item -LiteralPath $GlobalControllerPath -Force -ErrorAction SilentlyContinue
  } else {
    Write-Output 'not running'
  }
  Stop-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $GlobalLockPath -Force -ErrorAction SilentlyContinue
  exit 0
}

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
$ExistingLock = Read-JsonFile $GlobalLockPath
if ($Action -eq 'start' -and $ExistingLock) {
  throw "Another dictionary pipeline is reserved or running: $($ExistingLock.run_id)"
}
if ($Action -eq 'run' -and $ExistingLock -and $ExistingLock.run_id -ne $RunId) {
  throw "Another dictionary pipeline is reserved or running: $($ExistingLock.run_id)"
}
if (Get-GlobalRunnerProcess) { throw 'Another dictionary pipeline is already running on this host' }
if (Get-RunnerProcess) { throw "Runner $RunId is already running" }
$CoverageScanners = Get-CoverageScannerProcesses
if ($CoverageScanners.Count -gt 0) {
  $CoveragePids = ($CoverageScanners | ForEach-Object ProcessId) -join ','
  throw "Coverage scanner processes are still running (pids=$CoveragePids); stop or finish them before starting the model pipeline"
}
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
  '--pipeline-mode', $PipelineMode,
  '--production-prefilter', $ProductionPrefilter.ToString().ToLowerInvariant(),
  '--require-authoritative-source-sense', $RequireAuthoritativeSourceSense.ToString().ToLowerInvariant(),
  '--daily-primary-sense-selection', $DailyPrimarySenseSelection.ToString().ToLowerInvariant(),
  '--source-sense-alignment', $SourceSenseAlignment.ToString().ToLowerInvariant(),
  '--allow-native-source-fallback', $AllowNativeSourceFallback.ToString().ToLowerInvariant(),
  '--reverse-evidence-prefilter', $ReverseEvidencePrefilter.ToString().ToLowerInvariant(),
  '--reverse-evidence-min-target-langs', [string]$ReverseEvidenceMinTargetLangs,
  '--reverse-evidence-prefilter-limit', [string]$ReverseEvidencePrefilterLimit,
  '--enforce-generation-hint-terms', $EnforceGenerationHintTerms.ToString().ToLowerInvariant(),
  '--allow-model-download', $AllowModelDownload.ToString().ToLowerInvariant(),
  '--resume', 'true',
  '--generation-target', $GenerationTarget,
  '--qwen-endpoints', $QwenEndpoints,
  '--qwen-variants', $QwenVariants,
  '--gemma-endpoints', $GemmaEndpoints,
  '--gemma-variants', $GemmaVariants,
  '--elastic-endpoints', $ElasticEndpoints,
  '--elastic-qwen-variants', $ElasticQwenVariants,
  '--elastic-minimum-items', $ElasticMinimumItems,
  '--elastic-model-swap', $ElasticModelSwap.ToString().ToLowerInvariant(),
  '--dynamic-endpoint-discovery', $DynamicEndpointDiscovery.ToString().ToLowerInvariant(),
  '--cluster-status-url', $ClusterStatusUrl,
  '--cluster-service-user', $ClusterServiceUser
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
  if (-not $ExistingLock) {
    @{
      run_id = $RunId
      reserved_at = [DateTime]::UtcNow.ToString('o')
      owner_pid = $PID
      mode = 'foreground'
    } | ConvertTo-Json | Set-Content -LiteralPath $GlobalLockPath -Encoding UTF8
  }
  @{
    pid = $PID
    run_id = $RunId
    batch = $BatchPath
    mode = 'foreground'
    started_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $ControllerPath -Encoding UTF8
  Copy-Item -LiteralPath $ControllerPath -Destination $GlobalControllerPath -Force
  try {
    Set-Location -LiteralPath $Root
    & node.exe @Arguments
    exit $LASTEXITCODE
  } finally {
    Remove-Item -LiteralPath $ControllerPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $GlobalControllerPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $GlobalLockPath -Force -ErrorAction SilentlyContinue
  }
}
$LaunchPath = Join-Path $RunDir 'launch.json'
$Launch = [ordered]@{
  Action = 'run'
  Batch = $Batch
  RunId = $RunId
  GenerationTarget = $GenerationTarget
  SupplementalSourceDb = $SupplementalSourceDb
  SourceRunDir = $SourceRunDir
  PipelineMode = $PipelineMode
  ProductionPrefilter = $ProductionPrefilter
  RequireAuthoritativeSourceSense = $RequireAuthoritativeSourceSense
  DailyPrimarySenseSelection = $DailyPrimarySenseSelection
  SourceSenseAlignment = $SourceSenseAlignment
  AllowNativeSourceFallback = $AllowNativeSourceFallback
  ReverseEvidencePrefilter = $ReverseEvidencePrefilter
  ReverseEvidenceMinTargetLangs = $ReverseEvidenceMinTargetLangs
  ReverseEvidencePrefilterLimit = $ReverseEvidencePrefilterLimit
  EnforceGenerationHintTerms = $EnforceGenerationHintTerms
  AllowModelDownload = $AllowModelDownload
  QwenEndpoints = $QwenEndpoints
  QwenVariants = $QwenVariants
  GemmaEndpoints = $GemmaEndpoints
  GemmaVariants = $GemmaVariants
  ElasticEndpoints = $ElasticEndpoints
  ElasticQwenVariants = $ElasticQwenVariants
  ElasticMinimumItems = $ElasticMinimumItems
  ElasticModelSwap = $ElasticModelSwap
  DynamicEndpointDiscovery = $DynamicEndpointDiscovery
  ClusterStatusUrl = $ClusterStatusUrl
  ClusterServiceUser = $ClusterServiceUser
  StartTimeoutSeconds = $StartTimeoutSeconds
}
$Launch | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $LaunchPath -Encoding UTF8
Write-StartupState 'reserved' @{ timeout_seconds = $StartTimeoutSeconds }
@{
  run_id = $RunId
  reserved_at = [DateTime]::UtcNow.ToString('o')
  launch = $LaunchPath
  mode = 'scheduled-task'
} | ConvertTo-Json | Set-Content -LiteralPath $GlobalLockPath -Encoding UTF8

try {
  $TaskScript = Join-Path $Root 'scripts\run-remote-dictionary-runner-job.ps1'
  $TaskArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$TaskScript`" -Config `"$LaunchPath`""
  $TaskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $TaskArguments -WorkingDirectory $Root
  $TaskTrigger = New-ScheduledTaskTrigger -Once -At ([DateTime]::Now.AddDays(1))
  Register-ScheduledTask -TaskName $ScheduledTaskName -Action $TaskAction -Trigger $TaskTrigger -Force | Out-Null
  Start-ScheduledTask -TaskName $ScheduledTaskName
} catch {
  Write-StartupState 'launch_failed' @{ error = [string]$_.Exception.Message }
  Remove-Item -LiteralPath $GlobalLockPath -Force -ErrorAction SilentlyContinue
  throw
}

$Deadline = [DateTime]::UtcNow.AddSeconds([Math]::Max(5, $StartTimeoutSeconds))
do {
  Start-Sleep -Milliseconds 500
  $Manifest = Read-JsonFile $ManifestPath
  if ($Manifest) {
    Write-StartupState 'started' @{
      manifest_status = [string]$Manifest.status
      manifest_started_at = [string]$Manifest.started_at
    }
    Write-Output "started scheduled_task=$ScheduledTaskName run_id=$RunId manifest_status=$($Manifest.status)"
    exit 0
  }
  $TaskInfo = Get-ScheduledTaskInfo -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
  if ($TaskInfo -and $TaskInfo.LastTaskResult -ne 267009 -and $TaskInfo.LastRunTime -gt [DateTime]::MinValue) {
    break
  }
} while ([DateTime]::UtcNow -lt $Deadline)

$LaunchProcesses = Get-ScheduledLaunchProcesses
foreach ($LaunchProcess in $LaunchProcesses) {
  & taskkill.exe /PID $LaunchProcess.ProcessId /T /F | Out-Null
}
Stop-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
$TaskInfo = Get-ScheduledTaskInfo -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
Write-StartupState 'startup_timeout' @{
  timeout_seconds = $StartTimeoutSeconds
  task_result = if ($TaskInfo) { $TaskInfo.LastTaskResult } else { $null }
  terminated_process_ids = @($LaunchProcesses | ForEach-Object ProcessId)
}
Remove-Item -LiteralPath $GlobalControllerPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $GlobalLockPath -Force -ErrorAction SilentlyContinue
throw "Scheduled runner did not create manifest.json within $StartTimeoutSeconds seconds; the reserved run was stopped and unlocked"
