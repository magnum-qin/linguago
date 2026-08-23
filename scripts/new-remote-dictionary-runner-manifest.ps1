param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Out = 'config\remote-runner-files.json',
  [bool]$PreserveProductDbEntry = $true,
  [string[]]$Paths = @(
    'package.json',
    'package-lock.json',
    'scripts\run-dictionary-v2-remote-pipeline.mjs',
    'scripts\lib\dictionary-pipeline-stage-recovery.mjs',
    'scripts\lib\unsloth-cluster-discovery.mjs',
    'scripts\check-unsloth-dynamic-pool.mjs',
    'scripts\test-unsloth-cluster-discovery.mjs',
    'scripts\test-dictionary-pipeline-stage-recovery.mjs',
    'scripts\find-dictionary-v2-product-coverage-gaps.mjs',
    'scripts\find-dictionary-v2-native-daily-coverage-gaps.mjs',
    'scripts\align-dictionary-v2-product-source-gap-candidate-senses.mjs',
    'scripts\build-dictionary-v2-native-alignment-retry-cohort.mjs',
    'scripts\report-dictionary-v2-remote-production-funnel.mjs',
    'scripts\test-remote-production-funnel-report.mjs',
    'scripts\report-dictionary-v2-release-cohort.mjs',
    'scripts\test-dictionary-v2-release-cohort.mjs',
    'scripts\check-dictionary-v2-production-run-gates.mjs',
    'scripts\complete-remote-dictionary-production-run.ps1',
    'scripts\start-remote-dictionary-production-supervisor.ps1',
    'scripts\filter-dictionary-v2-production-batch.mjs',
    'scripts\review-dictionary-v2-product-source-gap-candidates-unsloth.mjs',
    'scripts\validate-dictionary-v2-product-source-gap-reverse-evidence.mjs',
    'scripts\build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    'scripts\build-dictionary-v2-source-gap-semantic-preview.mjs',
    'scripts\review-dictionary-v2-product-source-gap-consensus-unsloth.mjs',
    'scripts\select-dictionary-v2-source-gap-candidates-by-review.mjs',
    'scripts\filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs',
    'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    'scripts\invoke-dictionary-control.ps1',
    'scripts\manage-remote-dictionary-runner.ps1',
    'scripts\run-remote-dictionary-runner-job.ps1',
    'scripts\verify-remote-dictionary-runner.ps1',
    'scripts\watch-remote-dictionary-runner.ps1',
    'scripts\manage-remote-dictionary-watchdog.ps1',
    'scripts\test-remote-dictionary-watchdog.ps1',
    'scripts\new-remote-dictionary-runner-manifest.ps1',
    'scripts\validate-remote-dictionary-controlled-replay.ps1',
    'scripts\publish-remote-dictionary-controlled-run.ps1',
    'scripts\checkpoint-sqlite-db.mjs',
    'scripts\check-remote-cloudflare-auth.ps1',
    'scripts\release-remote-dictionary-d1.ps1',
    'scripts\push-dictionary-v2-native-to-d1.ps1',
  'scripts\stage-remote-worker-source.ps1',
  'scripts\deploy-remote-worker-release.ps1',
    'scripts\new-remote-dictionary-production-batch.ps1',
    'scripts\select-dictionary-v2-source-gap-fresh-cohort.mjs',
    'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs',
    'scripts\audit-dictionary-v2-product-export.mjs',
    'scripts\audit-dictionary-v2-product-published-risk.mjs',
    'scripts\export-dictionary-v2-product-native-d1-sql.mjs',
    'config\dictionary-v2-production-v139.json',
    'config\dictionary-v2-online-baseline.json',
    'config\dictionary-overrides\product-entry-form-aliases.json',
    'config\remote-candidate-sources.json',
    '.tmp\combined\openwn-word2word3-ja-apertium-wikidata-v3-evidence.db',
    'data\raw\JMdict_e.gz',
    'data\processed\kaikki_portuguese_pronunciations.db',
    'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
  )
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$OutPath = [IO.Path]::GetFullPath((Join-Path $Root $Out))
$ExistingManifest = if ($PreserveProductDbEntry -and (Test-Path -LiteralPath $OutPath)) {
  Get-Content -LiteralPath $OutPath -Raw | ConvertFrom-Json
} else { $null }
$ProductDbRelativePath = 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$ExistingProductDbEntry = @($ExistingManifest.files) |
  Where-Object { [string]$_.path -eq $ProductDbRelativePath } |
  Select-Object -First 1
$Files = foreach ($RelativePath in $Paths) {
  $Path = [IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  if (-not $Path.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes runner root: $RelativePath"
  }
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required runner file not found: $Path" }
  if ($RelativePath -eq $ProductDbRelativePath -and $null -ne $ExistingProductDbEntry) {
    [ordered]@{
      path = $RelativePath
      bytes = [long]$ExistingProductDbEntry.bytes
      sha256 = [string]$ExistingProductDbEntry.sha256
    }
  } else {
    $Item = Get-Item -LiteralPath $Path
    [ordered]@{
      path = $RelativePath
      bytes = $Item.Length
      sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    }
  }
}
$Manifest = [ordered]@{
  version = 1
  generated_at = [DateTime]::UtcNow.ToString('o')
  root = $Root
  files = @($Files)
}
New-Item -ItemType Directory -Path (Split-Path -Parent $OutPath) -Force | Out-Null
$Manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $OutPath -Encoding UTF8
Write-Output $OutPath
