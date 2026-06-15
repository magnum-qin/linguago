param(
  [string]$DbPath = "data/processed/linguago_v2_full.db",
  [string]$OutDir = "output/d1-v2-native-export",
  [string]$DatabaseName = "linguago-dictionary",
  [switch]$SkipExport,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root (Join-Path $OutDir "manifest.json")

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
  & (Join-Path $root "node_modules/.bin/wrangler.cmd") d1 execute $DatabaseName --remote --file $File
  if ($LASTEXITCODE -ne 0) { throw "D1 execute failed for $File" }
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
Invoke-D1File -File (Resolve-ManifestPath $manifest.schema)

foreach ($chunk in $manifest.chunks) {
  Invoke-D1File -File (Resolve-ManifestPath $chunk)
}

Write-Host "D1 native v2 push complete."
