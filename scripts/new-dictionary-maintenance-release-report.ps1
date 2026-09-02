param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$DbPath,
  [Parameter(Mandatory = $true)][string]$BackupPath,
  [Parameter(Mandatory = $true)][string]$ExpectedDbSha256,
  [Parameter(Mandatory = $true)][string]$ExpectedBackupSha256,
  [Parameter(Mandatory = $true)][string]$FullAuditPath,
  [Parameter(Mandatory = $true)][string]$PublishedRiskPath
)

$ErrorActionPreference = 'Stop'

function Resolve-RunnerPath([string]$PathValue) {
  if ([IO.Path]::IsPathRooted($PathValue)) { return [IO.Path]::GetFullPath($PathValue) }
  return [IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

function Read-Json([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "JSON file not found: $PathValue" }
  return [IO.File]::ReadAllText($PathValue, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Run directory must stay under runner root' }
if (-not (Test-Path -LiteralPath $RunDir)) { throw "Run not found: $RunDir" }

$Db = Resolve-RunnerPath $DbPath
$Backup = Resolve-RunnerPath $BackupPath
$FullAuditFile = Resolve-RunnerPath $FullAuditPath
$RiskFile = Resolve-RunnerPath $PublishedRiskPath
$MainDb = [IO.Path]::GetFullPath((Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'))
$BackupsRoot = [IO.Path]::GetFullPath((Join-Path $Root 'backups'))
if ($Db -ne $MainDb) { throw 'Maintenance report requires the authoritative main product DB' }
if (-not $Backup.StartsWith($BackupsRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must stay under runner backups' }
foreach ($PathValue in @($Db, $Backup, $FullAuditFile, $RiskFile)) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "Required evidence not found: $PathValue" }
}

$DbHash = (Get-FileHash -LiteralPath $Db -Algorithm SHA256).Hash.ToUpperInvariant()
$BackupHash = (Get-FileHash -LiteralPath $Backup -Algorithm SHA256).Hash.ToUpperInvariant()
if ($DbHash -ne $ExpectedDbSha256.Trim().ToUpperInvariant()) { throw 'Main DB SHA-256 mismatch' }
if ($BackupHash -ne $ExpectedBackupSha256.Trim().ToUpperInvariant()) { throw 'Backup SHA-256 mismatch' }
if ((Get-Item -LiteralPath $Backup).LastWriteTimeUtc -ge (Get-Item -LiteralPath $Db).LastWriteTimeUtc) {
  throw 'Rollback backup must predate the maintained main DB'
}

$Audit = Read-Json $FullAuditFile
$Risk = Read-Json $RiskFile
if (-not $Audit.ok -or $Audit.count_mismatches.Count -ne 0) { throw 'Full export audit is not clean' }
if ([int64]$Audit.bad_sense_localization_counts -ne 0 -or [int64]$Audit.duplicate_sense_orders -ne 0) {
  throw 'Full export audit has blocking localization or sense-order findings'
}
foreach ($Property in $Audit.orphans.PSObject.Properties) {
  if ([int64]$Property.Value -ne 0) { throw "Full export audit orphan: $($Property.Name)" }
}
if ([int64]$Audit.content_integrity.mojibake_texts -ne 0 -or [int64]$Audit.content_integrity.html_artifacts -ne 0) {
  throw 'Full export audit has content-integrity blockers'
}
if (-not $Risk.ok -or [int64]$Risk.summary.flagged_senses -ne 0) { throw 'Published-risk audit is not clean' }

$Report = [ordered]@{
  ok = $true
  kind = 'main_in_place_maintenance'
  run_id = $RunId
  maintenance_applied = $true
  main_db = $Db
  main_sha256_after = $DbHash
  rollback_backup = $Backup
  rollback_backup_sha256 = $BackupHash
  full_audit = $FullAuditFile
  full_audit_sha256 = (Get-FileHash -LiteralPath $FullAuditFile -Algorithm SHA256).Hash.ToUpperInvariant()
  published_risk = $RiskFile
  published_risk_sha256 = (Get-FileHash -LiteralPath $RiskFile -Algorithm SHA256).Hash.ToUpperInvariant()
  recorded_at = [DateTime]::UtcNow.ToString('o')
}
$OutPath = Join-Path $RunDir 'maintenance-release-controller.json'
[IO.File]::WriteAllText($OutPath, ($Report | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
$Report | ConvertTo-Json -Depth 6
