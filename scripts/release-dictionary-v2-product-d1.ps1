param(
  [string]$DbPath = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db",
  [string]$OutDir = "outputs/d1-v2-product-native-export-latest",
  [string]$DatabaseName = "linguago-dictionary",
  [switch]$SkipPush,
  [switch]$SkipDeploy,
  [switch]$SkipOnlineChecks,
  [switch]$SkipTypecheck,
  [switch]$SkipSimplifyZhExamples,
  [string]$AuditSamples = ""
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
if ([string]::IsNullOrWhiteSpace($AuditSamples)) {
  $AuditSamples = "hello,$([char]0x4F60)$([char]0x597D),$([char]0x4E2D),although,breaks,cor"
}

if (-not $SkipSimplifyZhExamples) {
  Invoke-Step "Simplify Chinese product examples" {
    & node scripts/simplify-dictionary-v2-product-zh-examples.mjs --db $DbPath
  }
}

Invoke-Step "Product dictionary regression check" {
  & node scripts/dictionary-v2-product-regression-check.mjs --db $DbPath
}

Invoke-Step "Product candidate report" {
  & node scripts/report-dictionary-v2-product-candidate.mjs --db $DbPath
}

Invoke-Step "Export product D1 native SQL" {
  & node scripts/export-dictionary-v2-product-native-d1-sql.mjs --db $DbPath --out-dir $OutDir
}

Invoke-Step "Fast audit product D1 native export" {
  & node scripts/audit-dictionary-v2-product-export-fast.mjs --out-dir $OutDir --samples $AuditSamples
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

if (-not $SkipDeploy) {
  Invoke-Step "Deploy Worker" {
    & npm.cmd run deploy
  }
}

if (-not $SkipOnlineChecks) {
  Invoke-Step "Online dictionary API focused check" {
    & node scripts/online-dictionary-focused-check.mjs
  }

  Invoke-Step "Online dictionary render focused check" {
    & node scripts/online-dictionary-render-focused-check.mjs
  }
}

Write-Host ""
Write-Host "Product D1 release preflight complete."
