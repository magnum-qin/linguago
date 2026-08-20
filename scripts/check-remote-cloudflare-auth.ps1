param(
  [string]$Root = 'D:\linguago-runner',
  [switch]$TestWhoAmI
)

$ErrorActionPreference = 'Stop'

function Test-EnvironmentValue([string]$Name, [string]$Target) {
  $Value = [Environment]::GetEnvironmentVariable($Name, $Target)
  return -not [string]::IsNullOrWhiteSpace($Value)
}

$Wrangler = Join-Path $Root 'node_modules\.bin\wrangler.cmd'
$OauthCandidates = @(
  (Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'),
  (Join-Path $env:USERPROFILE '.wrangler\config\default.toml')
)

$Version = $null
$WhoAmIOk = $null
$WhoAmIOutput = $null
if (Test-Path -LiteralPath $Wrangler) {
  $Version = (& $Wrangler --version 2>$null | Select-Object -First 1)
  if ($TestWhoAmI) {
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Lines = @(& $Wrangler whoami 2>&1)
    $WhoAmIOk = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $PreviousPreference
    $WhoAmIOutput = ($Lines -join "`n")
  }
}

[pscustomobject]@{
  Ok = $true
  User = [Environment]::UserName
  UserProfile = $env:USERPROFILE
  WranglerPresent = Test-Path -LiteralPath $Wrangler
  WranglerVersion = $Version
  ApiTokenUserSet = Test-EnvironmentValue 'CLOUDFLARE_API_TOKEN' 'User'
  ApiTokenMachineSet = Test-EnvironmentValue 'CLOUDFLARE_API_TOKEN' 'Machine'
  AccountIdUserSet = Test-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID' 'User'
  AccountIdMachineSet = Test-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID' 'Machine'
  OAuthProfilePresent = @($OauthCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
  WhoAmIOk = $WhoAmIOk
  WhoAmIOutput = $WhoAmIOutput
} | ConvertTo-Json -Depth 4
