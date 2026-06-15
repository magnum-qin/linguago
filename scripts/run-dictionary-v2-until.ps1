param(
  [Parameter(Mandatory = $true)][string]$DbPath,
  [Parameter(Mandatory = $true)][string]$Endpoint,
  [Parameter(Mandatory = $true)][string]$TargetLangs,
  [Parameter(Mandatory = $true)][datetime]$StopAt,
  [int]$BatchLimit = 100,
  [string]$Model = "qwen3.6:latest",
  [string]$PromptVersion = "dictionary-v2-localization-v1"
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Output "started=$(Get-Date -Format o)"
Write-Output "db=$DbPath"
Write-Output "endpoint=$Endpoint"
Write-Output "target_langs=$TargetLangs"
Write-Output "stop_at=$($StopAt.ToString('o'))"
Write-Output "batch_limit=$BatchLimit"

while ((Get-Date) -lt $StopAt) {
  $remaining = ($StopAt - (Get-Date)).TotalSeconds
  if ($remaining -lt 90) {
    Write-Output "remaining_seconds=$([math]::Round($remaining, 1)); not starting another batch"
    break
  }

  Write-Output "batch_started=$(Get-Date -Format o)"
  node scripts/run-dictionary-v2-llm-jobs.mjs `
    --db $DbPath `
    --endpoint $Endpoint `
    --model $Model `
    --prompt-version $PromptVersion `
    --target-langs $TargetLangs `
    --limit $BatchLimit `
    --timeout-ms 180000 `
    --prewarm-timeout-ms 180000

  $exitCode = $LASTEXITCODE
  Write-Output "batch_finished=$(Get-Date -Format o) exit_code=$exitCode"
  if ($exitCode -ne 0) {
    Start-Sleep -Seconds 30
  }
}

Write-Output "stopped=$(Get-Date -Format o)"
