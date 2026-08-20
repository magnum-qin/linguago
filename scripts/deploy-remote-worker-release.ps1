param(
  [string]$Root = 'D:\linguago-runner',
  [string]$DeployRoot = 'D:\linguago-deploy',
  [Parameter(Mandatory = $true)]
  [string]$Commit,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedArchiveSha256,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedCacheVersion,
  [string]$WorkerName = 'translation-pwa',
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

function Invoke-Checked([string]$Name, [scriptblock]$Action) {
  & $Action
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

function Get-ProductionVersionId([object]$Deployments) {
  foreach ($Deployment in @($Deployments)) {
    foreach ($Version in @($Deployment.versions)) {
      $Id = [string]$Version.version_id
      if ([string]::IsNullOrWhiteSpace($Id)) { $Id = [string]$Version.id }
      if (-not [string]::IsNullOrWhiteSpace($Id)) { return $Id }
    }
  }
  return $null
}

$Execute = ConvertTo-RunnerBoolean $Execute 'Execute'
$Commit = $Commit.Trim().ToLowerInvariant()
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'Commit must be a full 40-character Git SHA' }
$ExpectedHash = $ExpectedArchiveSha256.Trim().ToUpperInvariant()
if ($ExpectedHash -notmatch '^[0-9A-F]{64}$') { throw 'ExpectedArchiveSha256 must be a SHA-256 hash' }
if ([string]::IsNullOrWhiteSpace($ExpectedCacheVersion)) { throw 'ExpectedCacheVersion is required' }

$Root = [IO.Path]::GetFullPath($Root)
$DeployRoot = [IO.Path]::GetFullPath($DeployRoot)
$CurrentPath = Join-Path $DeployRoot 'current.json'
$Current = Read-JsonFile $CurrentPath
if ([string]$Current.commit -ne $Commit) { throw 'Current staged release commit mismatch' }
if ([string]$Current.archive_sha256 -ne $ExpectedHash) { throw 'Current staged release archive hash mismatch' }

$ReleaseDir = [IO.Path]::GetFullPath([string]$Current.release_dir)
$ReleasesRoot = [IO.Path]::GetFullPath((Join-Path $DeployRoot 'releases'))
if (-not $ReleaseDir.StartsWith($ReleasesRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Release directory must stay under the deploy releases directory'
}
$Metadata = Read-JsonFile (Join-Path $ReleaseDir '.linguago-release.json')
if ([string]$Metadata.commit -ne $Commit -or [string]$Metadata.archive_sha256 -ne $ExpectedHash) {
  throw 'Staged release metadata mismatch'
}

$ConfigPath = Join-Path $ReleaseDir 'worker\config.ts'
$ConfigText = [IO.File]::ReadAllText($ConfigPath, [Text.Encoding]::UTF8)
$CacheMatch = [regex]::Match($ConfigText, 'TRANSLATION_CACHE_VERSION\s*=\s*[''"]([^''"]+)[''"]')
if (-not $CacheMatch.Success) { throw 'Cannot read TRANSLATION_CACHE_VERSION from worker/config.ts' }
$ActualCacheVersion = $CacheMatch.Groups[1].Value
if ($ActualCacheVersion -ne $ExpectedCacheVersion) {
  throw "Worker cache version mismatch: expected=$ExpectedCacheVersion actual=$ActualCacheVersion"
}

$StateDir = Join-Path $Root 'state'
$LockPath = Join-Path $StateDir 'worker-release.lock.json'
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
if (Test-Path -LiteralPath $LockPath) { throw "Worker release blocked by lock: $LockPath" }

$Result = [ordered]@{
  ok = $true
  execute = $Execute
  commit = $Commit
  archive_sha256 = $ExpectedHash
  cache_version = $ActualCacheVersion
  release_dir = $ReleaseDir
  worker_name = $WorkerName
  deployed = $false
  online_checks_passed = $false
  rollback_attempted = $false
  rollback_succeeded = $false
}

if (-not $Execute) {
  $Result | ConvertTo-Json -Depth 8
  exit 0
}

$Lock = [ordered]@{
  commit = $Commit
  pid = $PID
  started_at = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText($LockPath, ($Lock | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

try {
  Set-Location $ReleaseDir
  $Wrangler = Join-Path $ReleaseDir 'node_modules\.bin\wrangler.cmd'

  Invoke-Checked 'npm ci' { & npm.cmd ci --no-audit --no-fund }
  Invoke-Checked 'TypeScript check' { & npm.cmd run check }
  Invoke-Checked 'Worker build' { & npm.cmd run build }

  $PreviousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $WhoAmI = @(& $Wrangler whoami 2>&1)
  $WhoAmIOk = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $PreviousPreference
  if (-not $WhoAmIOk) { throw "Cloudflare authentication failed: $($WhoAmI -join ' ')" }

  $BeforeRaw = @(& $Wrangler deployments list --name $WorkerName --json 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "Cannot capture current Worker deployment: $($BeforeRaw -join ' ')" }
  $Before = ($BeforeRaw -join "`n") | ConvertFrom-Json
  $PreviousVersionId = Get-ProductionVersionId $Before
  if ([string]::IsNullOrWhiteSpace($PreviousVersionId)) {
    throw 'Cannot identify current production Worker version; refusing deployment without rollback target'
  }
  $Result.previous_version_id = $PreviousVersionId

  Invoke-Checked 'Worker deploy' { & $Wrangler deploy }
  $Result.deployed = $true

  try {
    Invoke-Checked 'Online dictionary regression' { & node.exe scripts\online-dictionary-regression-check.mjs }
    Invoke-Checked 'Online dictionary focused API check' { & node.exe scripts\online-dictionary-focused-check.mjs }
    Invoke-Checked 'Online dictionary focused render check' { & node.exe scripts\online-dictionary-render-focused-check.mjs }
    $Result.online_checks_passed = $true
  } catch {
    $Result.ok = $false
    $Result.online_error = $_.Exception.Message
    $Result.rollback_attempted = $true
    & $Wrangler rollback $PreviousVersionId --name $WorkerName --message "Automated rollback after LinguaGo online regression failure" --yes
    $Result.rollback_succeeded = $LASTEXITCODE -eq 0
    if (-not $Result.rollback_succeeded) {
      throw "Online regression failed and Worker rollback also failed: $($Result.online_error)"
    }
    throw "Online regression failed; Worker rolled back to $PreviousVersionId"
  }
} finally {
  $ReportPath = Join-Path $DeployRoot 'last-worker-release.json'
  $Result.completed_at = [DateTime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText(
    $ReportPath,
    ($Result | ConvertTo-Json -Depth 8),
    (New-Object Text.UTF8Encoding($false))
  )
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}

$Result | ConvertTo-Json -Depth 8
