$ErrorActionPreference = 'Stop'

$Root = 'D:\linguago-runner'
$Expected = @{
  'data\processed\linguago_v2_full.db' = '795B0C2600D9C752FC87AD134AC804BABCBD4EC6294098D1362EE2F274DCF839'
  'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db' = 'D9E67D1D7E03520EDABC8738CFE1DEDB8FAA6B0C2D7F5E7C1E6AF785F3D11A82'
  '.tmp\combined\openwn-word2word3-ja-apertium-wikidata-v3-evidence.db' = '9116F811F806FD8E1F34E2F75A8E91CBB65AFDDB68B2AE934896EFC74AC3366F'
  'data\raw\JMdict_e.gz' = 'C2A7A77A003DFA9EAADF126B8DAA23B08C868699C6A2672728E5E46D0754FF8E'
  'data\processed\kaikki_portuguese_pronunciations.db' = '902BFC1E4AA48EC101D5FDDAEC6B6B79A265C122819ED34991D916EF18DD4124'
}

$Files = foreach ($RelativePath in $Expected.Keys) {
  $Path = Join-Path $Root $RelativePath
  if (-not (Test-Path -LiteralPath $Path)) {
    [pscustomobject]@{ Path = $RelativePath; Exists = $false; HashMatches = $false; Bytes = 0 }
    continue
  }
  $Hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  [pscustomobject]@{
    Path = $RelativePath
    Exists = $true
    HashMatches = $Hash -eq $Expected[$RelativePath]
    Bytes = (Get-Item -LiteralPath $Path).Length
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
$Endpoints = foreach ($Port in 11447, 11448, 11444) {
  try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 10
    [pscustomobject]@{ Port = $Port; Healthy = $true; Error = $null }
  } catch {
    [pscustomobject]@{ Port = $Port; Healthy = $false; Error = $_.Exception.Message }
  }
}
$Result = [pscustomobject]@{
  Ok = (($Files | Where-Object { -not $_.Exists -or -not $_.HashMatches }).Count -eq 0) -and
    (($Endpoints | Where-Object { -not $_.Healthy }).Count -eq 0)
  Node = $NodeVersion
  UnslothKey = if ($KeySet) { 'set' } else { 'missing' }
  Endpoints = @($Endpoints)
  Files = @($Files)
}
$Result | ConvertTo-Json -Depth 4
if (-not $Result.Ok) { exit 1 }
