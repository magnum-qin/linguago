param(
  [string]$DbPath = "data/processed/linguago_v2_full.db",
  [string]$DatabaseName = "linguago-dictionary",
  [string]$OutDir = "output/d1-v2-export",
  [int]$ChunkBytes = 7000000,
  [switch]$SkipExport,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir ("d1-push-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

function Write-Log {
  param([string]$Message)
  $line = "{0} {1}" -f (Get-Date -Format o), $Message
  Write-Output $line
  Add-Content -LiteralPath $logPath -Value $line
}

function Get-WranglerCommand {
  $local = Join-Path $root "node_modules\.bin\wrangler.cmd"
  if (Test-Path -LiteralPath $local) { return $local }

  $cmd = Get-Command wrangler.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if ($npx) { return $npx.Source }

  throw "Cannot find wrangler.cmd or npx.cmd. Run npm install first."
}

function Invoke-D1File {
  param([string]$File)

  $wrangler = Get-WranglerCommand
  $relative = Resolve-Path -LiteralPath $File | ForEach-Object { $_.Path }
  Write-Log "d1_execute file=$relative"

  if ($DryRun) { return }

  if ((Split-Path -Leaf $wrangler) -ieq "npx.cmd") {
    & $wrangler wrangler d1 execute $DatabaseName --remote --file $relative
  } else {
    & $wrangler d1 execute $DatabaseName --remote --file $relative
  }

  if ($LASTEXITCODE -ne 0) {
    throw "wrangler d1 execute failed for $relative"
  }
}

function Resolve-ManifestPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) { return $PathValue }
  return Join-Path $root $PathValue
}

Write-Log "started db=$DbPath database=$DatabaseName out_dir=$OutDir dry_run=$DryRun"

if (-not $SkipExport) {
  $exportArgs = @(
    "scripts/export-dictionary-v2-d1-sql.mjs",
    "--db", $DbPath,
    "--out-dir", $OutDir,
    "--chunk-bytes", [string]$ChunkBytes
  )
  Write-Log "export_start"
  node @exportArgs
  if ($LASTEXITCODE -ne 0) { throw "D1 SQL export failed" }
  Write-Log "export_done"
}

$manifestPath = Join-Path $OutDir "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw "Missing D1 export manifest: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
Invoke-D1File -File (Resolve-ManifestPath $manifest.schema)

foreach ($chunk in $manifest.chunks) {
  Invoke-D1File -File (Resolve-ManifestPath $chunk)
}

Write-Log "completed stats=$($manifest.stats | ConvertTo-Json -Compress)"
