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

  Write-Status 'validating_and_committing' @{}
  $PublishLog = Join-Path $RunDir 'controlled-publish-supervisor.log'
  $PublishOutput = @()
  $PublishExitCode = 1
  [IO.File]::WriteAllText($PublishLog, '', (New-Object Text.UTF8Encoding($false)))
  for ($Attempt = 1; $Attempt -le 2; $Attempt++) {
    $AttemptHeader = "[attempt $Attempt started=$([DateTime]::UtcNow.ToString('o'))]"
    [IO.File]::AppendAllText($PublishLog, "$AttemptHeader`r`n", (New-Object Text.UTF8Encoding($false)))
    $AttemptOutput = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
      (Join-Path $Root 'scripts\publish-remote-dictionary-controlled-run.ps1') `
      -Root $Root -RunId $RunId -ExpectedMainSha256 $ExpectedMainSha256 -Commit true -ForceValidation 2>&1 | `
      Tee-Object -FilePath $PublishLog -Append)
    $PublishExitCode = $LASTEXITCODE
    $AttemptFooter = "[attempt $Attempt exit=$PublishExitCode ended=$([DateTime]::UtcNow.ToString('o'))]"
    $PublishOutput += @($AttemptHeader) + $AttemptOutput + @($AttemptFooter)
    [IO.File]::AppendAllText($PublishLog, "$AttemptFooter`r`n", (New-Object Text.UTF8Encoding($false)))
    if ($PublishExitCode -eq 0) { break }
    if ($Attempt -lt 2) {
      Write-Status 'retrying_controlled_publish' @{ attempt = $Attempt; exit_code = $PublishExitCode; log = $PublishLog }
      Start-Sleep -Seconds 5
    }
  }
  if ($PublishExitCode -ne 0) {
    throw "Controlled publish failed after 2 attempts with exit code $PublishExitCode; log=$PublishLog"
  }

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
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $Root 'scripts\new-remote-dictionary-runner-manifest.ps1') -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Runner manifest refresh failed' }

  $CohortReport = Join-Path $RunDir 'release-cohort-status.json'
  $CohortOutput = @(& node.exe (Join-Path $Root 'scripts\report-dictionary-v2-release-cohort.mjs') `
    --db $MainDb `
    --baseline (Join-Path $Root 'config\dictionary-v2-online-baseline.json') `
    --out $CohortReport 2>&1)
  $CohortExitCode = $LASTEXITCODE

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\verify-remote-dictionary-runner.ps1') -Root $Root
  if ($LASTEXITCODE -ne 0) { throw 'Post-commit runner verification failed' }
  Write-Status 'complete' @{
    release = $Release
    main_sha256 = $MainHash
    publish_log = $PublishLog
    publish_output = @($PublishOutput)
    release_cohort_report = $CohortReport
    release_cohort_exit_code = $CohortExitCode
    release_cohort_output = @($CohortOutput)
  }
} catch {
  Write-Status 'failed' @{ error = $_.Exception.Message; stack = $_.ScriptStackTrace; publish_log = (Join-Path $RunDir 'controlled-publish-supervisor.log') }
  throw
}
