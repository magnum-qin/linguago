param(
  [string]$Root = 'D:\linguago-runner',
  [int]$Limit = 100,
  [string]$Out = '',
  [ValidateSet('authoritative-pool', 'native-daily', 'additional-sense')]
  [string]$CandidateMode = 'native-daily',
  [string]$Pool = 'data\candidates\v123-authoritative-pool.json',
  [string]$History = 'data\candidates\v123-attempted-source-history.json',
  [string]$ResidualHistory = 'state\dictionary-final-review-residuals.json',
  [string]$ExactSenseHistory = '',
  [int]$NativeMaxRank = 2000000,
  [int]$NativeScanLimit = 2000000,
  [string]$NativeTargets = 'zh=30000,ja=10000,pt-BR=5000,en=5000',
  [string]$NativeLangQuotas = '',
  [string]$AdditionalSenseAttemptIndex = 'state\additional-sense-attempt-index.json',
  [ValidateRange(1, 100)]
  [int]$AdditionalSenseMaxEntryAttempts = 3,
  [bool]$ExcludePreviouslyAttemptedSourceEntries = $true,
  [bool]$IncludeCompletedRunBatches = $true,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
if ($Limit -lt 1 -or $Limit -gt 20000) { throw 'Limit must be between 1 and 20000' }
$Root = [IO.Path]::GetFullPath($Root)
$StateRoot = Join-Path $Root 'state'
New-Item -ItemType Directory -Path $StateRoot -Force | Out-Null
$BuildLockPath = Join-Path $StateRoot 'candidate-build.lock'
$BuildLock = $null
try {
  $BuildLock = [IO.File]::Open(
    $BuildLockPath,
    [IO.FileMode]::OpenOrCreate,
    [IO.FileAccess]::ReadWrite,
    [IO.FileShare]::None
  )
} catch [IO.IOException] {
  throw "Another dictionary candidate build is already running: $BuildLockPath"
}

try {
if (-not $SkipVerify) {
  & (Join-Path $Root 'scripts\verify-remote-dictionary-runner.ps1') -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Remote runner verification failed' }
}

$HistoryPath = [IO.Path]::GetFullPath((Join-Path $Root $History))
$ProductDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
foreach ($Path in @($HistoryPath, $ProductDb)) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required input not found: $Path" }
}

$PoolPath = $null
$ResolvedAttemptIndex = $null
if ($CandidateMode -eq 'authoritative-pool') {
  $PoolPath = [IO.Path]::GetFullPath((Join-Path $Root $Pool))
  $SourceManifestPath = Join-Path $Root 'config\remote-candidate-sources.json'
  if (-not (Test-Path -LiteralPath $SourceManifestPath)) {
    throw "Candidate source manifest not found: $SourceManifestPath"
  }
  $SourceManifest = [IO.File]::ReadAllText($SourceManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  foreach ($Expected in $SourceManifest.files) {
    $CandidatePath = [IO.Path]::GetFullPath((Join-Path $Root $Expected.path))
    if (-not (Test-Path -LiteralPath $CandidatePath)) { throw "Candidate source not found: $CandidatePath" }
    $Item = Get-Item -LiteralPath $CandidatePath
    $Hash = (Get-FileHash -LiteralPath $CandidatePath -Algorithm SHA256).Hash
    if ($Item.Length -ne [long]$Expected.bytes -or $Hash -ne [string]$Expected.sha256) {
      throw "Candidate source fingerprint mismatch: $($Expected.path)"
    }
  }
}

if ([string]::IsNullOrWhiteSpace($Out)) {
  $Stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $Out = "batches\production-$Limit-$Stamp.json"
}
$OutPath = [IO.Path]::GetFullPath((Join-Path $Root $Out))
$BatchRoot = [IO.Path]::GetFullPath((Join-Path $Root 'batches'))
if (-not $OutPath.StartsWith($BatchRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must stay under D:\linguago-runner\batches'
}
New-Item -ItemType Directory -Path (Split-Path -Parent $OutPath) -Force | Out-Null

$ExcludePaths = [Collections.Generic.List[string]]::new()
$ExcludePaths.Add($HistoryPath)
$CompletedRunBatchPaths = [Collections.Generic.List[string]]::new()
if ($IncludeCompletedRunBatches) {
  $RunsRoot = Join-Path $Root 'runs'
  if (Test-Path -LiteralPath $RunsRoot) {
    foreach ($ManifestPath in Get-ChildItem -LiteralPath $RunsRoot -Filter manifest.json -File -Recurse) {
      try {
        $Manifest = [IO.File]::ReadAllText($ManifestPath.FullName, [Text.Encoding]::UTF8) | ConvertFrom-Json
        if ([string]$Manifest.status -notin @('complete', 'completed', 'succeeded')) { continue }
        if ([string]::IsNullOrWhiteSpace([string]$Manifest.input)) { continue }
        $CompletedBatchPath = [IO.Path]::GetFullPath((Join-Path $Root ([string]$Manifest.input)))
        if (-not $CompletedBatchPath.StartsWith($BatchRoot, [StringComparison]::OrdinalIgnoreCase)) { continue }
        if (Test-Path -LiteralPath $CompletedBatchPath) {
          $ExcludePaths.Add($CompletedBatchPath)
          $CompletedRunBatchPaths.Add($CompletedBatchPath)
        }
      } catch {
        Write-Warning "Ignoring unreadable completed-run manifest: $($ManifestPath.FullName)"
      }
    }
  }
}
$ExcludePaths = @($ExcludePaths | Sort-Object -Unique)
$CompletedRunBatchPaths = @($CompletedRunBatchPaths | Sort-Object -Unique)
$ExcludeArgument = $ExcludePaths -join ','
$NativeExclusionIndex = Join-Path $StateRoot 'native-daily-source-entry-exclusions.json'
$NativeExclusionClassification = Join-Path $StateRoot 'native-daily-source-entry-exclusion-classification.json'
$NativeBlockedExclusions = Join-Path $StateRoot 'native-daily-source-entry-blocked.json'

if ($CandidateMode -eq 'native-daily') {
  $HistoryInputs = @($History)
  $ResolvedResidualHistory = Join-Path $Root $ResidualHistory
  if (Test-Path -LiteralPath $ResolvedResidualHistory) { $HistoryInputs += $ResidualHistory }
  & node.exe (Join-Path $Root 'scripts\build-dictionary-v2-source-entry-exclusion-index.mjs') `
    --root $Root `
    --history ($HistoryInputs -join ',') `
    --runs-root 'runs' `
    --batch-root 'batches' `
    --out $NativeExclusionIndex
  if ($LASTEXITCODE -ne 0) { throw "Native exclusion index build failed with exit code $LASTEXITCODE" }
  $AttemptIndexArgs = @(
    (Join-Path $Root 'scripts\build-dictionary-v2-additional-sense-attempt-index.mjs'),
    '--root', $Root,
    '--runs-root', 'runs',
    '--out', 'state\additional-sense-attempt-index.json'
  )
  if (Test-Path -LiteralPath $ResolvedResidualHistory) {
    $AttemptHistories = @($ResidualHistory)
  } else {
    $AttemptHistories = @()
  }
  if (-not [string]::IsNullOrWhiteSpace($ExactSenseHistory)) {
    $AttemptHistories += @($ExactSenseHistory.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  }
  if ($AttemptHistories.Count -gt 0) {
    $AttemptIndexArgs += @('--history', ($AttemptHistories -join ','))
  }
  & node.exe @AttemptIndexArgs
  if ($LASTEXITCODE -ne 0) { throw 'Native exact-sense attempt index build failed' }
  $PreviousErrorActionPreference = $ErrorActionPreference
  try {
    # Node reports scan progress on stderr; do not promote those progress lines
    # to terminating PowerShell errors. The process exit code remains the gate.
    $ErrorActionPreference = 'Continue'
    & node.exe (Join-Path $Root 'scripts\classify-dictionary-v2-native-daily-exclusions.mjs') `
      --source-db (Join-Path $Root 'data\processed\linguago_v2_full.db') `
      --product-db $ProductDb `
      --exclusions $NativeExclusionIndex `
      --attempt-index (Join-Path $StateRoot 'additional-sense-attempt-index.json') `
      --out $NativeExclusionClassification `
      --blocked-out $NativeBlockedExclusions
    $ClassificationExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
  }
  if ($ClassificationExitCode -ne 0) { throw "Native exclusion classification failed with exit code $ClassificationExitCode" }
  # The compact index preserves every attempted source entry without exceeding
  # the Windows command-line limit with dozens of historical report paths.
  $ExcludeArgument = @($NativeBlockedExclusions; $CompletedRunBatchPaths) -join ','
}

if ($CandidateMode -eq 'additional-sense') {
  $NativeSourceDb = Join-Path $Root 'data\processed\linguago_v2_full.db'
  if (-not (Test-Path -LiteralPath $NativeSourceDb)) {
    throw "Native source database not found: $NativeSourceDb"
  }
  $OutBaseName = [IO.Path]::GetFileNameWithoutExtension($OutPath)
  $PoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-additional-sense-pool.json"
  # Scan every represented source entry. A smaller entry-level prefix is
  # dominated by exhausted or Wiktionary-only senses after long production
  # runs and can hide authoritative additional senses later in rank order.
  $PoolLimit = 50000
  & node.exe (Join-Path $Root 'scripts\find-dictionary-v2-product-additional-sense-entries.mjs') `
    --source-db $NativeSourceDb `
    --product-db $ProductDb `
    --max-rank $NativeMaxRank `
    --limit $PoolLimit `
    --out $PoolPath
  if ($LASTEXITCODE -ne 0) { throw "Additional-sense scan failed with exit code $LASTEXITCODE" }

  $ResolvedAttemptIndex = if ([IO.Path]::IsPathRooted($AdditionalSenseAttemptIndex)) {
    [IO.Path]::GetFullPath($AdditionalSenseAttemptIndex)
  } else {
    [IO.Path]::GetFullPath((Join-Path $Root $AdditionalSenseAttemptIndex))
  }
  if (-not $ResolvedAttemptIndex.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Additional-sense attempt index must stay under the runner root'
  }
  if (-not (Test-Path -LiteralPath $ResolvedAttemptIndex)) {
    throw "Additional-sense attempt index not found: $ResolvedAttemptIndex"
  }

  # Bind a concrete, unlinked and unattempted source sense before allocating
  # batch quota. This prevents exhausted entries from filling the outer cohort.
  $SensePoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-additional-sense-eligible.json"
  $SenseRejectedPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-additional-sense-ineligible.json"
  & node.exe (Join-Path $Root 'scripts\select-dictionary-v2-product-daily-primary-senses.mjs') `
    --report $PoolPath `
    --source-db $NativeSourceDb `
    --product-db $ProductDb `
    --out $SensePoolPath `
    --rejected-out $SenseRejectedPath `
    --min-score 2500 `
    --allow-linked-primary-for-additional-sense true `
    --attempt-index $ResolvedAttemptIndex
  if ($LASTEXITCODE -ne 0) { throw "Additional-sense eligibility scan failed with exit code $LASTEXITCODE" }

  # Apply the same authoritative-source gate used by the production pipeline,
  # so an OMW-only fallback cannot consume a batch slot and fail immediately.
  $TrustedPoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-additional-sense-trusted.json"
  $TrustedRejectedPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-additional-sense-untrusted.json"
  & node.exe (Join-Path $Root 'scripts\filter-dictionary-v2-production-batch.mjs') `
    --report $SensePoolPath `
    --out $TrustedPoolPath `
    --rejected-out $TrustedRejectedPath `
    --enabled true `
    --require-authoritative-source-sense true `
    --allow-english-omw-source false `
    --allow-pt-br-omw-source true `
    --allow-pt-br-wikdict-source true
  if ($LASTEXITCODE -ne 0) { throw "Additional-sense trust filter failed with exit code $LASTEXITCODE" }
  $PoolPath = $TrustedPoolPath
  # Entry-level history is intentionally not applied here. A represented entry
  # may be revisited while it still has a different unlinked source sense; the
  # daily-primary selector and product source links choose the next sense.
  $ExcludeArgument = ''
  $ExcludePreviouslyAttemptedSourceEntries = $false
}

if ($CandidateMode -eq 'native-daily') {
  $NativeSourceDb = Join-Path $Root 'data\processed\linguago_v2_full.db'
  if (-not (Test-Path -LiteralPath $NativeSourceDb)) {
    throw "Native source database not found: $NativeSourceDb"
  }
  $OutBaseName = [IO.Path]::GetFileNameWithoutExtension($OutPath)
  $PoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-coverage.json"
  & node.exe (Join-Path $Root 'scripts\find-dictionary-v2-native-daily-coverage-gaps.mjs') `
    --source-db $NativeSourceDb `
    --product-db $ProductDb `
    --max-rank $NativeMaxRank `
    --scan-limit $NativeScanLimit `
    --targets $NativeTargets `
    --exclude-reports $NativeBlockedExclusions `
    --progress-out (Join-Path $StateRoot 'native-scan-progress.json') `
    --out $PoolPath
  if ($LASTEXITCODE -ne 0) { throw "Native coverage scan failed with exit code $LASTEXITCODE" }

  # Bind an exact native sense before the production batch is allocated. Raw
  # entry-only rows cannot pass the authoritative source-sense prefilter.
  $NativeSensePoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-native-daily-senses.json"
  $NativeSenseRejectedPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-native-daily-senses-rejected.json"
  & node.exe (Join-Path $Root 'scripts\select-dictionary-v2-product-daily-primary-senses.mjs') `
    --report $PoolPath `
    --source-db $NativeSourceDb `
    --product-db $ProductDb `
    --out $NativeSensePoolPath `
    --rejected-out $NativeSenseRejectedPath `
    --attempt-index (Join-Path $StateRoot 'additional-sense-attempt-index.json') `
    --min-score 2500
  if ($LASTEXITCODE -ne 0) { throw "Native daily sense binding failed with exit code $LASTEXITCODE" }

  $NativeTrustedPoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-native-daily-trusted.json"
  $NativeTrustedRejectedPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-native-daily-untrusted.json"
  & node.exe (Join-Path $Root 'scripts\filter-dictionary-v2-production-batch.mjs') `
    --report $NativeSensePoolPath `
    --out $NativeTrustedPoolPath `
    --rejected-out $NativeTrustedRejectedPath `
    --enabled true `
    --require-authoritative-source-sense true `
    --allow-english-omw-source false `
    --allow-pt-br-omw-source true `
    --allow-pt-br-wikdict-source true
  if ($LASTEXITCODE -ne 0) { throw "Native daily trust filter failed with exit code $LASTEXITCODE" }
  $PoolPath = $NativeTrustedPoolPath
}

if ($CandidateMode -in @('native-daily', 'additional-sense')) {
  $DailyPoolPath = Join-Path (Split-Path -Parent $OutPath) "$OutBaseName-daily-quality.json"
  $Lane = if ($CandidateMode -eq 'native-daily') { 'new_headword' } else { 'additional_sense' }
  & node.exe (Join-Path $Root 'scripts\filter-dictionary-v2-daily-recovery-candidates.mjs') `
    --report $PoolPath --out $DailyPoolPath --lane $Lane
  if ($LASTEXITCODE -ne 0) { throw 'Daily recovery quality filter failed' }
  $PoolPath = $DailyPoolPath
}

$SelectorArgs = @(
  '--pool', $PoolPath,
  '--product-db', $ProductDb,
  '--limit', [string]$Limit,
  '--one-per-source-entry', 'true',
  '--exclude-source-entries', $ExcludePreviouslyAttemptedSourceEntries.ToString().ToLowerInvariant(),
  '--out', $OutPath
)
if (-not [string]::IsNullOrWhiteSpace($ExcludeArgument)) {
  $SelectorArgs += @('--exclude', $ExcludeArgument)
}
if (-not [string]::IsNullOrWhiteSpace($NativeLangQuotas)) {
  $SelectorArgs += @('--source-lang-quotas', $NativeLangQuotas)
}
if ($CandidateMode -eq 'additional-sense' -and -not [string]::IsNullOrWhiteSpace($AdditionalSenseAttemptIndex)) {
  $SelectorArgs += @('--attempt-index', $ResolvedAttemptIndex)
  # The preselection above binds an exact source sense, so history exclusion is
  # now sense-level. Do not reject a polysemous entry merely because other
  # senses from that entry have already been attempted.
}
& node.exe (Join-Path $Root 'scripts\select-dictionary-v2-source-gap-fresh-cohort.mjs') @SelectorArgs
$SelectorExitCode = $LASTEXITCODE
if (-not (Test-Path -LiteralPath $OutPath)) {
  throw "Candidate selection did not create output; exit code $SelectorExitCode"
}
$SummaryScript = @'
const fs = require('fs');
const batch = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
process.stdout.write(JSON.stringify({
  selected_count: Number(batch.selected_count || 0),
  pool_sha256: batch.pool_sha256 || null,
  history_sha256: batch.excluded_reports?.[0]?.sha256 || null,
  excluded_report_count: batch.excluded_reports?.length || 0,
  selected_by_source_lang: batch.summary?.selected_by_source_lang || {}
}));
'@
$BatchSummaryJson = & node.exe -e $SummaryScript $OutPath
if ($LASTEXITCODE -ne 0) { throw "Candidate output summary failed with exit code $LASTEXITCODE" }
$BatchSummary = $BatchSummaryJson | ConvertFrom-Json
if ([int]$BatchSummary.selected_count -lt 1) {
  [pscustomobject]@{
    Ok = $true
    Status = 'candidate_exhausted'
    Out = $OutPath
    Selected = 0
    Requested = $Limit
    Partial = $true
    SelectorExitCode = $SelectorExitCode
    PoolSha256 = $BatchSummary.pool_sha256
    HistorySha256 = $BatchSummary.history_sha256
    ExcludedReportCount = $BatchSummary.excluded_report_count
    CandidateMode = $CandidateMode
    CoveragePool = $PoolPath
    SelectedBySourceLang = $BatchSummary.selected_by_source_lang
  } | ConvertTo-Json -Depth 6
  exit 0
}
[pscustomobject]@{
  Ok = $true
  Status = 'ready'
  Out = $OutPath
  Selected = $BatchSummary.selected_count
  Requested = $Limit
  Partial = [int]$BatchSummary.selected_count -lt $Limit
  SelectorExitCode = $SelectorExitCode
  PoolSha256 = $BatchSummary.pool_sha256
  HistorySha256 = $BatchSummary.history_sha256
  ExcludedReportCount = $BatchSummary.excluded_report_count
  CandidateMode = $CandidateMode
  CoveragePool = $PoolPath
  SelectedBySourceLang = $BatchSummary.selected_by_source_lang
} | ConvertTo-Json -Depth 6
} finally {
  if ($null -ne $BuildLock) { $BuildLock.Dispose() }
}
