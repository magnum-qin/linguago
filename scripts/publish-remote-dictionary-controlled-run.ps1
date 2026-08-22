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

  $Apply = Read-JsonFile (Join-Path $RunDir '09-isolated-controlled-apply.json')
  $Idempotent = Read-JsonFile (Join-Path $RunDir '10-isolated-controlled-idempotent.json')
  $PromoteDry = Read-JsonFile (Join-Path $RunDir '11-isolated-promote-dry-run.json')
  $PromoteApply = Read-JsonFile (Join-Path $RunDir '12-isolated-promote-apply.json')
  $Risk = Read-JsonFile (Join-Path $RunDir '14-isolated-published-risk.json')
  $Audit = Read-JsonFile (Join-Path $RunDir '15-isolated-full-audit\audit.json')

  if (-not $Apply.ok -or -not $Risk.ok -or -not $Audit.ok) {
    throw 'One or more release reports are not ok'
  }
  if ([int64]$Apply.stats.senses_inserted -le 0) { throw 'Controlled replay inserted no senses' }
  Assert-Zero $Idempotent.stats.senses_inserted 'idempotent senses_inserted'
  Assert-Zero $Idempotent.stats.localizations_upserted 'idempotent localizations_upserted'
  if ([int64]$PromoteDry.stats.accepted -le 0) {
    throw 'Promote dry-run accepted no controlled replay senses'
  }
  if ([int64]$PromoteDry.stats.accepted -ne [int64]$PromoteApply.stats.senses_promoted) {
    throw 'Promote apply count does not match promote dry-run acceptance count'
  }
  if (([int64]$PromoteDry.stats.accepted + [int64]$PromoteDry.stats.rejected) -ne [int64]$Apply.stats.senses_inserted) {
    throw 'Promote dry-run did not account for every controlled replay sense'
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
    commit = $Commit
    main_sha256_before = $Actual
    validation_base_removed = $true
    isolated_db = $IsolatedDb
    senses_inserted = [int64]$Apply.stats.senses_inserted
    senses_promoted = [int64]$PromoteApply.stats.senses_promoted
    flagged_senses = [int64]$Risk.summary.flagged_senses
    audit_counts = $Audit.counts
    main_replaced = $false
  }

  if ($Commit) {
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
