param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$BaseDb,
  [Parameter(Mandatory = $true)][string]$ExpectedBaseSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedMainSha256,
  [Parameter(Mandatory = $true)][string[]]$ReplayRunIds
)

$ErrorActionPreference = 'Stop'

function Invoke-Node([string]$Script, [string[]]$Arguments) {
  & node.exe (Join-Path $Root $Script) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed with exit code $LASTEXITCODE" }
}

function Read-Json([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "JSON file not found: $PathValue" }
  return [IO.File]::ReadAllText($PathValue, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
$MainDb = [IO.Path]::GetFullPath((Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'))
$ResolvedBase = if ([IO.Path]::IsPathRooted($BaseDb)) {
  [IO.Path]::GetFullPath($BaseDb)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $BaseDb))
}
$StateDir = Join-Path $Root 'state'
$ReleaseLock = Join-Path $StateDir 'dictionary-release.lock.json'
$ExpectedBase = $ExpectedBaseSha256.Trim().ToUpperInvariant()
$ExpectedMain = $ExpectedMainSha256.Trim().ToUpperInvariant()

if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under runner root'
}
foreach ($PathValue in @($MainDb, $ResolvedBase)) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "Required path not found: $PathValue" }
}
if ((Get-FileHash -LiteralPath $ResolvedBase -Algorithm SHA256).Hash.ToUpperInvariant() -ne $ExpectedBase) {
  throw 'Baseline DB SHA-256 mismatch'
}
if ((Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant() -ne $ExpectedMain) {
  throw 'Main DB SHA-256 mismatch'
}
if (Test-Path -LiteralPath $ReleaseLock) { throw "Release lock already exists: $ReleaseLock" }

New-Item -ItemType Directory -Path $RunDir, $StateDir -Force | Out-Null
[IO.File]::WriteAllText(
  $ReleaseLock,
  ([ordered]@{
    run_id = $RunId
    release_type = 'controlled_run_rebase'
    pid = $PID
    expected_main_sha256 = $ExpectedMain
    expected_base_sha256 = $ExpectedBase
    replay_run_ids = $ReplayRunIds
    started_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 5),
  (New-Object Text.UTF8Encoding($false))
)

try {
  $StagedDb = Join-Path $RunDir 'rebased-staged.db'
  Copy-Item -LiteralPath $ResolvedBase -Destination $StagedDb -Force
  $ReplayResults = @()

  foreach ($ReplayRunId in $ReplayRunIds) {
    $ReplayDir = Join-Path $Root (Join-Path 'runs' $ReplayRunId)
    $Controlled = Join-Path $ReplayDir '08-controlled-replay.json'
    $Consensus = Join-Path $ReplayDir '07-final-gemma.json'
    $Reverse = Join-Path $ReplayDir '06-reverse-evidence.json'
    foreach ($PathValue in @($Controlled, $Consensus, $Reverse)) {
      if (-not (Test-Path -LiteralPath $PathValue)) {
        throw "Required replay report not found: $PathValue"
      }
    }

    $ApplyReport = Join-Path $RunDir "$ReplayRunId-apply.json"
    $IdempotentReport = Join-Path $RunDir "$ReplayRunId-idempotent.json"
    $PromoteDry = Join-Path $RunDir "$ReplayRunId-promote-dry.json"
    $PromoteApply = Join-Path $RunDir "$ReplayRunId-promote-apply.json"

    $ReplayArgs = @(
      '--db', $StagedDb, '--report', $Controlled, '--replay-report', $Controlled,
      '--controlled-consensus-draft-write', 'true', '--limit', '1000000',
      '--apply', 'true', '--dry-run', 'false', '--publishable', 'false',
      '--skip-existing-drafts', 'true', '--deterministic-readings', 'true',
      '--deterministic-pronunciations', 'true',
      '--jmdict', (Join-Path $Root 'data\raw\JMdict_e.gz'),
      '--source-db', (Join-Path $Root 'data\processed\linguago_v2_full.db'),
      '--pt-pronunciation-db', (Join-Path $Root 'data\processed\kaikki_portuguese_pronunciations.db')
    )
    Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' `
      ($ReplayArgs + @('--out', $ApplyReport))
    Invoke-Node 'scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs' `
      ($ReplayArgs + @('--out', $IdempotentReport))

    $PromoteArgs = @(
      '--db', $StagedDb, '--limit', '1000000', '--report', $Controlled,
      '--restrict-to-report', 'true', '--semantic-review', $Consensus,
      '--reverse-evidence', $Reverse, '--verification-level', 'ai_reviewed',
      '--review-model', 'gemma-4-31b-independent-review',
      '--evidence-families', 'locked-local-dictionary-evidence,qwen-generation,gemma-independent-review',
      '--allow-accepted-entry-additional-senses', 'true'
    )
    Invoke-Node 'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs' `
      ($PromoteArgs + @('--apply', 'false', '--out', $PromoteDry))
    Invoke-Node 'scripts\promote-dictionary-v2-product-source-gap-drafts.mjs' `
      ($PromoteArgs + @('--apply', 'true', '--out', $PromoteApply))

    $Apply = Read-Json $ApplyReport
    $Idempotent = Read-Json $IdempotentReport
    $Dry = Read-Json $PromoteDry
    $Promoted = Read-Json $PromoteApply
    if (-not $Apply.ok -or -not $Idempotent.ok -or -not $Dry.ok -or -not $Promoted.ok) {
      throw "Replay reports are not clean for $ReplayRunId"
    }
    if ([int64]$Idempotent.stats.senses_inserted -ne 0 -or [int64]$Idempotent.stats.localizations_upserted -ne 0) {
      throw "Replay is not idempotent for $ReplayRunId"
    }
    if ([int64]$Dry.stats.accepted -ne [int64]$Promoted.stats.senses_promoted) {
      throw "Promote count mismatch for $ReplayRunId"
    }
    $ReplayResults += [ordered]@{
      run_id = $ReplayRunId
      senses_inserted = [int64]$Apply.stats.senses_inserted
      senses_promoted = [int64]$Promoted.stats.senses_promoted
    }
  }

  $MainlandPlan = Join-Path $RunDir 'rebase-mainland-chinese-plan.json'
  $MainlandApplyReport = Join-Path $RunDir 'rebase-mainland-chinese-apply.json'
  $AliasConfig = Join-Path $Root 'config\dictionary-overrides\product-entry-form-aliases.json'
  Invoke-Node 'scripts\create-dictionary-v2-product-mainland-chinese-plan.mjs' @(
    '--db', $StagedDb, '--out', $MainlandPlan
  )
  $MainlandOutput = @(
    & node.exe (Join-Path $Root 'scripts\apply-dictionary-v2-product-mainland-chinese-plan.mjs') `
      '--db' $StagedDb '--plan' $MainlandPlan '--aliases' $AliasConfig '--apply' 'true'
  ) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Mainland Chinese canonicalization failed' }
  [IO.File]::WriteAllText($MainlandApplyReport, $MainlandOutput, (New-Object Text.UTF8Encoding($false)))
  $MainlandApply = $MainlandOutput | ConvertFrom-Json
  if ($MainlandApply.skipped.Count -ne 0) {
    throw 'Mainland Chinese canonicalization has source drift or collisions'
  }

  Invoke-Node 'scripts\checkpoint-sqlite-db.mjs' @('--db', $StagedDb)
  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @('--db', $StagedDb, '--mode', 'fast')
  $RiskPath = Join-Path $RunDir 'rebase-published-risk.json'
  Invoke-Node 'scripts\audit-dictionary-v2-product-published-risk.mjs' @(
    '--db', $StagedDb, '--out', $RiskPath
  )
  $Risk = Read-Json $RiskPath
  if (-not $Risk.ok -or [int64]$Risk.summary.flagged_senses -ne 0) {
    throw 'Rebased DB failed published-risk audit'
  }

  $AuditDir = Join-Path $RunDir 'rebase-full-audit'
  Invoke-Node 'scripts\export-dictionary-v2-product-native-d1-sql.mjs' @(
    '--db', $StagedDb, '--out-dir', $AuditDir,
    '--entry-form-aliases', $AliasConfig
  )
  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @(
    '--db', $StagedDb, '--mode', 'full', '--import', 'memory', '--out-dir', $AuditDir
  )
  $FullAuditPath = Join-Path $AuditDir 'audit.json'
  $Audit = Read-Json $FullAuditPath
  if (-not $Audit.ok) { throw 'Rebased DB failed full export audit' }

  $BeforeReplace = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($BeforeReplace -ne $ExpectedMain) { throw 'Main DB changed during rebase validation' }
  $Timestamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $BackupPath = Join-Path $Root "backups\$RunId-main-before-rebase-$Timestamp.db"
  [IO.File]::Replace($StagedDb, $MainDb, $BackupPath, $true)
  $After = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
  $BackupHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToUpperInvariant()

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\new-dictionary-maintenance-release-report.ps1') `
    -Root $Root -RunId $RunId -DbPath $MainDb -BackupPath $BackupPath `
    -ExpectedDbSha256 $After -ExpectedBackupSha256 $BackupHash `
    -FullAuditPath $FullAuditPath -PublishedRiskPath $RiskPath
  if ($LASTEXITCODE -ne 0) { throw 'Rebase maintenance release report failed' }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\complete-remote-dictionary-maintenance-run.ps1') `
    -Root $Root -RunId $RunId
  if ($LASTEXITCODE -ne 0) { throw 'Rebase manifest completion failed' }

  [ordered]@{
    ok = $true
    run_id = $RunId
    base_db = $ResolvedBase
    base_sha256 = $ExpectedBase
    main_sha256_before = $ExpectedMain
    main_sha256_after = $After
    rollback_backup = $BackupPath
    replay_results = $ReplayResults
    mainland_chinese = [ordered]@{
      headwords_applied = [int64]$MainlandApply.headwords_applied
      localizations_applied = [int64]$MainlandApply.repairs_applied
      aliases_added = [int64]$MainlandApply.aliases_added
    }
    publishable_senses = [int64]$Risk.summary.publishable_senses
    flagged_senses = [int64]$Risk.summary.flagged_senses
    full_audit_ok = [bool]$Audit.ok
    completed_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 7
} finally {
  Remove-Item -LiteralPath $ReleaseLock -Force -ErrorAction SilentlyContinue
}
