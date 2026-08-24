param(
  [string]$Root = 'D:\linguago-runner',
  [int]$Limit = 100,
  [string]$Out = '',
  [ValidateSet('authoritative-pool', 'native-daily')]
  [string]$CandidateMode = 'native-daily',
  [string]$Pool = 'data\candidates\v123-authoritative-pool.json',
  [string]$History = 'data\candidates\v123-attempted-source-history.json',
  [int]$NativeMaxRank = 2000000,
  [int]$NativeScanLimit = 2000000,
  [string]$NativeTargets = 'zh=30000,ja=10000,pt-BR=5000,en=5000',
  [string]$NativeLangQuotas = '',
  [bool]$ExcludePreviouslyAttemptedSourceEntries = $true,
  [switch]$IncludeCompletedRunBatches = $true,
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
    --out $PoolPath
  if ($LASTEXITCODE -ne 0) { throw "Native coverage scan failed with exit code $LASTEXITCODE" }
}

$ExcludePaths = [Collections.Generic.List[string]]::new()
$ExcludePaths.Add($HistoryPath)
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
        if (Test-Path -LiteralPath $CompletedBatchPath) { $ExcludePaths.Add($CompletedBatchPath) }
      } catch {
        Write-Warning "Ignoring unreadable completed-run manifest: $($ManifestPath.FullName)"
      }
    }
  }
}
$ExcludePaths = @($ExcludePaths | Sort-Object -Unique)
$ExcludeArgument = $ExcludePaths -join ','

& node.exe (Join-Path $Root 'scripts\select-dictionary-v2-source-gap-fresh-cohort.mjs') `
  --pool $PoolPath `
  --exclude $ExcludeArgument `
  --product-db $ProductDb `
  --limit $Limit `
  --source-lang-quotas $NativeLangQuotas `
  --one-per-source-entry true `
  --exclude-source-entries $($ExcludePreviouslyAttemptedSourceEntries.ToString().ToLowerInvariant()) `
  --out $OutPath
if ($LASTEXITCODE -ne 0) { throw "Candidate selection failed with exit code $LASTEXITCODE" }

$Batch = [IO.File]::ReadAllText($OutPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
[pscustomobject]@{
  Ok = $true
  Out = $OutPath
  Selected = $Batch.selected_count
  PoolSha256 = $Batch.pool_sha256
  HistorySha256 = $Batch.excluded_reports[0].sha256
  ExcludedReportCount = @($Batch.excluded_reports).Count
  CandidateMode = $CandidateMode
  CoveragePool = $PoolPath
  SelectedBySourceLang = $Batch.summary.selected_by_source_lang
} | ConvertTo-Json -Depth 6
} finally {
  if ($null -ne $BuildLock) { $BuildLock.Dispose() }
}
