param(
  [string]$Root = 'D:\linguago-runner',
  [int]$Limit = 100,
  [string]$Out = '',
  [string]$Pool = 'data\candidates\v123-authoritative-pool.json',
  [string]$History = 'data\candidates\v123-attempted-source-history.json',
  [switch]$IncludeCompletedRunBatches = $true,
  [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
if ($Limit -lt 1 -or $Limit -gt 5000) { throw 'Limit must be between 1 and 5000' }
$Root = [IO.Path]::GetFullPath($Root)
if (-not $SkipVerify) {
  & (Join-Path $Root 'scripts\verify-remote-dictionary-runner.ps1') -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Remote runner verification failed' }
}

$PoolPath = [IO.Path]::GetFullPath((Join-Path $Root $Pool))
$HistoryPath = [IO.Path]::GetFullPath((Join-Path $Root $History))
$ProductDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
foreach ($Path in @($PoolPath, $HistoryPath, $ProductDb)) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required input not found: $Path" }
}

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
  --one-per-source-entry true `
  --exclude-source-entries true `
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
  SelectedBySourceLang = $Batch.summary.selected_by_source_lang
} | ConvertTo-Json -Depth 6
