param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedMainSha256,
  [object]$Commit = $false,
  [switch]$ForceValidation
)

$ErrorActionPreference = 'Stop'

function ConvertTo-RunnerBoolean([object]$Value, [string]$Name) {
  if ($Value -is [bool]) { return $Value }
  $Text = ([string]$Value).Trim().ToLowerInvariant()
  if ($Text -in @('true', '1', 'yes', 'on')) { return $true }
  if ($Text -in @('false', '0', 'no', 'off')) { return $false }
  throw "$Name must be true/false or 1/0"
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "JSON file not found: $Path" }
  return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Assert-Zero([object]$Value, [string]$Name) {
  if ([int64]$Value -ne 0) { throw "$Name must be zero, got $Value" }
}

$Commit = ConvertTo-RunnerBoolean $Commit 'Commit'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under the runner root'
}
if (-not (Test-Path -LiteralPath $RunDir)) { throw "Run not found: $RunDir" }

$StateDir = Join-Path $Root 'state'
$PipelineLock = Join-Path $StateDir 'remote-pipeline.lock.json'
$ReleaseLock = Join-Path $StateDir 'dictionary-release.lock.json'
$MainDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$BackupDir = Join-Path $Root 'backups'
New-Item -ItemType Directory -Path $StateDir, $BackupDir -Force | Out-Null

if (Test-Path -LiteralPath $PipelineLock) {
  throw 'A dictionary generation pipeline is reserved or running'
}
if (Test-Path -LiteralPath $ReleaseLock) {
  throw 'Another dictionary release is reserved or running'
}
if (-not (Test-Path -LiteralPath $MainDb)) { throw "Main DB not found: $MainDb" }

$Expected = $ExpectedMainSha256.Trim().ToUpperInvariant()
$Actual = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
if ($Actual -ne $Expected) {
  throw "Main DB hash mismatch: expected=$Expected actual=$Actual"
}

$LockPayload = [ordered]@{
  run_id = $RunId
  pid = $PID
  commit = $Commit
  expected_main_sha256 = $Expected
  started_at = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText(
  $ReleaseLock,
  ($LockPayload | ConvertTo-Json -Depth 4),
  (New-Object Text.UTF8Encoding($false))
)

$ValidationBase = $null
try {
  $Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $ValidationBase = Join-Path $BackupDir "$RunId-validation-base-$Stamp.db"
  Copy-Item -LiteralPath $MainDb -Destination $ValidationBase

  $ValidationArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $Root 'scripts\validate-remote-dictionary-controlled-replay.ps1'),
    '-Root', $Root, '-RunId', $RunId,
    '-BaseDb', ($ValidationBase.Substring($Root.TrimEnd('\').Length).TrimStart('\'))
  )
  if ($ForceValidation) { $ValidationArgs += '-Force' }
  & powershell.exe @ValidationArgs
  if ($LASTEXITCODE -ne 0) { throw "Isolated validation failed with exit code $LASTEXITCODE" }

  & node.exe (Join-Path $Root 'scripts\audit-dictionary-v2-production-cadence.mjs') `
    --run-dir $RunDir --out (Join-Path $RunDir 'production-cadence-audit.json')
  if ($LASTEXITCODE -ne 0) { throw 'Production cadence audit failed' }

  & node.exe (Join-Path $Root 'scripts\check-dictionary-v2-production-run-gates.mjs') `
    --run-dir $RunDir --out (Join-Path $RunDir 'production-gate.json')
  if ($LASTEXITCODE -ne 0) { throw 'Production gates failed' }

  $Apply = Read-JsonFile (Join-Path $RunDir '09-isolated-controlled-apply.json')
  $Idempotent = Read-JsonFile (Join-Path $RunDir '10-isolated-controlled-idempotent.json')
  $PromoteDry = Read-JsonFile (Join-Path $RunDir '11-isolated-promote-dry-run.json')
  $PromoteApply = Read-JsonFile (Join-Path $RunDir '12-isolated-promote-apply.json')
  $Risk = Read-JsonFile (Join-Path $RunDir '14-isolated-published-risk.json')
  $Audit = Read-JsonFile (Join-Path $RunDir '15-isolated-full-audit\audit.json')
  $Cadence = Read-JsonFile (Join-Path $RunDir 'production-cadence-audit.json')
  $Gate = Read-JsonFile (Join-Path $RunDir 'production-gate.json')

  $HistoricalRecovered = 0
  if ($null -ne $Apply.stats.PSObject.Properties['historical_existing_drafts_recovered']) {
    $HistoricalRecovered = [int64]$Apply.stats.historical_existing_drafts_recovered
  }
  $HistoricalRecovery = $HistoricalRecovered -gt 0

  if (-not $Apply.ok -or -not $Risk.ok -or -not $Audit.ok -or -not $Cadence.ok -or -not $Gate.ok) {
    throw 'One or more release reports are not ok'
  }
  Assert-Zero $Idempotent.stats.senses_inserted 'idempotent senses_inserted'
  Assert-Zero $Idempotent.stats.localizations_upserted 'idempotent localizations_upserted'
  $CandidateExhausted = [int64]$PromoteDry.stats.accepted -le 0
  if ([int64]$PromoteDry.stats.accepted -ne [int64]$PromoteApply.stats.senses_promoted) {
    throw 'Promote apply count does not match promote dry-run acceptance count'
  }
  $InsertedSenseIds = @($Apply.writes | ForEach-Object { [int64]$_.product_sense_id })
  $ExpectedWriteCount = [int64]$Apply.stats.senses_inserted + $HistoricalRecovered
  if ($InsertedSenseIds.Count -ne $ExpectedWriteCount) {
    throw 'Controlled replay write IDs do not match inserted plus recovered senses'
  }
  $DryAcceptedSenseIds = [Collections.Generic.HashSet[int64]]::new()
  $AcceptedSenseIdRows = @()
  if ($null -ne $PromoteDry.PSObject.Properties['accepted_sense_ids']) {
    $AcceptedSenseIdRows = @($PromoteDry.accepted_sense_ids)
  } elseif (@($PromoteDry.accepted_preview).Count -eq [int64]$PromoteDry.stats.accepted) {
    # Backward compatibility for older, non-truncated reports only.
    $AcceptedSenseIdRows = @($PromoteDry.accepted_preview | ForEach-Object { $_.sense_id })
  } else {
    throw 'Promote dry-run report lacks a complete accepted sense ID set'
  }
  foreach ($SenseId in $AcceptedSenseIdRows) {
    [void]$DryAcceptedSenseIds.Add([int64]$SenseId)
  }
  if ($DryAcceptedSenseIds.Count -ne [int64]$PromoteDry.stats.accepted) {
    throw 'Promote dry-run accepted sense ID count does not match accepted stats'
  }
  $ExistingDraftSenseIds = [Collections.Generic.HashSet[int64]]::new()
  foreach ($Write in @($Apply.writes)) {
    if ([string]$Write.recovery -eq 'existing_draft') {
      [void]$ExistingDraftSenseIds.Add([int64]$Write.product_sense_id)
    }
  }
  $PromotedExistingDrafts = 0
  $PromotedNewDrafts = 0
  foreach ($SenseId in $DryAcceptedSenseIds) {
    if ($ExistingDraftSenseIds.Contains($SenseId)) { $PromotedExistingDrafts += 1 }
    else { $PromotedNewDrafts += 1 }
  }
  if ($HistoricalRecovery) {
    $ScopedSenseIds = [Collections.Generic.HashSet[int64]]::new()
    foreach ($SenseId in $InsertedSenseIds) { [void]$ScopedSenseIds.Add($SenseId) }
    foreach ($SenseId in $DryAcceptedSenseIds) {
      if (-not $ScopedSenseIds.Contains($SenseId)) {
        throw "Promote dry-run accepted sense outside historical recovery scope: $SenseId"
      }
    }
  } else {
    foreach ($SenseId in $InsertedSenseIds) {
      if (-not $DryAcceptedSenseIds.Contains($SenseId)) {
        throw "Controlled replay sense did not pass promote dry-run: $SenseId"
      }
    }
  }
  if (([int64]$PromoteDry.stats.accepted + [int64]$PromoteDry.stats.rejected) -ne $ExpectedWriteCount) {
    throw 'Promote dry-run did not account for every controlled replay sense'
  }
  $ExpectedPromoteCount = if ($HistoricalRecovery) {
    [int64]$PromoteDry.stats.accepted
  } else {
    $ExpectedWriteCount
  }
  if ([int64]$PromoteApply.stats.senses_promoted -ne $ExpectedPromoteCount) {
    throw 'Promoted sense count does not match the controlled replay insert count'
  }
  Assert-Zero $Risk.summary.flagged_senses 'published-risk flagged_senses'
  Assert-Zero $Audit.bad_sense_localization_counts 'bad_sense_localization_counts'
  Assert-Zero $Audit.duplicate_sense_orders 'duplicate_sense_orders'
  foreach ($Property in $Audit.orphans.PSObject.Properties) {
    Assert-Zero $Property.Value "orphans.$($Property.Name)"
  }
  Assert-Zero $Audit.content_integrity.mojibake_texts 'mojibake_texts'
  Assert-Zero $Audit.content_integrity.html_artifacts 'html_artifacts'

  $IsolatedDb = Join-Path $RunDir 'isolated-controlled-replay.db'
  & node.exe (Join-Path $Root 'scripts\checkpoint-sqlite-db.mjs') '--db' $IsolatedDb
  if ($LASTEXITCODE -ne 0) { throw 'SQLite checkpoint failed' }

  $Result = [ordered]@{
    ok = $true
    run_id = $RunId
    commit_requested = $Commit
    commit = $Commit -and -not $CandidateExhausted
    status = if ($CandidateExhausted) { 'candidate_exhausted' } elseif ($Commit) { 'committed' } else { 'validated' }
    candidate_exhausted = $CandidateExhausted
    main_sha256_before = $Actual
    validation_base_removed = $true
    isolated_db = $IsolatedDb
    senses_inserted = [int64]$Apply.stats.senses_inserted
    historical_existing_drafts_scoped = $HistoricalRecovered
    historical_existing_drafts_recovered = if ($HistoricalRecovery) { $PromotedExistingDrafts } else { 0 }
    new_drafts_promoted = $PromotedNewDrafts
    senses_promoted = [int64]$PromoteApply.stats.senses_promoted
    flagged_senses = [int64]$Risk.summary.flagged_senses
    audit_counts = $Audit.counts
    main_replaced = $false
  }

  if ($Commit -and -not $CandidateExhausted) {
    $Rollback = Join-Path $BackupDir "$RunId-main-before-commit-$Stamp.db"
    $Staged = Join-Path $RunDir 'staged-main-commit.db'
    Copy-Item -LiteralPath $IsolatedDb -Destination $Staged -Force
    [IO.File]::Replace($Staged, $MainDb, $Rollback, $true)
    $Result.main_replaced = $true
    $Result.rollback_db = $Rollback
    $Result.main_sha256_after = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash
  }

  $Out = Join-Path $RunDir 'release-controller.json'
  [IO.File]::WriteAllText(
    $Out,
    ($Result | ConvertTo-Json -Depth 8),
    (New-Object Text.UTF8Encoding($false))
  )
  $Result | ConvertTo-Json -Depth 8
} finally {
  if ($ValidationBase -and (Test-Path -LiteralPath $ValidationBase)) {
    Remove-Item -LiteralPath $ValidationBase -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $ReleaseLock -Force -ErrorAction SilentlyContinue
}
