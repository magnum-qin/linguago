param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$DbPath,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedDbSha256,
  [string]$DatabaseName = 'linguago-dictionary',
  [string]$ExpectedAccountId = '3ebbb03df81b809142eec47c07ef6801',
  [object]$ReuseValidatedExport = $false,
  [object]$Execute = $false
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

function Invoke-Node([string]$Script, [string[]]$Arguments) {
  & node.exe (Join-Path $Root $Script) @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Script failed with exit code $LASTEXITCODE" }
}

function Invoke-WranglerWithRetry(
  [string]$Wrangler,
  [string[]]$Arguments,
  [string]$Operation,
  [int]$MaxAttempts = 3
) {
  for ($Attempt = 1; $Attempt -le $MaxAttempts; $Attempt++) {
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Output = @(& $Wrangler @Arguments 2>&1)
    $Succeeded = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $PreviousPreference
    if ($Succeeded) { return $Output }
    if ($Attempt -lt $MaxAttempts) {
      Write-Warning "$Operation failed (attempt $Attempt/$MaxAttempts); retrying."
      Start-Sleep -Seconds ([Math]::Min(15, 3 * $Attempt))
    }
  }
  throw "$Operation failed after $MaxAttempts attempts: $($Output -join ' ')"
}

$Execute = ConvertTo-RunnerBoolean $Execute 'Execute'
$ReuseValidatedExport = ConvertTo-RunnerBoolean $ReuseValidatedExport 'ReuseValidatedExport'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $RunDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Run directory must stay under the runner root'
}
if (-not (Test-Path -LiteralPath $RunDir)) { throw "Run not found: $RunDir" }

$ResolvedDb = if ([IO.Path]::IsPathRooted($DbPath)) {
  [IO.Path]::GetFullPath($DbPath)
} else {
  [IO.Path]::GetFullPath((Join-Path $Root $DbPath))
}
if (-not (Test-Path -LiteralPath $ResolvedDb)) { throw "DB not found: $ResolvedDb" }
$ActualHash = (Get-FileHash -LiteralPath $ResolvedDb -Algorithm SHA256).Hash.ToUpperInvariant()
$ExpectedHash = $ExpectedDbSha256.Trim().ToUpperInvariant()
if ($ActualHash -ne $ExpectedHash) {
  throw "DB hash mismatch: expected=$ExpectedHash actual=$ActualHash"
}

$StateDir = Join-Path $Root 'state'
$PipelineLock = Join-Path $StateDir 'remote-pipeline.lock.json'
$ReleaseLock = Join-Path $StateDir 'dictionary-release.lock.json'
$D1Lock = Join-Path $StateDir 'dictionary-d1-release.lock.json'
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
foreach ($Lock in @($PipelineLock, $ReleaseLock, $D1Lock)) {
  if (Test-Path -LiteralPath $Lock) { throw "Release blocked by lock: $Lock" }
}

$LockPayload = [ordered]@{
  run_id = $RunId
  pid = $PID
  execute = $Execute
  db_sha256 = $ActualHash
  started_at = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText(
  $D1Lock,
  ($LockPayload | ConvertTo-Json -Depth 4),
  (New-Object Text.UTF8Encoding($false))
)

try {
  $OutDir = Join-Path $RunDir 'cloudflare-d1-release'
  if ($ReuseValidatedExport) {
    $ManifestPath = Join-Path $OutDir 'manifest.json'
    $AuditPath = Join-Path $OutDir 'audit.json'
    if (-not (Test-Path -LiteralPath $ManifestPath) -or -not (Test-Path -LiteralPath $AuditPath)) {
      throw 'ReuseValidatedExport requires an existing manifest and full audit'
    }
    $NewestDbWrite = (Get-Item -LiteralPath $ResolvedDb).LastWriteTimeUtc
    if ((Get-Item -LiteralPath $ManifestPath).LastWriteTimeUtc -lt $NewestDbWrite -or
        (Get-Item -LiteralPath $AuditPath).LastWriteTimeUtc -lt $NewestDbWrite) {
      throw 'Existing export predates the current database'
    }
  } else {
    Invoke-Node 'scripts\export-dictionary-v2-product-native-d1-sql.mjs' @(
      '--db', $ResolvedDb, '--out-dir', $OutDir,
      '--entry-form-aliases', (Join-Path $Root 'config\dictionary-overrides\product-entry-form-aliases.json')
    )
    Invoke-Node 'scripts\audit-dictionary-v2-product-export.mjs' @(
      '--db', $ResolvedDb, '--mode', 'full', '--import', 'memory', '--out-dir', $OutDir
    )
  }

  $Manifest = Read-JsonFile (Join-Path $OutDir 'manifest.json')
  $Audit = Read-JsonFile (Join-Path $OutDir 'audit.json')
  foreach ($SqlFile in @($Manifest.schema) + @($Manifest.chunks)) {
    $ResolvedSqlFile = if ([IO.Path]::IsPathRooted([string]$SqlFile)) {
      [string]$SqlFile
    } else {
      Join-Path $Root ([string]$SqlFile)
    }
    if (-not (Test-Path -LiteralPath $ResolvedSqlFile)) {
      throw "Export SQL file not found: $ResolvedSqlFile"
    }
  }
  if (-not $Manifest.ok -or -not $Audit.ok) { throw 'D1 export or audit is not ok' }
  if ($Audit.count_mismatches.Count -ne 0) { throw 'D1 export count mismatch' }
  if ([int64]$Audit.bad_sense_localization_counts -ne 0) { throw 'Bad sense localization counts' }
  if ([int64]$Audit.duplicate_sense_orders -ne 0) { throw 'Duplicate sense orders' }
  foreach ($Property in $Audit.orphans.PSObject.Properties) {
    if ([int64]$Property.Value -ne 0) { throw "Orphan count is nonzero: $($Property.Name)=$($Property.Value)" }
  }
  if ([int64]$Audit.content_integrity.mojibake_texts -ne 0) { throw 'Mojibake found' }
  if ([int64]$Audit.content_integrity.html_artifacts -ne 0) { throw 'HTML artifacts found' }

  $Result = [ordered]@{
    ok = $true
    run_id = $RunId
    execute = $Execute
    database_name = $DatabaseName
    db = $ResolvedDb
    db_sha256 = $ActualHash
    export_dir = $OutDir
    counts = $Manifest.stats
    time_travel_bookmark_captured = $false
    d1_pushed = $false
  }

  if ($Execute) {
    $MainDb = [IO.Path]::GetFullPath((Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'))
    if ($ResolvedDb -ne $MainDb) { throw 'Execute=true requires the main product DB' }
    $ReleaseControllerPath = Join-Path $RunDir 'release-controller.json'
    $MaintenanceControllerPath = Join-Path $RunDir 'maintenance-release-controller.json'
    if (Test-Path -LiteralPath $ReleaseControllerPath) {
      $Controller = Read-JsonFile $ReleaseControllerPath
      if (-not $Controller.ok -or -not $Controller.main_replaced) {
        throw 'Database replacement release-controller report is not successful'
      }
    } elseif (Test-Path -LiteralPath $MaintenanceControllerPath) {
      $Controller = Read-JsonFile $MaintenanceControllerPath
      if (-not $Controller.ok -or -not $Controller.maintenance_applied -or
          [string]$Controller.kind -ne 'main_in_place_maintenance') {
        throw 'Database maintenance release-controller report is not successful'
      }
      if (-not (Test-Path -LiteralPath ([string]$Controller.rollback_backup))) {
        throw 'Maintenance rollback backup no longer exists'
      }
      $RecordedBackupHash = (Get-FileHash -LiteralPath ([string]$Controller.rollback_backup) -Algorithm SHA256).Hash.ToUpperInvariant()
      if ($RecordedBackupHash -ne ([string]$Controller.rollback_backup_sha256).ToUpperInvariant()) {
        throw 'Maintenance rollback backup hash mismatch'
      }
    } else {
      throw 'Execute=true requires a database replacement or maintenance release-controller report'
    }
    if ([string]$Controller.main_sha256_after -ne $ActualHash) {
      throw 'Current database hash does not match the release-controller report'
    }

    $env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
    $env:CLOUDFLARE_ACCOUNT_ID = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User')
    $env:NODE_OPTIONS = '--dns-result-order=ipv4first'
    if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
      throw 'CLOUDFLARE_API_TOKEN is not configured in the release user environment'
    }

    $Wrangler = Join-Path $Root 'node_modules\.bin\wrangler.cmd'
    $WhoAmI = @(Invoke-WranglerWithRetry $Wrangler @('whoami') 'Cloudflare authentication')

    $ConfiguredAccountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User')
    if ($ConfiguredAccountId -ne $ExpectedAccountId) {
      throw "Cloudflare account mismatch: expected=$ExpectedAccountId configured=$ConfiguredAccountId"
    }

    $D1ListLines = @(Invoke-WranglerWithRetry $Wrangler @('d1', 'list', '--json') 'Cloudflare D1 list')
    try {
      $D1Databases = @(($D1ListLines -join "`n") | ConvertFrom-Json)
    } catch {
      throw "Cloudflare D1 list returned invalid JSON: $($_.Exception.Message)"
    }
    if (@($D1Databases | Where-Object { $_.name -eq $DatabaseName }).Count -eq 0) {
      throw "Cloudflare D1 database is not visible in account ${ExpectedAccountId}: $DatabaseName"
    }

    $BookmarkPath = Join-Path $RunDir 'cloudflare-d1-before-release-bookmark.json'
    $Bookmark = @(Invoke-WranglerWithRetry $Wrangler @('d1', 'time-travel', 'info', $DatabaseName, '--json') 'D1 Time Travel bookmark')
    [IO.File]::WriteAllText($BookmarkPath, ($Bookmark -join "`n"), (New-Object Text.UTF8Encoding($false)))
    $Result.time_travel_bookmark_captured = $true
    $Result.time_travel_bookmark_file = $BookmarkPath

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\push-dictionary-v2-native-to-d1.ps1') `
      -SkipExport -OutDir $OutDir -DatabaseName $DatabaseName
    if ($LASTEXITCODE -ne 0) { throw "D1 push failed with exit code $LASTEXITCODE" }
    $Result.d1_pushed = $true
  }

  $ResultPath = Join-Path $RunDir 'cloudflare-d1-release.json'
  [IO.File]::WriteAllText(
    $ResultPath,
    ($Result | ConvertTo-Json -Depth 8),
    (New-Object Text.UTF8Encoding($false))
  )
  $Result | ConvertTo-Json -Depth 8
} finally {
  Remove-Item -LiteralPath $D1Lock -Force -ErrorAction SilentlyContinue
}
