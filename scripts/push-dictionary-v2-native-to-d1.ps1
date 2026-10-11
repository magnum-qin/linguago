param(
  [string]$DbPath = "data/processed/linguago_v2_full.db",
  [string]$OutDir = "output/d1-v2-native-export",
  [string]$DatabaseName = "linguago-dictionary",
  [int]$MaxAttempts = 3,
  [switch]$SkipExport,
  [switch]$VerifyOnly,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$resolvedOutDir = if ([System.IO.Path]::IsPathRooted($OutDir)) {
  $OutDir
} else {
  Join-Path $root $OutDir
}
$manifestPath = Join-Path $resolvedOutDir "manifest.json"

function Resolve-ManifestPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path $root $PathValue
}

function Invoke-D1File {
  param([string]$File)
  if ($DryRun) {
    Write-Host "[dry-run] wrangler d1 execute $DatabaseName --remote --file $File"
    return
  }
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    & (Join-Path $root "node_modules/.bin/wrangler.cmd") d1 execute $DatabaseName --remote --file $File
    if ($LASTEXITCODE -eq 0) { return }
    if ($attempt -lt $MaxAttempts) {
      Write-Warning "D1 execute failed for $File (attempt $attempt/$MaxAttempts); retrying."
      Start-Sleep -Seconds ([Math]::Min(10, 2 * $attempt))
    }
  }
  throw "D1 execute failed for $File after $MaxAttempts attempts"
}

function Assert-RemoteCounts {
  param([object]$Stats)

  # MAX(rowid) is O(1) via the primary key index; COUNT(*) scans the full
  # B-tree and burns D1 free-tier row-read quota (~750K rows per call).
  # Fresh imports produce sequential rowids, so MAX(rowid) == COUNT(*).
  # If MAX mismatches (non-fresh table), falls back to COUNT for that table.
  $tables = [ordered]@{
    entries = "v2_entries"
    entry_forms = "v2_entry_forms"
    pronunciation_groups = "v2_pronunciation_groups"
    senses = "v2_senses"
    sense_localizations = "v2_sense_localizations"
    examples = "v2_examples"
    example_localizations = "v2_example_localizations"
  }
  $columns = @()
  foreach ($item in $tables.GetEnumerator()) {
    $columns += "(SELECT IFNULL(MAX(rowid), 0) FROM $($item.Value)) AS max_$($item.Key)"
  }
  $sql = "SELECT $($columns -join ', ');"
  $raw = $null
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $raw = & (Join-Path $root "node_modules/.bin/wrangler.cmd") d1 execute $DatabaseName --remote --command $sql --json
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -lt $MaxAttempts) {
      Write-Warning "Remote D1 verification failed (attempt $attempt/$MaxAttempts); retrying."
      Start-Sleep -Seconds ([Math]::Min(10, 2 * $attempt))
    }
  }
  if ($LASTEXITCODE -ne 0) { throw "Remote D1 verification failed after $MaxAttempts attempts" }
  $response = $raw | ConvertFrom-Json
  $actual = $response[0].results[0]
  $needFallback = @()
  foreach ($name in $tables.Keys) {
    $expectedCount = [int64]$Stats.$name
    $maxId = [int64]($actual.("max_$name"))
    if ($maxId -eq $expectedCount) { continue }
    $needFallback += $name
  }
  if ($needFallback.Count -eq 0) {
    Write-Host "Remote D1 counts match manifest (MAX(rowid) fast path)."
    return
  }
  # Fallback: verify only mismatched tables with COUNT (quota-capped scope)
  Write-Warning "MAX(rowid) mismatch for [$($needFallback -join ', ')]; falling back to COUNT for those tables."
  $fbColumns = @()
  foreach ($name in $needFallback) {
    $fbColumns += "(SELECT COUNT(*) FROM $($tables[$name])) AS cnt_$name"
  }
  $fbSql = "SELECT $($fbColumns -join ', ');"
  $fbRaw = & (Join-Path $root "node_modules/.bin/wrangler.cmd") d1 execute $DatabaseName --remote --command $fbSql --json
  if ($LASTEXITCODE -ne 0) { throw "Remote D1 COUNT fallback failed" }
  $fbResponse = $fbRaw | ConvertFrom-Json
  $fbActual = $fbResponse[0].results[0]
  foreach ($name in $needFallback) {
    $expectedCount = [int64]$Stats.$name
    $actualCount = [int64]($fbActual.("cnt_$name"))
    if ($actualCount -ne $expectedCount) {
      throw "Remote D1 count mismatch for ${name}: expected=$expectedCount actual=$actualCount"
    }
  }
  Write-Host "Remote D1 counts match manifest (COUNT fallback)."
}

if (-not $SkipExport) {
  $args = @(
    "scripts/export-dictionary-v2-native-d1-sql.mjs",
    "--db", $DbPath,
    "--out-dir", $OutDir
  )
  & node @args
  if ($LASTEXITCODE -ne 0) { throw "D1 native SQL export failed" }
}

if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing D1 native export manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($VerifyOnly) {
  Assert-RemoteCounts -Stats $manifest.stats
  Write-Host "Remote D1 verification complete."
  exit 0
}

Invoke-D1File -File (Resolve-ManifestPath $manifest.schema)

foreach ($chunk in $manifest.chunks) {
  Invoke-D1File -File (Resolve-ManifestPath $chunk)
}

if (-not $DryRun) {
  Assert-RemoteCounts -Stats $manifest.stats
}

Write-Host "D1 native v2 push complete."
