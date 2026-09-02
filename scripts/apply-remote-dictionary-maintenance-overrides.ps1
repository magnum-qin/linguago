param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$ExpectedMainSha256,
  [string]$OverridePath = 'config\dictionary-overrides\product-sense-localizations.json'
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
$Overrides = if ([IO.Path]::IsPathRooted($OverridePath)) {
  [IO.Path]::GetFullPath($OverridePath)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $OverridePath))
}
$StateDir = Join-Path $Root 'state'
$ReleaseLock = Join-Path $StateDir 'dictionary-release.lock.json'
$Expected = $ExpectedMainSha256.Trim().ToUpperInvariant()

if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under runner root'
}
foreach ($PathValue in @($MainDb, $Overrides)) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "Required path not found: $PathValue" }
}
if (Test-Path -LiteralPath $ReleaseLock) { throw "Release lock already exists: $ReleaseLock" }

$Actual = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
if ($Actual -ne $Expected) { throw "Main DB hash mismatch: expected=$Expected actual=$Actual" }

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
[IO.File]::WriteAllText(
  $ReleaseLock,
  ([ordered]@{
    run_id = $RunId
    release_type = 'maintenance_override_apply'
    pid = $PID
    expected_main_sha256 = $Expected
    started_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json),
  (New-Object Text.UTF8Encoding($false))
)

try {
  $StagedDb = Join-Path $RunDir 'maintenance-staged.db'
  Copy-Item -LiteralPath $MainDb -Destination $StagedDb -Force

  $ApplyReport = Join-Path $RunDir 'maintenance-override-apply.json'
  Invoke-Node 'scripts\apply-dictionary-v2-product-localization-overrides.mjs' @(
    '--db', $StagedDb, '--overrides', $Overrides, '--apply', 'true', '--out', $ApplyReport
  )
  $Apply = Read-Json $ApplyReport
  if (-not $Apply.ok -or $Apply.stats.skipped.Count -ne 0) {
    throw 'Maintenance override apply report is not clean'
  }

  Invoke-Node 'scripts\checkpoint-sqlite-db.mjs' @('--db', $StagedDb)
  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @('--db', $StagedDb, '--mode', 'fast')

  $RiskPath = Join-Path $RunDir 'maintenance-published-risk.json'
  Invoke-Node 'scripts\audit-dictionary-v2-product-published-risk.mjs' @(
    '--db', $StagedDb, '--out', $RiskPath
  )
  $Risk = Read-Json $RiskPath
  if (-not $Risk.ok -or [int64]$Risk.summary.flagged_senses -ne 0) {
    throw 'Maintenance staged DB failed published-risk audit'
  }

  $AuditDir = Join-Path $RunDir 'maintenance-full-audit'
  Invoke-Node 'scripts\export-dictionary-v2-product-native-d1-sql.mjs' @(
    '--db', $StagedDb, '--out-dir', $AuditDir,
    '--entry-form-aliases', (Join-Path $Root 'config\dictionary-overrides\product-entry-form-aliases.json')
  )
  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @(
    '--db', $StagedDb, '--mode', 'full', '--import', 'memory', '--out-dir', $AuditDir
  )
  $FullAuditPath = Join-Path $AuditDir 'audit.json'
  $Audit = Read-Json $FullAuditPath
  if (-not $Audit.ok) { throw 'Maintenance staged DB failed full export audit' }

  $BeforeReplace = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($BeforeReplace -ne $Expected) {
    throw "Main DB changed during maintenance staging: expected=$Expected actual=$BeforeReplace"
  }

  $Timestamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss')
  $BackupPath = Join-Path $Root "backups\$RunId-main-before-maintenance-$Timestamp.db"
  [IO.File]::Replace($StagedDb, $MainDb, $BackupPath, $true)
  $After = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
  $BackupHash = (Get-FileHash -LiteralPath $BackupPath -Algorithm SHA256).Hash.ToUpperInvariant()

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\new-dictionary-maintenance-release-report.ps1') `
    -Root $Root -RunId $RunId -DbPath $MainDb -BackupPath $BackupPath `
    -ExpectedDbSha256 $After -ExpectedBackupSha256 $BackupHash `
    -FullAuditPath $FullAuditPath -PublishedRiskPath $RiskPath
  if ($LASTEXITCODE -ne 0) { throw 'Maintenance release report failed' }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\complete-remote-dictionary-maintenance-run.ps1') `
    -Root $Root -RunId $RunId
  if ($LASTEXITCODE -ne 0) { throw 'Maintenance manifest completion failed' }

  [ordered]@{
    ok = $true
    run_id = $RunId
    main_sha256_before = $Expected
    main_sha256_after = $After
    rollback_backup = $BackupPath
    resolved_senses = [int64]$Apply.stats.resolved_senses
    skipped = [int64]$Apply.stats.skipped.Count
    flagged_senses = [int64]$Risk.summary.flagged_senses
    full_audit_ok = [bool]$Audit.ok
    completed_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 6
} finally {
  Remove-Item -LiteralPath $ReleaseLock -Force -ErrorAction SilentlyContinue
}
