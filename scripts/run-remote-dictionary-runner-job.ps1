param(
  [string]$Config
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($Config) -or -not (Test-Path -LiteralPath $Config)) {
  throw "Launch config not found: $Config"
}
$Raw = [IO.File]::ReadAllText($Config, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Arguments = @{}
foreach ($Property in $Raw.PSObject.Properties) {
  $Arguments[$Property.Name] = $Property.Value
}
$Manager = Join-Path $PSScriptRoot 'manage-remote-dictionary-runner.ps1'
$ErrorLog = Join-Path (Split-Path -Parent $Config) 'scheduled-task-error.log'
try {
  & $Manager @Arguments
  exit $LASTEXITCODE
} catch {
  $Message = "[$([DateTime]::UtcNow.ToString('o'))] $($_ | Out-String)"
  [IO.File]::AppendAllText($ErrorLog, $Message, [Text.UTF8Encoding]::new($false))
  throw
}
