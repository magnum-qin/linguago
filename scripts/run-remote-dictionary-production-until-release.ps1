param(
  [string]$Root = 'D:\linguago-runner',
  [string]$CurrentRunId = '',
  [string]$RunPrefix = 'native-daily-release',
  [int]$BatchLimit = 5000,
  [int]$MaxBatches = 30,
  [int]$PollSeconds = 60,
  [ValidateSet('native-daily', 'additional-sense', 'daily-mixed')]
  [string]$CandidateMode = 'daily-mixed',
  [string]$SupplementalSourceDb = '.tmp\combined\openwn-word2word3-ja-apertium-wikidata-v3-evidence.db',
  [string]$NativeTargets = 'zh=30000,ja=10000,pt-BR=5000,en=5000',
  [int]$NativeFrequencyRankLimit = 50000,
  [ValidateRange(1, 100)]
  [int]$AdditionalSenseMaxEntryAttempts = 3,
  [ValidateRange(1, 100)]
  [int]$AdditionalSenseCandidateMultiplier = 12,
  [bool]$ContinueOnProductionGateFailure = $true,
  [ValidateSet('full', 'draft-production')]
  [string]$ExecutionMode = 'full'
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$StateRoot = Join-Path $Root 'state'
$StatePath = Join-Path $StateRoot 'release-cohort-production.json'
$MainDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$Baseline = Join-Path $Root 'config\dictionary-v2-online-baseline.json'
$CohortScript = Join-Path $Root 'scripts\report-dictionary-v2-release-cohort.mjs'
$BatchScript = Join-Path $Root 'scripts\new-remote-dictionary-production-batch.ps1'
$ManagerScript = Join-Path $Root 'scripts\manage-remote-dictionary-runner.ps1'
$CompletionScript = Join-Path $Root 'scripts\complete-remote-dictionary-production-run.ps1'
$LockPath = Join-Path $StateRoot 'release-cohort-production.lock'
$AdditionalSenseAttemptIndex = Join-Path $StateRoot 'additional-sense-attempt-index.json'

New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$Lock = $null
try {
  $Lock = [IO.File]::Open($LockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
  throw "Another release-cohort production orchestrator is already running: $LockPath"
}

function Write-State([string]$Status, [hashtable]$Details = @{}) {
  $Payload = [ordered]@{
    status = $Status
    updated_at = [DateTime]::UtcNow.ToString('o')
    current_run_id = $script:CurrentRunId
    batches_started = $script:BatchesStarted
  }
  foreach ($Key in $Details.Keys) { $Payload[$Key] = $Details[$Key] }
  $Json = $Payload | ConvertTo-Json -Depth 10
  $TempPath = "$StatePath.tmp-$PID-$([Guid]::NewGuid().ToString('N'))"
  [IO.File]::WriteAllText($TempPath, $Json, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $TempPath -Destination $StatePath -Force
}

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Get-CohortReport {
  $Temp = Join-Path $StateRoot 'release-cohort-production-status.json'
  & node.exe $CohortScript --db $MainDb --baseline $Baseline --out $Temp | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Release cohort report failed with exit=$LASTEXITCODE" }
  return Read-Json $Temp
}

function Get-BatchSelectedCount([string]$Path) {
  $Script = "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(String(Number(j.selected_count||0)));"
  $Value = & node.exe -e $Script $Path
  if ($LASTEXITCODE -ne 0) { throw "Cannot read candidate batch summary: $Path" }
  return [int]$Value
}

function Invoke-BatchBuild([string[]]$Arguments, [string]$Batch, [object]$Cohort, [string]$Lane) {
  $LogBase = Join-Path $StateRoot "candidate-build-$PID-$Lane"
  $StdoutPath = "$LogBase.stdout.log"
  $StderrPath = "$LogBase.stderr.log"
  $StartedAt = [DateTime]::UtcNow
  $Process = Start-Process -FilePath 'powershell.exe' -ArgumentList $Arguments `
    -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath -PassThru
  # Retain the process handle before polling; otherwise Windows PowerShell
  # can lose ExitCode after a short-lived child has exited.
  $ProcessHandle = $Process.Handle
  while (-not $Process.HasExited) {
    $Elapsed = [Math]::Floor(([DateTime]::UtcNow - $StartedAt).TotalSeconds)
    $ScanProgress = Read-Json (Join-Path $StateRoot 'native-scan-progress.json')
    if ($ScanProgress -and [DateTime]$ScanProgress.updated_at -lt $StartedAt) { $ScanProgress = $null }
    Write-State 'building_batch' @{
      cohort = $Cohort
      batch = $Batch
      lane = $Lane
      build_pid = $Process.Id
      build_elapsed_seconds = $Elapsed
      scan_progress = $ScanProgress
      heartbeat_at = [DateTime]::UtcNow.ToString('o')
    }
    Start-Sleep -Seconds ([Math]::Min(15, [Math]::Max(2, $PollSeconds)))
    $Process.Refresh()
  }
  $Process.WaitForExit()
  $ExitCode = $Process.ExitCode
  $Stdout = if (Test-Path -LiteralPath $StdoutPath) { [IO.File]::ReadAllText($StdoutPath, [Text.Encoding]::UTF8) } else { '' }
  $Stderr = if (Test-Path -LiteralPath $StderrPath) { [IO.File]::ReadAllText($StderrPath, [Text.Encoding]::UTF8) } else { '' }
  if ($null -eq $ExitCode -or $ExitCode -ne 0) {
    throw "Candidate batch build failed for lane=$Lane with exit=${ExitCode}: $Stderr"
  }
  return [pscustomobject]@{ ExitCode = $ExitCode; Stdout = $Stdout; Stderr = $Stderr }
}

function Wait-ForRun([string]$RunId) {
  $SupervisorStatus = Join-Path $Root (Join-Path "runs\$RunId" 'production-supervisor.json')
  while ($true) {
    $Status = Read-Json $SupervisorStatus
    if ($Status -and [string]$Status.status -eq 'complete') { return $Status }
    if ($Status -and [string]$Status.status -eq 'failed') {
      $Message = [string]$Status.details.error
      throw "Production supervisor failed for ${RunId}: $Message"
    }
    Write-State 'waiting_for_run' @{ run_id = $RunId; supervisor_status = if ($Status) { $Status.status } else { 'not_created' } }
    Start-Sleep -Seconds $PollSeconds
  }
}

function Wait-ForPipelineLockRelease {
  $PipelineLock = Join-Path $StateRoot 'remote-pipeline.lock.json'
  while (Test-Path -LiteralPath $PipelineLock) { Start-Sleep -Seconds 5 }
}

function Start-PipelineProcess([string]$RunId, [string]$Batch, [int]$GenerationTarget) {
  $AllowLinkedPrimary = ($CandidateMode -in @('additional-sense', 'daily-mixed')).ToString().ToLowerInvariant()
  $Arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ManagerScript,
    '-Action', 'run', '-RunId', $RunId, '-Batch', $Batch,
    '-GenerationTarget', [string]$GenerationTarget,
    '-SupplementalSourceDb', $SupplementalSourceDb,
    '-PipelineMode', 'simplified',
    '-ExecutionMode', $ExecutionMode,
    '-ProductionPrefilter', 'true',
    '-RequireAuthoritativeSourceSense', 'true',
    '-DailyPrimarySenseSelection', 'true',
    '-AllowLinkedPrimaryForAdditionalSense', $AllowLinkedPrimary,
    '-SourceSenseAlignment', 'true',
    '-SourceSenseAlignmentMaxLangs', '4',
    '-AllowNativeSourceFallback', 'true',
    '-ReverseEvidencePrefilter', 'false',
    '-ReverseEvidenceMinTargetLangs', '2',
    '-ReverseEvidencePrefilterLimit', '1000000',
    '-EnforceGenerationHintTerms', 'true',
    '-AllowModelDownload', 'false',
    '-ElasticModelSwap', 'true',
    '-DynamicEndpointDiscovery', 'true'
  )
  if ($CandidateMode -in @('additional-sense', 'daily-mixed')) {
    $Arguments += @('-DailyPrimaryAttemptIndex', $AdditionalSenseAttemptIndex)
  }
  return Start-Process -FilePath 'powershell.exe' -ArgumentList $Arguments `
    -WorkingDirectory $Root -WindowStyle Hidden -PassThru
}

function Test-ProductionGateRejection([string]$RunDir, [object]$Failure) {
  $Parts = @([string]$Failure.Exception.Message)
  $SupervisorPath = Join-Path $RunDir 'production-supervisor.json'
  if (Test-Path -LiteralPath $SupervisorPath) {
    try {
      $Supervisor = [IO.File]::ReadAllText($SupervisorPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
      $Parts += [string]$Supervisor.details.error
    } catch {}
  }
  $PublishLog = Join-Path $RunDir 'controlled-publish-supervisor.log'
  if (Test-Path -LiteralPath $PublishLog) {
    try { $Parts += [IO.File]::ReadAllText($PublishLog, [Text.Encoding]::Unicode) } catch {
      try { $Parts += [IO.File]::ReadAllText($PublishLog, [Text.Encoding]::UTF8) } catch {}
    }
  }
  return (($Parts -join "`n") -match 'Production gates failed')
}

$script:CurrentRunId = $CurrentRunId
$script:BatchesStarted = 0

try {
  if (-not (Test-Path -LiteralPath $MainDb)) { throw "Main product DB not found: $MainDb" }
  if (-not (Test-Path -LiteralPath $Baseline)) { throw "Release baseline not found: $Baseline" }

  if (-not [string]::IsNullOrWhiteSpace($script:CurrentRunId)) {
    Wait-ForRun $script:CurrentRunId | Out-Null
  }

  while ($script:BatchesStarted -lt $MaxBatches) {
    $Cohort = Get-CohortReport
    if ($Cohort.release_ready) {
      Write-State 'release_ready' @{ cohort = $Cohort }
      exit 0
    }
    if (-not $Cohort.ok) { throw "Release cohort is invalid: status=$($Cohort.status)" }

    Wait-ForPipelineLockRelease
    $Remaining = [int]$Cohort.remaining_senses
    $CandidateMultiplier = if ($CandidateMode -in @('additional-sense', 'daily-mixed')) { $AdditionalSenseCandidateMultiplier } else { 4 }
    $Requested = [Math]::Min($BatchLimit, [Math]::Max(100, $Remaining * $CandidateMultiplier))
    $Stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
    $script:CurrentRunId = "$RunPrefix-$Stamp"
    $BatchRelative = "batches\$($script:CurrentRunId).json"

    Write-State 'building_batch' @{ cohort = $Cohort; requested_candidates = $Requested; batch = $BatchRelative }
    $LangQuotas = ''
    if ($CandidateMode -in @('additional-sense', 'daily-mixed')) {
      & node.exe (Join-Path $Root 'scripts\build-dictionary-v2-additional-sense-attempt-index.mjs') `
        --root $Root --runs-root 'runs' --out 'state\additional-sense-attempt-index.json'
      if ($LASTEXITCODE -ne 0) { throw "Additional-sense attempt index build failed with exit=$LASTEXITCODE" }
      $ZhQuota = [Math]::Floor($Requested * 0.30)
      $JaQuota = [Math]::Floor($Requested * 0.30)
      $PtQuota = [Math]::Floor($Requested * 0.25)
      $EnQuota = $Requested - $ZhQuota - $JaQuota - $PtQuota
      $LangQuotas = "zh=$ZhQuota,ja=$JaQuota,pt-BR=$PtQuota,en=$EnQuota"
    }
    $EffectiveMode = $CandidateMode
    $BatchArgs = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $BatchScript,
      '-Root', $Root, '-Limit', [string]$Requested, '-Out', $BatchRelative,
      '-CandidateMode', $(if ($EffectiveMode -eq 'daily-mixed') { 'native-daily' } else { $EffectiveMode }),
      '-NativeMaxRank', '2000000', '-NativeScanLimit', '2000000',
      '-NativeTargets', $NativeTargets,
      '-NativeFrequencyRankLimit', [string]$NativeFrequencyRankLimit
    )
    if (-not [string]::IsNullOrWhiteSpace($LangQuotas)) {
      $BatchArgs += @('-NativeLangQuotas', $LangQuotas)
    }
    if ($EffectiveMode -in @('additional-sense', 'daily-mixed')) {
      $BatchArgs += @(
        '-AdditionalSenseAttemptIndex', $AdditionalSenseAttemptIndex,
        '-AdditionalSenseMaxEntryAttempts', [string]$AdditionalSenseMaxEntryAttempts
      )
    }
    if ($ExecutionMode -eq 'draft-production') {
      # Draft production cannot mutate publishable rows. Its candidate build is
      # allowed to proceed when unrelated mutable manifest entries have drifted.
      $BatchArgs += '-SkipVerify'
    }
    if ($EffectiveMode -eq 'daily-mixed') {
      $NominalHeadwordLimit = [Math]::Ceiling($Requested * 0.60)
      $NativeLimit = $Requested
      $AdditionalLimit = $Requested - $NominalHeadwordLimit
      $NativeRelative = $BatchRelative -replace '\.json$', '-headwords.json'
      $AdditionalRelative = $BatchRelative -replace '\.json$', '-additional-senses.json'
      $NativeArgs = @($BatchArgs)
      for ($Index = 0; $Index -lt $NativeArgs.Count; $Index++) {
        if ($NativeArgs[$Index] -eq '-Limit') { $NativeArgs[$Index + 1] = [string]$NativeLimit }
        if ($NativeArgs[$Index] -eq '-Out') { $NativeArgs[$Index + 1] = $NativeRelative }
      }
      Invoke-BatchBuild $NativeArgs $NativeRelative $Cohort 'headword' | Out-Null

      $AdditionalArgs = @($BatchArgs)
      for ($Index = 0; $Index -lt $AdditionalArgs.Count; $Index++) {
        if ($AdditionalArgs[$Index] -eq '-Limit') { $AdditionalArgs[$Index + 1] = [string]$AdditionalLimit }
        if ($AdditionalArgs[$Index] -eq '-Out') { $AdditionalArgs[$Index + 1] = $AdditionalRelative }
        if ($AdditionalArgs[$Index] -eq '-CandidateMode') { $AdditionalArgs[$Index + 1] = 'additional-sense' }
      }
      Invoke-BatchBuild $AdditionalArgs $AdditionalRelative $Cohort 'additional-sense' | Out-Null
      & node.exe (Join-Path $Root 'scripts\merge-dictionary-v2-daily-production-lanes.mjs') `
        --headwords (Join-Path $Root $NativeRelative) `
        --additional-senses (Join-Path $Root $AdditionalRelative) `
        --out (Join-Path $Root $BatchRelative) `
        --headword-limit $NominalHeadwordLimit `
        --additional-sense-limit $AdditionalLimit
      if ($LASTEXITCODE -ne 0) { throw "Daily lane merge failed with exit=$LASTEXITCODE" }
    } else {
      Invoke-BatchBuild $BatchArgs $BatchRelative $Cohort $EffectiveMode | Out-Null
    }

    $Selected = Get-BatchSelectedCount (Join-Path $Root $BatchRelative)
    if ($Selected -lt 1) {
      Write-State 'candidate_exhausted' @{
        cohort = $Cohort
        batch = $BatchRelative
        selected = 0
        recovery_required = $true
        gpu_started = $false
      }
      exit 0
    }
    if ($Selected -lt $Requested -and $ExecutionMode -ne 'draft-production') {
      Write-State 'candidate_shortfall' @{
        cohort = $Cohort
        batch = $BatchRelative
        requested = $Requested
        selected = $Selected
        validation_batch_complete = $false
        gpu_started = $false
      }
      exit 0
    }
    if ($Selected -lt $Requested) {
      Write-State 'candidate_shortfall_continuing' @{
        cohort = $Cohort
        batch = $BatchRelative
        requested = $Requested
        selected = $Selected
        execution_mode = $ExecutionMode
        gpu_started = $false
      }
    }
    if ($CandidateMode -eq 'daily-mixed') {
      $QualityHold = Read-Json (Join-Path $StateRoot 'daily-production-quality-hold.json')
      if ($ExecutionMode -ne 'draft-production' -and $QualityHold -and $QualityHold.status -eq 'candidate_quality_review_required') {
        Write-State 'candidate_quality_review_required' @{ batch = $BatchRelative; review = $QualityHold; gpu_started = $false }
        exit 0
      }
      $QualityAudit = Join-Path $StateRoot "$($script:CurrentRunId)-candidate-audit.json"
      & node.exe (Join-Path $Root 'scripts\audit-dictionary-v2-daily-candidate-cohort.mjs') `
        --report (Join-Path $Root $BatchRelative) --out $QualityAudit `
        --inspect-count 50 --minimum-candidates $(if ($ExecutionMode -eq 'draft-production') { $Selected } else { $Requested })
      if ($LASTEXITCODE -ne 0) {
        Write-State 'candidate_quality_review_required' @{ batch = $BatchRelative; audit = $QualityAudit; gpu_started = $false }
        exit 0
      }
    }
    $ExpectedMainSha256 = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash
    $RunDir = Join-Path $Root (Join-Path 'runs' $script:CurrentRunId)
    New-Item -ItemType Directory -Path $RunDir -Force | Out-Null

    Write-State 'starting_pipeline' @{
      cohort = $Cohort
      batch = $BatchRelative
      selected = $Selected
      expected_main_sha256 = $ExpectedMainSha256
    }
    $PipelineProcess = Start-PipelineProcess $script:CurrentRunId $BatchRelative $Selected
    if (-not $PipelineProcess) { throw 'Pipeline process could not be created' }
    $script:BatchesStarted++
    Write-State 'waiting_for_run' @{
      cohort = $Cohort
      batch = $BatchRelative
      selected = $Selected
      pipeline_pid = $PipelineProcess.Id
      expected_main_sha256 = $ExpectedMainSha256
    }
    if ($ExecutionMode -eq 'draft-production') {
      $ManifestPath = Join-Path $RunDir 'manifest.json'
      while ($true) {
        $PipelineProcess.Refresh()
        $PipelineManifest = Read-Json $ManifestPath
        if ($PipelineManifest -and $PipelineManifest.status -eq 'complete') {
          Write-State 'draft_batch_complete' @{
            run_id = $script:CurrentRunId
            batch = $BatchRelative
            selected = $Selected
            pipeline = $PipelineManifest.summary
            release_validation_pending = $true
          }
          exit 0
        }
        if ($PipelineManifest -and $PipelineManifest.status -eq 'failed') {
          throw "Draft pipeline failed: $($PipelineManifest.error)"
        }
        if ($PipelineProcess.HasExited) {
          throw "Draft pipeline exited before a complete manifest; exit=$($PipelineProcess.ExitCode)"
        }
        Start-Sleep -Seconds $PollSeconds
      }
    }
    try {
      & $CompletionScript -Root $Root -RunId $script:CurrentRunId `
        -ExpectedMainSha256 $ExpectedMainSha256 -PollSeconds $PollSeconds
    } catch {
      if ($ContinueOnProductionGateFailure -and (Test-ProductionGateRejection $RunDir $_)) {
        Write-State 'batch_rejected_by_production_gates' @{
          run_id = $script:CurrentRunId
          batch = $BatchRelative
          selected = $Selected
          error = $_.Exception.Message
        }
        continue
      }
      throw
    }
  }

  $FinalCohort = Get-CohortReport
  if (-not $FinalCohort.release_ready) {
    Write-State 'batch_limit_reached' @{
      cohort = $FinalCohort
      max_batches = $MaxBatches
      validation_batch_complete = $true
    }
    exit 0
  }
  Write-State 'release_ready' @{ cohort = $FinalCohort }
} catch {
  Write-State 'failed' @{
    error = [string]$_.Exception.Message
    error_type = [string]$_.Exception.GetType().FullName
  }
  throw
} finally {
  if ($null -ne $Lock) { $Lock.Dispose() }
}
