param(
  [string]$Root = 'D:\linguago-runner',
  [string]$Manifest = 'config\remote-runner-files.json',
  [int[]]$EndpointPorts = @(11444, 11445, 11446, 11447, 11448),
  [switch]$SkipEndpoints
)

$ErrorActionPreference = 'Stop'
$ManifestPath = Join-Path $Root $Manifest
if (-not (Test-Path -LiteralPath $ManifestPath)) {
  throw "Remote runner manifest not found: $ManifestPath"
}
$Expected = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

$Files = foreach ($Entry in $Expected.files) {
  $RelativePath = [string]$Entry.path
  $Path = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $Path)) {
    [pscustomobject]@{ Path = $RelativePath; Exists = $false; HashMatches = $false; Bytes = 0 }
    continue
  }
  $Hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  [pscustomobject]@{
    Path = $RelativePath
    Exists = $true
    HashMatches = $Hash -eq ([string]$Entry.sha256).ToUpperInvariant()
    Bytes = (Get-Item -LiteralPath $Path).Length
    Hash = $Hash
  }
}

Push-Location $Root
try {
  $NodeVersion = (& node --version).Trim()
  & node --check scripts\run-dictionary-v2-remote-pipeline.mjs
  if ($LASTEXITCODE -ne 0) { throw 'runner syntax check failed' }
  & node -e "require('better-sqlite3'); console.log('better-sqlite3=ok')"
  if ($LASTEXITCODE -ne 0) { throw 'better-sqlite3 load failed' }
} finally {
  Pop-Location
}

$KeySet = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('UNSLOTH_API_KEY', 'User'))
$Endpoints = if ($SkipEndpoints) { @() } else { foreach ($Port in $EndpointPorts) {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 10
    [pscustomobject]@{ Port = $Port; Healthy = $true; Error = $null }
  } catch {
    [pscustomobject]@{ Port = $Port; Healthy = $false; Error = $_.Exception.Message }
  }
} }
$Result = [pscustomobject]@{
  Ok = (($Files | Where-Object { -not $_.Exists -or -not $_.HashMatches }).Count -eq 0) -and
    ($SkipEndpoints -or (($Endpoints | Where-Object { -not $_.Healthy }).Count -eq 0)) -and
    $KeySet
  CheckedAt = [DateTime]::UtcNow.ToString('o')
  Root = $Root
  Manifest = $Manifest
  Node = $NodeVersion
  UnslothKey = if ($KeySet) { 'set' } else { 'missing' }
  Endpoints = @($Endpoints)
  Files = @($Files)
}
$Result | ConvertTo-Json -Depth 4
if (-not $Result.Ok) { exit 1 }
