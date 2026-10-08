param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$BaseDb,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under the runner root'
}
if (-not (Test-Path -LiteralPath $RunDir)) { throw "Run not found: $RunDir" }

$BaseDbPath = [IO.Path]::GetFullPath((Join-Path $Root $BaseDb))
$MainDbPath = [IO.Path]::GetFullPath((Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'))
if ($BaseDbPath -eq $MainDbPath) {
  throw 'Refusing to use the main product database as the isolated validation target'
}
if (-not (Test-Path -LiteralPath $BaseDbPath)) { throw "Base DB not found: $BaseDbPath" }

$IsolatedDb = Join-Path $RunDir 'isolated-controlled-replay.db'
if (Test-Path -LiteralPath $IsolatedDb) {
  if (-not $Force) { throw "Isolated DB already exists: $IsolatedDb (use -Force to replace it)" }
  Remove-Item -LiteralPath $IsolatedDb -Force
}
Copy-Item -LiteralPath $BaseDbPath -Destination $IsolatedDb

function Invoke-Node([string]$Script, [string[]]$Arguments) {
  & node.exe (Join-Path $Root $Script) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed with exit code $LASTEXITCODE" }
}

$GenerationReady = Join-Path $RunDir '04f-generation-ready-candidates.json'
$Generation = Join-Path $RunDir '05-qwen-generation.json'
$Reverse = Join-Path $RunDir '06-reverse-evidence.json'
$Consensus = Join-Path $RunDir '07-final-gemma.json'
$Controlled = Join-Path $RunDir '08-controlled-replay.json'
$PromoteScope = Join-Path $RunDir '08b-controlled-promote-scope.json'
$HistoricalNewControlled = Join-Path $RunDir '08c-historical-new-draft-replay.json'
$HistoricalExistingApply = Join-Path $RunDir '09a-historical-existing-draft-scope.json'
$HistoricalExistingIdempotent = Join-Path $RunDir '10a-historical-existing-draft-idempotent.json'
$HistoricalNewApply = Join-Path $RunDir '09b-historical-new-draft-apply.json'
$HistoricalNewIdempotent = Join-Path $RunDir '10b-historical-new-draft-idempotent.json'
$ApplyReport = Join-Path $RunDir '09-isolated-controlled-apply.json'
$IdempotentReport = Join-Path $RunDir '10-isolated-controlled-idempotent.json'
$PromoteDry = Join-Path $RunDir '11-isolated-promote-dry-run.json'
$PromoteApply = Join-Path $RunDir '12-isolated-promote-apply.json'
$RiskReport = Join-Path $RunDir '14-isolated-published-risk.json'
$ExportDir = Join-Path $RunDir '15-isolated-full-audit'

foreach ($Path in @($GenerationReady, $Generation, $Reverse, $Consensus)) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required run report not found: $Path" }
}

$GenerationReadyReport = [IO.File]::ReadAllText($GenerationReady, [Text.Encoding]::UTF8) | ConvertFrom-Json
$GenerationReport = [IO.File]::ReadAllText($Generation, [Text.Encoding]::UTF8) | ConvertFrom-Json
$DraftProductionWritesExist = [bool]$GenerationReport.stats.apply -and
  -not [bool]$GenerationReport.stats.publishable -and
  [int64]$GenerationReport.stats.senses_inserted -gt 0
$HistoricalDraftRecovery = [bool]$GenerationReadyReport.selection_policy.historical_current_contract_recovery -or
  ([string]$GenerationReadyReport.selection_policy.lane -eq 'historical_current-contract_recovery') -or
  $DraftProductionWritesExist

Invoke-Node 'scripts\build-dictionary-v2-product-source-gap-controlled-consensus-input.mjs' @(
  '--review', $GenerationReady, '--generation', $Generation, '--evidence', $Reverse,
  '--consensus', $Consensus, '--out', $Controlled
)

$ReplayArgs = @(
  '--db', $IsolatedDb, '--report', $Controlled, '--replay-report', $Controlled,
  '--controlled-consensus-draft-write', 'true', '--limit', '1000000',
  '--apply', 'true', '--dry-run', 'false', '--publishable', 'false',
  '--skip-existing-drafts', 'true', '--deterministic-readings', 'true',
  '--deterministic-pronunciations', 'true',
  '--jmdict', (Join-Path $Root 'data\raw\JMdict_e.gz'),
  '--source-db', (Join-Path $Root 'data\processed\linguago_v2_full.db'),
  '--pt-pronunciation-db', (Join-Path $Root 'data\processed\kaikki_portuguese_pronunciations.db')
)
if ($HistoricalDraftRecovery) {
  Invoke-Node 'scripts\build-dictionary-v2-historical-draft-recovery-scope.mjs' @(
    '--db', $IsolatedDb, '--controlled', $Controlled, '--out', $PromoteScope,
    '--apply-out', $HistoricalExistingApply, '--idempotent-out', $HistoricalExistingIdempotent,
    '--new-controlled-out', $HistoricalNewControlled
  )
  $HistoricalNewReport = [IO.File]::ReadAllText($HistoricalNewControlled, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if ([int64]$HistoricalNewReport.selected_count -gt 0) {
    $HistoricalReplayArgs = @($ReplayArgs)
    for ($Index = 0; $Index -lt $HistoricalReplayArgs.Count; $Index++) {
      if ($HistoricalReplayArgs[$Index] -eq '--report' -or $HistoricalReplayArgs[$Index] -eq '--replay-report') {
        $HistoricalReplayArgs[$Index + 1] = $HistoricalNewControlled
      }
    }
    Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' ($HistoricalReplayArgs + @('--out', $HistoricalNewApply))
    Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' ($HistoricalReplayArgs + @('--out', $HistoricalNewIdempotent))
  } else {
    Copy-Item -LiteralPath $HistoricalExistingIdempotent -Destination $HistoricalNewApply -Force
    Copy-Item -LiteralPath $HistoricalExistingIdempotent -Destination $HistoricalNewIdempotent -Force
  }
  Invoke-Node 'scripts\merge-dictionary-v2-historical-controlled-apply-reports.mjs' @(
    '--existing', $HistoricalExistingApply, '--inserted', $HistoricalNewApply, '--out', $ApplyReport
  )
  Invoke-Node 'scripts\merge-dictionary-v2-historical-controlled-apply-reports.mjs' @(
    '--existing', $HistoricalExistingIdempotent, '--inserted', $HistoricalNewIdempotent, '--out', $IdempotentReport
  )
  Invoke-Node 'scripts\filter-dictionary-v2-controlled-replay-to-writes.mjs' @(
    '--controlled', $Controlled, '--apply', $ApplyReport, '--out', $PromoteScope
  )
} else {
  Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' ($ReplayArgs + @('--out', $ApplyReport))
  Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' ($ReplayArgs + @('--out', $IdempotentReport))
  Invoke-Node 'scripts\filter-dictionary-v2-controlled-replay-to-writes.mjs' @(
    '--controlled', $Controlled, '--apply', $ApplyReport, '--out', $PromoteScope
  )
}

$PromoteArgs = @(
  '--db', $IsolatedDb, '--limit', '1000000', '--report', $PromoteScope,
  '--restrict-to-report', 'true', '--semantic-review', $Consensus,
  '--reverse-evidence', $Reverse, '--verification-level', 'ai_reviewed',
  '--review-model', 'gemma-4-31b-independent-review',
  '--evidence-families', 'locked-local-dictionary-evidence,qwen-generation,gemma-independent-review'
)
Invoke-Node 'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs' ($PromoteArgs + @('--apply', 'false', '--out', $PromoteDry))
Invoke-Node 'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs' ($PromoteArgs + @('--apply', 'true', '--out', $PromoteApply))
Invoke-Node 'scripts\checkpoint-sqlite-db.mjs' @('--db', $IsolatedDb)
$FastAuditSucceeded = $false
for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
  & node.exe (Join-Path $Root 'scripts\audit-dictionary-v2-product-export.mjs') '--db' $IsolatedDb '--mode' 'fast'
  if ($LASTEXITCODE -eq 0) {
    $FastAuditSucceeded = $true
    break
  }
  if ($Attempt -lt 2) {
    Start-Sleep -Seconds 3
    Invoke-Node 'scripts\checkpoint-sqlite-db.mjs' @('--db', $IsolatedDb)
  }
}
if (-not $FastAuditSucceeded) { throw 'Fast isolated export audit failed after 2 attempts' }
Invoke-Node 'scripts\audit-dictionary-v2-product-published-risk.mjs' @('--db', $IsolatedDb, '--out', $RiskReport)
Invoke-Node 'scripts\export-dictionary-v2-product-native-d1-sql.mjs' @(
  '--db', $IsolatedDb, '--out-dir', $ExportDir,
  '--entry-form-aliases', (Join-Path $Root 'config\dictionary-overrides\product-entry-form-aliases.json')
)
Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @(
  '--db', $IsolatedDb, '--mode', 'full', '--import', 'memory', '--out-dir', $ExportDir
)

$Apply = [IO.File]::ReadAllText($ApplyReport, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Idempotent = [IO.File]::ReadAllText($IdempotentReport, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Promoted = [IO.File]::ReadAllText($PromoteApply, [Text.Encoding]::UTF8) | ConvertFrom-Json
if ($Idempotent.stats.senses_inserted -ne 0 -or $Idempotent.stats.localizations_upserted -ne 0) {
  throw 'Controlled replay is not idempotent'
}

[pscustomobject]@{
  Ok = $true
  RunId = $RunId
  IsolatedDb = $IsolatedDb
  DraftSensesInserted = $Apply.stats.senses_inserted
  IdempotentReplaySenseWrites = $Idempotent.stats.senses_inserted
  SensesPromoted = $Promoted.stats.senses_promoted
  FullAuditDir = $ExportDir
} | ConvertTo-Json -Depth 4
