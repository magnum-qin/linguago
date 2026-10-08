param(
  [string]$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [string]$Out = 'config\remote-runner-files.json',
  [bool]$PreserveProductDbEntry = $true,
  [string[]]$Paths = @(
    'package.json',
    'package-lock.json',
    'scripts\run-dictionary-v2-remote-pipeline.mjs',
    'scripts\evaluate-dictionary-v2-simplified-draft-flow.mjs',
    'scripts\test-dictionary-v2-pipeline-execution-modes.mjs',
    'scripts\test-simplified-draft-flow-evaluator.mjs',
    'scripts\lib\dictionary-pipeline-stage-recovery.mjs',
    'scripts\lib\run-child-process-with-log.mjs',
    'scripts\lib\unsloth-cluster-discovery.mjs',
    'scripts\check-unsloth-dynamic-pool.mjs',
    'scripts\test-unsloth-cluster-discovery.mjs',
    'scripts\test-dictionary-pipeline-stage-recovery.mjs',
    'scripts\test-run-child-process-with-log.mjs',
    'scripts\find-dictionary-v2-product-coverage-gaps.mjs',
    'scripts\find-dictionary-v2-native-daily-coverage-gaps.mjs',
    'scripts\build-dictionary-v2-source-entry-exclusion-index.mjs',
    'scripts\build-dictionary-v2-final-review-residuals.mjs',
    'scripts\test-dictionary-v2-source-entry-exclusion-index.mjs',
    'scripts\classify-dictionary-v2-native-daily-exclusions.mjs',
    'scripts\merge-dictionary-v2-daily-production-lanes.mjs',
    'scripts\test-dictionary-v2-daily-production-lanes.mjs',
    'scripts\audit-dictionary-v2-daily-candidate-cohort.mjs',
    'scripts\build-remote-dictionary-v219-validation-cohort.ps1',
    'scripts\run-remote-dictionary-v219-source-review.ps1',
    'scripts\filter-dictionary-v2-daily-recovery-candidates.mjs',
    'scripts\lib\daily-candidate-quality.mjs',
    'scripts\test-v219-production-control.mjs',
    'scripts\find-dictionary-v2-product-additional-sense-entries.mjs',
    'scripts\build-dictionary-v2-additional-sense-attempt-index.mjs',
    'scripts\verify-dictionary-v2-residual-exclusion.mjs',
    'scripts\select-dictionary-v2-frozen-consensus-replacements.mjs',
    'scripts\merge-dictionary-v2-selected-reports.mjs',
    'scripts\build-dictionary-v2-generated-target-term-acquisition-input.mjs',
    'scripts\suggest-dictionary-v2-product-target-terms-unsloth.mjs',
    'scripts\validate-dictionary-v2-product-target-term-suggestions.mjs',
    'scripts\apply-dictionary-v2-product-target-term-repair-report.mjs',
    'scripts\test-apply-target-term-repair-report.mjs',
    'scripts\probe-dicionario-aberto-target-terms.mjs',
    'scripts\review-dicionario-aberto-definitions-unsloth.mjs',
    'scripts\merge-dictionary-v2-review-reports.mjs',
    'scripts\export-dicionario-aberto-reviewed-evidence.mjs',
    'scripts\test-dictionary-v2-additional-sense-attempt-index.mjs',
    'scripts\select-dictionary-v2-product-daily-primary-senses.mjs',
    'scripts\test-dictionary-v2-additional-sense-selection.mjs',
    'scripts\build-dictionary-v2-additional-sense-recovery-pool.mjs',
    'scripts\test-dictionary-v2-additional-sense-recovery-pool.mjs',
    'scripts\align-dictionary-v2-product-source-gap-candidate-senses.mjs',
    'scripts\build-dictionary-v2-native-alignment-retry-cohort.mjs',
    'scripts\report-dictionary-v2-remote-production-funnel.mjs',
    'scripts\test-remote-production-funnel-report.mjs',
    'scripts\report-dictionary-v2-release-cohort.mjs',
    'scripts\test-dictionary-v2-release-cohort.mjs',
    'scripts\check-dictionary-v2-production-run-gates.mjs',
    'scripts\audit-dictionary-v2-production-cadence.mjs',
    'scripts\test-dictionary-v2-production-cadence-audit.mjs',
    'scripts\test-remote-production-supervisor-order.mjs',
    'scripts\report-dictionary-v2-production-progress.mjs',
    'scripts\test-dictionary-v2-production-progress-report.mjs',
    'scripts\test-dictionary-v2-production-run-gates.mjs',
    'scripts\test-remote-dictionary-production-gate-continuation.mjs',
    'scripts\complete-remote-dictionary-production-run.ps1',
    'scripts\run-remote-dictionary-production-until-release.ps1',
    'scripts\start-remote-dictionary-release-cohort-production.ps1',
    'scripts\start-remote-dictionary-production-supervisor.ps1',
    'scripts\filter-dictionary-v2-production-batch.mjs',
    'scripts\test-dictionary-v2-production-batch-filter.mjs',
    'scripts\review-dictionary-v2-product-source-gap-candidates-unsloth.mjs',
    'scripts\validate-dictionary-v2-product-source-gap-reverse-evidence.mjs',
    'scripts\build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs',
    'scripts\build-dictionary-v2-source-gap-semantic-preview.mjs',
    'scripts\review-dictionary-v2-product-source-gap-consensus-unsloth.mjs',
    'scripts\report-dictionary-v2-localized-sense-isolation-risk.mjs',
    'scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs',
    'scripts\lib\localized-sense-review-contract.mjs',
    'scripts\test-localized-sense-review-contract.mjs',
    'scripts\run-remote-localized-sense-review.ps1',
    'scripts\run-remote-localized-sense-review-job.ps1',
    'scripts\start-remote-localized-sense-review.ps1',
    'scripts\run-remote-localized-sense-fixed-calibration.ps1',
    'scripts\adjudicate-dictionary-v2-localized-sense-reviews.mjs',
    'scripts\create-localized-sense-consensus-repair-plan.mjs',
    'scripts\discover-localized-sense-repair-evidence.mjs',
    'scripts\create-localized-sense-repair-source-link-plan.mjs',
    'scripts\apply-localized-sense-repair-source-link-plan.mjs',
    'scripts\build-localized-sense-repair-evidence.mjs',
    'scripts\propose-localized-sense-repair-patches-unsloth.mjs',
    'scripts\create-localized-sense-exact-repair-plan.mjs',
    'scripts\apply-localized-sense-exact-repair-plan.mjs',
    'scripts\test-localized-sense-exact-repair-plan.mjs',
    'scripts\create-localized-sense-review-human-label-set.mjs',
    'scripts\score-localized-sense-review-human-labels.mjs',
    'scripts\select-dictionary-v2-source-gap-candidates-by-review.mjs',
    'scripts\filter-dictionary-v2-source-gap-jmdict-generation-preflight.mjs',
    'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    'scripts\invoke-dictionary-control.ps1',
    'scripts\manage-remote-dictionary-runner.ps1',
    'scripts\set-remote-dictionary-task-credential.ps1',
    'scripts\run-remote-dictionary-runner-job.ps1',
    'scripts\verify-remote-dictionary-runner.ps1',
    'scripts\watch-remote-dictionary-runner.ps1',
    'scripts\manage-remote-dictionary-watchdog.ps1',
    'scripts\test-remote-dictionary-watchdog.ps1',
    'scripts\new-remote-dictionary-runner-manifest.ps1',
    'scripts\validate-remote-dictionary-controlled-replay.ps1',
    'scripts\build-dictionary-v2-historical-draft-recovery-scope.mjs',
    'scripts\merge-dictionary-v2-historical-controlled-apply-reports.mjs',
    'scripts\publish-remote-dictionary-controlled-run.ps1',
    'scripts\publish-remote-dictionary-manual-override.ps1',
    'scripts\checkpoint-sqlite-db.mjs',
    'scripts\fingerprint-sqlite-logical.mjs',
    'scripts\check-remote-cloudflare-auth.ps1',
    'scripts\release-remote-dictionary-d1.ps1',
    'scripts\new-dictionary-maintenance-release-report.ps1',
    'scripts\complete-remote-dictionary-maintenance-run.ps1',
    'scripts\apply-remote-dictionary-maintenance-overrides.ps1',
    'scripts\rebase-remote-dictionary-controlled-runs.ps1',
    'scripts\push-dictionary-v2-native-to-d1.ps1',
  'scripts\stage-remote-worker-source.ps1',
  'scripts\deploy-remote-worker-release.ps1',
    'scripts\new-remote-dictionary-production-batch.ps1',
    'scripts\select-dictionary-v2-source-gap-fresh-cohort.mjs',
    'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs',
    'scripts\audit-dictionary-v2-product-export.mjs',
    'scripts\audit-dictionary-v2-product-published-risk.mjs',
    'scripts\audit-dictionary-v2-product-mainland-chinese.mjs',
    'scripts\create-dictionary-v2-product-mainland-chinese-plan.mjs',
    'scripts\apply-dictionary-v2-product-mainland-chinese-plan.mjs',
    'scripts\test-dictionary-v2-product-mainland-chinese-plan.mjs',
    'scripts\test-worker-dictionary-localized-term-filter.mjs',
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
