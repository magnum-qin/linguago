param(
  [string]$Root = 'D:\linguago-runner',
  [switch]$TestWhoAmI,
  [switch]$TestD1,
  [string]$ExpectedAccountId = '',
  [string]$DatabaseName = 'linguago-dictionary'
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
$AccountId = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'User')
$AccountIdMatches = $null
$D1ListOk = $null
$D1DatabaseVisible = $null
$D1ListOutput = $null
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
  if ($TestD1) {
    $PreviousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $Lines = @(& $Wrangler d1 list --json 2>&1)
    $D1ListOk = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $PreviousPreference
    $D1ListOutput = ($Lines -join "`n")
    if ($D1ListOk) {
      try {
        $Databases = @($D1ListOutput | ConvertFrom-Json)
        $D1DatabaseVisible = @($Databases | Where-Object { $_.name -eq $DatabaseName }).Count -gt 0
      } catch {
        $D1ListOk = $false
        $D1DatabaseVisible = $false
      }
    } else {
      $D1DatabaseVisible = $false
    }
  }
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedAccountId)) {
  $AccountIdMatches = $AccountId -eq $ExpectedAccountId
}

$Ok = (Test-Path -LiteralPath $Wrangler)
if ($TestWhoAmI) { $Ok = $Ok -and $WhoAmIOk }
if ($TestD1) { $Ok = $Ok -and $D1ListOk -and $D1DatabaseVisible }
if ($null -ne $AccountIdMatches) { $Ok = $Ok -and $AccountIdMatches }

[pscustomobject]@{
  Ok = $Ok
  User = [Environment]::UserName
  UserProfile = $env:USERPROFILE
  WranglerPresent = Test-Path -LiteralPath $Wrangler
  WranglerVersion = $Version
  ApiTokenUserSet = Test-EnvironmentValue 'CLOUDFLARE_API_TOKEN' 'User'
  ApiTokenMachineSet = Test-EnvironmentValue 'CLOUDFLARE_API_TOKEN' 'Machine'
  AccountIdUserSet = Test-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID' 'User'
  AccountIdMachineSet = Test-EnvironmentValue 'CLOUDFLARE_ACCOUNT_ID' 'Machine'
  AccountId = $AccountId
  ExpectedAccountId = $ExpectedAccountId
  AccountIdMatches = $AccountIdMatches
  OAuthProfilePresent = @($OauthCandidates | Where-Object { Test-Path -LiteralPath $_ }).Count -gt 0
  WhoAmIOk = $WhoAmIOk
  WhoAmIOutput = $WhoAmIOutput
  D1ListOk = $D1ListOk
  D1DatabaseVisible = $D1DatabaseVisible
  DatabaseName = $DatabaseName
  D1ListOutput = $D1ListOutput
} | ConvertTo-Json -Depth 4
