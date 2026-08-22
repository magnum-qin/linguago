param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedMainSha256,
  [int]$PollSeconds = 60
)

$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$RunDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
$StatusPath = Join-Path $RunDir 'production-supervisor.json'
$ManifestPath = Join-Path $RunDir 'manifest.json'

function Write-Status([string]$Status, [object]$Details) {
  $Payload = [ordered]@{ run_id = $RunId; status = $Status; updated_at = [DateTime]::UtcNow.ToString('o'); details = $Details }
  [IO.File]::WriteAllText($StatusPath, ($Payload | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
}

try {
  Write-Status 'waiting_for_pipeline' @{}
  while ($true) {
    if (-not (Test-Path -LiteralPath $ManifestPath)) { Start-Sleep -Seconds $PollSeconds; continue }
    $Manifest = [IO.File]::ReadAllText($ManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ([string]$Manifest.status -in @('complete', 'completed', 'succeeded')) { break }
    if ([string]$Manifest.status -in @('failed', 'error', 'stopped', 'cancelled')) {
      throw "Pipeline ended with status=$($Manifest.status)"
    }
    Start-Sleep -Seconds $PollSeconds
  }

  while (Test-Path -LiteralPath (Join-Path $Root 'state\remote-pipeline.lock.json')) {
    Start-Sleep -Seconds 5
  }

  Write-Status 'checking_gates' @{}
  & node.exe (Join-Path $Root 'scripts\check-dictionary-v2-production-run-gates.mjs') `
    --run-dir $RunDir --out (Join-Path $RunDir 'production-gate.json')
  if ($LASTEXITCODE -ne 0) { throw 'Production gates failed' }

  Write-Status 'validating_and_committing' @{}
  $PublishOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\publish-remote-dictionary-controlled-run.ps1') `
    -Root $Root -RunId $RunId -ExpectedMainSha256 $ExpectedMainSha256 -Commit true -ForceValidation
  if ($LASTEXITCODE -ne 0) { throw "Controlled publish failed with exit code $LASTEXITCODE" }

  $Release = [IO.File]::ReadAllText((Join-Path $RunDir 'release-controller.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
  $ManifestFile = Join-Path $Root 'config\remote-runner-files.json'
  $RunnerManifest = [IO.File]::ReadAllText($ManifestFile, [Text.Encoding]::UTF8) | ConvertFrom-Json
  $MainDb = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
  $MainItem = Get-Item -LiteralPath $MainDb
  $MainHash = (Get-FileHash -LiteralPath $MainDb -Algorithm SHA256).Hash
  $DbEntry = @($RunnerManifest.files) | Where-Object { [string]$_.path -eq 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db' } | Select-Object -First 1
  if ($null -eq $DbEntry) { throw 'Product DB entry missing from runner manifest' }
  $DbEntry.bytes = [long]$MainItem.Length
  $DbEntry.sha256 = $MainHash
  $RunnerManifest.generated_at = [DateTime]::UtcNow.ToString('o')
  [IO.File]::WriteAllText($ManifestFile, ($RunnerManifest | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\verify-remote-dictionary-runner.ps1') -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Post-commit runner verification failed' }
  Write-Status 'complete' @{ release = $Release; main_sha256 = $MainHash; publish_output = @($PublishOutput) }
} catch {
  Write-Status 'failed' @{ error = $_.Exception.Message; stack = $_.ScriptStackTrace }
  throw
}
