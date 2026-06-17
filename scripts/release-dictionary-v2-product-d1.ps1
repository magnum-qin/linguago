param(
  [string]$DbPath = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db",
  [string]$OutDir = "outputs/d1-v2-product-native-export",
  [string]$DatabaseName = "linguago-dictionary",
  [switch]$SkipPush,
  [switch]$SkipOnlineUi,
  [switch]$SkipTypecheck
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )
  Write-Host ""
  Write-Host "==> $Name"
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Name"
  }
}

Set-Location $root

Invoke-Step "Clean duplicate product examples" {
  & npm.cmd run dict:v2:clean:product-examples
}

Invoke-Step "Repair deterministic product quality warnings" {
  & npm.cmd run dict:v2:repair:product-quality-warnings
}

Invoke-Step "Export product D1 native SQL" {
  & npm.cmd run dict:v2:export:product-d1-native
}

Invoke-Step "Audit product D1 native export" {
  & npm.cmd run dict:v2:audit:product-export
}

if (-not $SkipTypecheck) {
  Invoke-Step "TypeScript check" {
    & npm.cmd run check
  }
}

if (-not $SkipPush) {
  Invoke-Step "Push product export to Cloudflare D1" {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/push-dictionary-v2-native-to-d1.ps1") -SkipExport -OutDir $OutDir -DatabaseName $DatabaseName
  }
}

if (-not $SkipOnlineUi) {
  Invoke-Step "Online UI smoke" {
    & npm.cmd run check:online-ui
  }
}

Write-Host ""
Write-Host "Product D1 release pipeline complete."
