param([Parameter(Mandatory = $true)][string]$Config)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Config)) { throw "Launch config not found: $Config" }
$Raw = [IO.File]::ReadAllText($Config, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Arguments = @{}
foreach ($Property in $Raw.PSObject.Properties) { $Arguments[$Property.Name] = $Property.Value }
$LogPath = Join-Path (Split-Path -Parent $Config) 'localized-sense-job.log'
$ExitCode = 0
Start-Transcript -LiteralPath $LogPath -Append | Out-Null
try {
  & (Join-Path $PSScriptRoot 'run-remote-localized-sense-review.ps1') @Arguments
  $ExitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
} catch {
  $ExitCode = 1
  Write-Error ($_ | Out-String)
} finally {
  Stop-Transcript | Out-Null
}
exit $ExitCode
