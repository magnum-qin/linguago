[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$TaskName = "Linguago Nightly Dictionary V2",
  [string]$StartTime = "23:05",
  [string]$DbPath = "data/processed/linguago_v2_full.db",
  [switch]$SkipD1Push
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts/nightly-dictionary-v2-orchestrator.ps1"

if (-not (Test-Path -LiteralPath $script)) {
  throw "Missing orchestrator script: $script"
}

$args = @(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-File", "`"$script`"",
  "-DbPath", "`"$DbPath`""
)

if ($SkipD1Push) {
  $args += "-SkipD1Push"
}

if ($WhatIfPreference) {
  Write-Output "What if: install scheduled task '$TaskName' at $StartTime"
  Write-Output "Command: powershell.exe $($args -join ' ')"
  exit 0
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ($args -join " ") -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 10) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable

if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task")) {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Run Linguago dictionary v2 LLM jobs on idle GPU nodes from 23:00 to 08:00, then push to Cloudflare D1." `
    -Force | Out-Null
}

Write-Output "Installed scheduled task: $TaskName at $StartTime"
