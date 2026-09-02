param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)][string]$RunId
)

$ErrorActionPreference = 'Stop'

function Read-Json([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "JSON file not found: $PathValue" }
  return [IO.File]::ReadAllText($PathValue, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Assert-Hash([string]$PathValue, [string]$ExpectedHash, [string]$Label) {
  if (-not (Test-Path -LiteralPath $PathValue)) { throw "$Label not found: $PathValue" }
  $ActualHash = (Get-FileHash -LiteralPath $PathValue -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($ActualHash -ne $ExpectedHash.Trim().ToUpperInvariant()) {
    throw "$Label SHA-256 mismatch"
  }
  return $ActualHash
}

$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under runner root'
}

$ControllerPath = Join-Path $RunDir 'maintenance-release-controller.json'
$Controller = Read-Json $ControllerPath
if (-not $Controller.ok -or [string]$Controller.kind -ne 'main_in_place_maintenance' -or -not $Controller.maintenance_applied) {
  throw 'Maintenance release controller is not eligible for manifest completion'
}
if ([string]$Controller.run_id -ne $RunId) { throw 'Maintenance release controller run ID mismatch' }

$MainDb = [IO.Path]::GetFullPath((Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'))
if ([IO.Path]::GetFullPath([string]$Controller.main_db) -ne $MainDb) {
  throw 'Maintenance controller does not reference the authoritative product DB'
}
$BackupsRoot = [IO.Path]::GetFullPath((Join-Path $Root 'backups'))
$BackupPath = [IO.Path]::GetFullPath([string]$Controller.rollback_backup)
if (-not $BackupPath.StartsWith($BackupsRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Rollback backup must stay under runner backups'
}

$MainHash = Assert-Hash $MainDb ([string]$Controller.main_sha256_after) 'Main DB'
$null = Assert-Hash $BackupPath ([string]$Controller.rollback_backup_sha256) 'Rollback backup'
$null = Assert-Hash ([string]$Controller.full_audit) ([string]$Controller.full_audit_sha256) 'Full audit'
$null = Assert-Hash ([string]$Controller.published_risk) ([string]$Controller.published_risk_sha256) 'Published-risk audit'

$Audit = Read-Json ([string]$Controller.full_audit)
$Risk = Read-Json ([string]$Controller.published_risk)
if (-not $Audit.ok -or $Audit.count_mismatches.Count -ne 0) { throw 'Full export audit is no longer clean' }
if ([int64]$Audit.bad_sense_localization_counts -ne 0 -or [int64]$Audit.duplicate_sense_orders -ne 0) {
  throw 'Full export audit has blocking localization or sense-order findings'
}
foreach ($Property in $Audit.orphans.PSObject.Properties) {
  if ([int64]$Property.Value -ne 0) { throw "Full export audit orphan: $($Property.Name)" }
}
if ([int64]$Audit.content_integrity.mojibake_texts -ne 0 -or [int64]$Audit.content_integrity.html_artifacts -ne 0) {
  throw 'Full export audit has content-integrity blockers'
}
if (-not $Risk.ok -or [int64]$Risk.summary.flagged_senses -ne 0) {
  throw 'Published-risk audit is no longer clean'
}

$ManifestPath = Join-Path $Root 'config\remote-runner-files.json'
$Manifest = Read-Json $ManifestPath
$ProductDbRelativePath = 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$DbEntry = @($Manifest.files) | Where-Object { [string]$_.path -eq $ProductDbRelativePath } | Select-Object -First 1
if ($null -eq $DbEntry) { throw 'Product DB entry missing from runner manifest' }
$DbEntry.bytes = [long](Get-Item -LiteralPath $MainDb).Length
$DbEntry.sha256 = $MainHash
$Manifest.generated_at = [DateTime]::UtcNow.ToString('o')
[IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  (Join-Path $Root 'scripts\new-remote-dictionary-runner-manifest.ps1') -Root $Root
if ($LASTEXITCODE -ne 0) { throw 'Runner manifest regeneration failed' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  (Join-Path $Root 'scripts\verify-remote-dictionary-runner.ps1') -Root $Root -SkipEndpoints
if ($LASTEXITCODE -ne 0) { throw 'Post-maintenance runner verification failed' }

[ordered]@{
  ok = $true
  run_id = $RunId
  main_db = $MainDb
  main_sha256 = $MainHash
  manifest = $ManifestPath
  completed_at = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 4
