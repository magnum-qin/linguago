param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$BackupDb,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedMainSha256,
  [string]$OverridePath = 'config\dictionary-overrides\product-sense-localizations.json'
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
$MainDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$ResolvedBackup = if ([IO.Path]::IsPathRooted($BackupDb)) {
  [IO.Path]::GetFullPath($BackupDb)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $BackupDb))
}
$ResolvedOverrides = if ([IO.Path]::IsPathRooted($OverridePath)) {
  [IO.Path]::GetFullPath($OverridePath)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $OverridePath))
}
$StateDir = Join-Path $Root 'state'
$ReleaseLock = Join-Path $StateDir 'dictionary-release.lock.json'

foreach ($Path in @($RunDir, $MainDb, $ResolvedBackup, $ResolvedOverrides)) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Required path not found: $Path" }
}
if ($ResolvedBackup -eq [IO.Path]::GetFullPath($MainDb)) {
  throw 'BackupDb must not be the main product database'
}
if (Test-Path -LiteralPath $ReleaseLock) { throw "Release lock already exists: $ReleaseLock" }

$Expected = $ExpectedMainSha256.Trim().ToUpperInvariant()
$Actual = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash.ToUpperInvariant()
if ($Actual -ne $Expected) { throw "Main DB hash mismatch: expected=$Expected actual=$Actual" }

New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
[IO.File]::WriteAllText(
  $ReleaseLock,
  ([ordered]@{
    run_id = $RunId
    release_type = 'manual_override_replay'
    pid = $PID
    expected_main_sha256 = $Expected
    started_at = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json),
  (New-Object Text.UTF8Encoding($false))
)

function Invoke-Node([string]$Script, [string[]]$Arguments) {
  & node.exe (Join-Path $Root $Script) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed with exit code $LASTEXITCODE" }
}

try {
  $ReplayDb = Join-Path $RunDir 'manual-override-replay.db'
  Copy-Item -LiteralPath $ResolvedBackup -Destination $ReplayDb -Force

  $ApplyReport = Join-Path $RunDir 'manual-override-apply.json'
  $ApplyOutput = @(& node.exe (Join-Path $Root 'scripts\apply-dictionary-v2-product-localization-overrides.mjs') `
    '--db' $ReplayDb '--overrides' $ResolvedOverrides '--apply' 'true')
  if ($LASTEXITCODE -ne 0) { throw 'Manual override replay failed' }
  [IO.File]::WriteAllText($ApplyReport, ($ApplyOutput -join "`n"), (New-Object Text.UTF8Encoding($false)))
  $Apply = [IO.File]::ReadAllText($ApplyReport, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if (-not $Apply.ok -or $Apply.stats.skipped.Count -ne 0) { throw 'Manual override replay report is not clean' }

  Invoke-Node 'scripts\checkpoint-sqlite-db.mjs' @('--db', $ReplayDb)
  $ReplayHash = (Get-FileHash -LiteralPath $ReplayDb -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($ReplayHash -ne $Actual) {
    throw "Manual override replay differs from main DB: replay=$ReplayHash main=$Actual"
  }

  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @('--db', $ReplayDb, '--mode', 'fast')
  $RiskPath = Join-Path $RunDir 'manual-override-published-risk.json'
  Invoke-Node 'scripts\audit-dictionary-v2-product-published-risk.mjs' @('--db', $ReplayDb, '--out', $RiskPath)
  $Risk = [IO.File]::ReadAllText($RiskPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if (-not $Risk.ok -or [int64]$Risk.summary.flagged_senses -ne 0) {
    throw 'Manual override replay failed published-risk audit'
  }

  $AuditDir = Join-Path $RunDir 'manual-override-full-audit'
  Invoke-Node 'scripts\export-dictionary-v2-product-native-d1-sql.mjs' @(
    '--db', $ReplayDb, '--out-dir', $AuditDir,
    '--entry-form-aliases', (Join-Path $Root 'config\dictionary-overrides\product-entry-form-aliases.json')
  )
  Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @(
    '--db', $ReplayDb, '--mode', 'full', '--import', 'memory', '--out-dir', $AuditDir
  )
  $Audit = [IO.File]::ReadAllText((Join-Path $AuditDir 'audit.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
  if (-not $Audit.ok) { throw 'Manual override replay failed full export audit' }

  $Result = [ordered]@{
    ok = $true
    run_id = $RunId
    release_type = 'manual_override_replay'
    main_replaced = $true
    main_sha256_before = (Get-FileHash -LiteralPath $ResolvedBackup -Algorithm SHA256).Hash
    main_sha256_after = $Actual
    backup_db = $ResolvedBackup
    replay_db = $ReplayDb
    replay_sha256 = $ReplayHash
    override = $ResolvedOverrides
    resolved_senses = [int64]$Apply.stats.resolved_senses
    skipped = [int64]$Apply.stats.skipped.Count
    flagged_senses = [int64]$Risk.summary.flagged_senses
    full_audit_ok = [bool]$Audit.ok
    completed_at = [DateTime]::UtcNow.ToString('o')
  }
  [IO.File]::WriteAllText(
    (Join-Path $RunDir 'release-controller.json'),
    ($Result | ConvertTo-Json -Depth 6),
    (New-Object Text.UTF8Encoding($false))
  )
  $Result | ConvertTo-Json -Depth 6
} finally {
  Remove-Item -LiteralPath $ReleaseLock -Force -ErrorAction SilentlyContinue
}
