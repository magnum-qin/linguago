param(
  [string]$Root = 'D:\linguago-runner',
  [string]$DbPath = 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db',
  [string]$OutDir = '',
  [string]$DatabaseName = 'linguago-dictionary',
  [int]$MaxAttempts = 3
)

# Incremental examples push: reads the current D1 watermarks (two O(1)
# MAX(rowid) queries), exports only newer local rows, pushes the small chunk,
# and verifies by MAX(rowid) equality. Total D1 row reads are O(10), which is
# what keeps daily releases inside the free-tier quota.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ResolvedDb = if ([IO.Path]::IsPathRooted($DbPath)) { $DbPath } else { Join-Path $Root $DbPath }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$ResolvedOutDir = if ($OutDir) { $OutDir } else { Join-Path $Root "state\examples\d1-incremental-$Stamp" }
$Wrangler = Join-Path $Root 'node_modules\.bin\wrangler.cmd'

function Invoke-D1Json([string]$Sql) {
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $raw = & $Wrangler d1 execute $DatabaseName --remote --json --command $Sql 2>&1
    if ($LASTEXITCODE -eq 0) {
      $text = @($raw) -join "`n"
      $start = $text.IndexOf('[')
      if ($start -ge 0) { return ($text.Substring($start) | ConvertFrom-Json) }
    }
    $text = @($raw) -join "`n"
    if ($text -match 'row read limit|exceeded.*free tier') {
      throw 'D1 free-tier quota exhausted; incremental push aborted before any writes'
    }
    if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds (2 * $attempt) }
  }
  throw "D1 query failed after $MaxAttempts attempts: $Sql"
}

$watermarkRaw = Invoke-D1Json 'SELECT (SELECT IFNULL(MAX(rowid), 0) FROM v2_examples) ex, (SELECT IFNULL(MAX(rowid), 0) FROM v2_example_localizations) exl;'
$watermark = @($watermarkRaw)[0].results[0]
$SinceExampleId = [int64]$watermark.ex
$SinceLocalizationId = [int64]$watermark.exl
Write-Host "D1 watermarks: examples=$SinceExampleId localizations=$SinceLocalizationId"

& node (Join-Path $Root 'scripts\export-dictionary-v2-product-examples-incremental.mjs') `
  --db $ResolvedDb `
  --out-dir $ResolvedOutDir `
  --since-example-id $SinceExampleId `
  --since-localization-id $SinceLocalizationId
if ($LASTEXITCODE -ne 0) { throw 'Incremental export failed' }

$ManifestPath = Join-Path $ResolvedOutDir 'manifest.json'
$Manifest = [IO.File]::ReadAllText($ManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ([int64]$Manifest.stats.examples -eq 0 -and [int64]$Manifest.stats.example_localizations -eq 0) {
  Write-Host 'Nothing new to push.'
  $Manifest | ConvertTo-Json -Depth 6
  return
}

# Execute the incremental chunk directly; the generic push script's
# seven-table count verification does not fit an examples-only manifest.
$PushFiles = @()
if ($Manifest.schema) { $PushFiles += (Join-Path $Root ([string]$Manifest.schema)) }
foreach ($Chunk in @($Manifest.chunks)) { $PushFiles += (Join-Path $Root ([string]$Chunk)) }
foreach ($File in $PushFiles) {
  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    & $Wrangler d1 execute $DatabaseName --remote --file $File 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds (2 * $attempt) }
  }
  if ($LASTEXITCODE -ne 0) { throw "Incremental chunk execution failed: $File" }
}

$verifyRaw = Invoke-D1Json 'SELECT (SELECT IFNULL(MAX(rowid), 0) FROM v2_examples) ex, (SELECT IFNULL(MAX(rowid), 0) FROM v2_example_localizations) exl;'
$verify = @($verifyRaw)[0].results[0]
$expectedEx = if ($null -ne $Manifest.stats.max_example_id) { [int64]$Manifest.stats.max_example_id } else { $SinceExampleId }
$expectedExl = if ($null -ne $Manifest.stats.max_localization_id) { [int64]$Manifest.stats.max_localization_id } else { $SinceLocalizationId }
if ([int64]$verify.ex -ne $expectedEx -or [int64]$verify.exl -ne $expectedExl) {
  throw "Incremental verification mismatch: examples $($verify.ex)/$expectedEx localizations $($verify.exl)/$expectedExl"
}
Write-Host "Incremental push verified: examples=$($verify.ex) localizations=$($verify.exl) (added $($Manifest.stats.examples)/$($Manifest.stats.example_localizations))"

[pscustomobject]@{
  Ok = $true
  OutDir = $ResolvedOutDir
  AddedExamples = [int64]$Manifest.stats.examples
  AddedLocalizations = [int64]$Manifest.stats.example_localizations
  MaxExampleId = $expectedEx
  MaxLocalizationId = $expectedExl
} | ConvertTo-Json -Depth 4
