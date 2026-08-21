param(
  [ValidateSet('verify', 'new-batch', 'start', 'status', 'stop', 'validate', 'commit', 'd1-dry-run', 'd1-publish', 'stage-worker', 'worker-dry-run', 'worker-deploy')]
  [string]$Action = 'status',
  [string]$HostAlias = 'ts-win-jump',
  [string]$RunId = '',
  [string]$Batch = '',
  [int]$Limit = 100,
  [int]$GenerationTarget = 20,
  [string]$SupplementalSourceDb = '',
  [object]$ReverseEvidencePrefilter = $false,
  [object]$SourceSenseAlignment = $false,
  [int]$ReverseEvidenceMinTargetLangs = 2,
  [int]$ReverseEvidencePrefilterLimit = 1000000,
  [object]$EnforceGenerationHintTerms = $false,
  [string]$ExpectedMainSha256 = '',
  [string]$DbPath = '',
  [string]$ExpectedDbSha256 = '',
  [string]$Commit = 'HEAD',
  [string]$ExpectedArchiveSha256 = '',
  [string]$ExpectedCacheVersion = ''
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RemoteRoot = 'D:\linguago-runner'

function Require-Value([string]$Value, [string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is required for action $Action" }
}

function Invoke-RemoteScript([string]$Script, [string[]]$Arguments = @()) {
  $RemoteScript = Join-Path "$RemoteRoot\scripts" $Script
  $SshArgs = @(
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', $HostAlias,
    'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $RemoteScript
  ) + $Arguments
  & ssh.exe @SshArgs
  if ($LASTEXITCODE -ne 0) { throw "Remote action failed: $Script exit=$LASTEXITCODE" }
}

function Invoke-RemotePowerShell([string]$Script) {
  $Encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Script))
  & ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $HostAlias `
    powershell.exe -NoProfile -EncodedCommand $Encoded
  if ($LASTEXITCODE -ne 0) { throw "Remote PowerShell command failed with exit=$LASTEXITCODE" }
}

switch ($Action) {
  'verify' {
    Invoke-RemoteScript 'verify-remote-dictionary-runner.ps1'
  }
  'new-batch' {
    if ($Limit -lt 1 -or $Limit -gt 5000) { throw 'Limit must be between 1 and 5000' }
    Invoke-RemoteScript 'new-remote-dictionary-production-batch.ps1' @('-Limit', [string]$Limit)
  }
  'start' {
    Require-Value $RunId 'RunId'
    Require-Value $Batch 'Batch'
    $StartArguments = @(
      '-Action', 'start', '-RunId', $RunId, '-Batch', $Batch,
      '-GenerationTarget', [string]$GenerationTarget,
      '-ReverseEvidencePrefilter', [string]$ReverseEvidencePrefilter,
      '-SourceSenseAlignment', [string]$SourceSenseAlignment,
      '-ReverseEvidenceMinTargetLangs', [string]$ReverseEvidenceMinTargetLangs,
      '-ReverseEvidencePrefilterLimit', [string]$ReverseEvidencePrefilterLimit,
      '-EnforceGenerationHintTerms', [string]$EnforceGenerationHintTerms
    )
    if (-not [string]::IsNullOrWhiteSpace($SupplementalSourceDb)) {
      $StartArguments += @('-SupplementalSourceDb', $SupplementalSourceDb)
    }
    Invoke-RemoteScript 'manage-remote-dictionary-runner.ps1' $StartArguments
  }
  'status' {
    Require-Value $RunId 'RunId'
    Invoke-RemoteScript 'watch-remote-dictionary-runner.ps1' @('-RunId', $RunId)
  }
  'stop' {
    Require-Value $RunId 'RunId'
    Invoke-RemoteScript 'manage-remote-dictionary-runner.ps1' @('-Action', 'stop', '-RunId', $RunId)
  }
  'validate' {
    Require-Value $RunId 'RunId'
    $Base = "backups\$RunId-local-control-validation-base.db"
    & ssh.exe -o BatchMode=yes -o ConnectTimeout=10 $HostAlias cmd.exe /d /c copy /Y `
      "$RemoteRoot\data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db" `
      "$RemoteRoot\$Base"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create remote validation base' }
    Invoke-RemoteScript 'validate-remote-dictionary-controlled-replay.ps1' @(
      '-RunId', $RunId, '-BaseDb', $Base, '-Force'
    )
  }
  'commit' {
    Require-Value $RunId 'RunId'
    Require-Value $ExpectedMainSha256 'ExpectedMainSha256'
    Invoke-RemoteScript 'publish-remote-dictionary-controlled-run.ps1' @(
      '-RunId', $RunId, '-ExpectedMainSha256', $ExpectedMainSha256,
      '-Commit', 'true', '-ForceValidation'
    )
  }
  'd1-dry-run' {
    Require-Value $RunId 'RunId'
    Require-Value $DbPath 'DbPath'
    Require-Value $ExpectedDbSha256 'ExpectedDbSha256'
    Invoke-RemoteScript 'release-remote-dictionary-d1.ps1' @(
      '-RunId', $RunId, '-DbPath', $DbPath,
      '-ExpectedDbSha256', $ExpectedDbSha256, '-Execute', 'false'
    )
  }
  'd1-publish' {
    Require-Value $RunId 'RunId'
    Require-Value $ExpectedMainSha256 'ExpectedMainSha256'
    Invoke-RemoteScript 'release-remote-dictionary-d1.ps1' @(
      '-RunId', $RunId,
      '-DbPath', "$RemoteRoot\data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db",
      '-ExpectedDbSha256', $ExpectedMainSha256, '-Execute', 'true'
    )
  }
  'stage-worker' {
    Set-Location $Root
    $ResolvedCommit = (& git.exe rev-parse $Commit).Trim()
    if ($LASTEXITCODE -ne 0 -or $ResolvedCommit -notmatch '^[0-9a-f]{40}$') {
      throw "Cannot resolve Git commit: $Commit"
    }
    $Dirty = @(& git.exe status --porcelain)
    if ($Dirty.Count -gt 0) {
      throw 'Refusing to stage Worker source from a dirty worktree; commit or stash changes first'
    }
    $Archive = Join-Path $env:TEMP "linguago-worker-$ResolvedCommit.zip"
    & git.exe archive --format=zip --output=$Archive $ResolvedCommit
    if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
    $Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash
    $RemoteArchive = "$RemoteRoot\incoming\linguago-worker-$ResolvedCommit.zip"
    Invoke-RemotePowerShell "New-Item -ItemType Directory -Path '$RemoteRoot\incoming' -Force | Out-Null"
    & scp.exe $Archive "${HostAlias}:D:/linguago-runner/incoming/linguago-worker-$ResolvedCommit.zip"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to upload Worker source archive' }
    Invoke-RemoteScript 'stage-remote-worker-source.ps1' @(
      '-Commit', $ResolvedCommit, '-Archive', $RemoteArchive,
      '-ExpectedArchiveSha256', $Hash
    )
  }
  'worker-dry-run' {
    Require-Value $Commit 'Commit'
    Require-Value $ExpectedArchiveSha256 'ExpectedArchiveSha256'
    Require-Value $ExpectedCacheVersion 'ExpectedCacheVersion'
    Invoke-RemoteScript 'deploy-remote-worker-release.ps1' @(
      '-Commit', $Commit, '-ExpectedArchiveSha256', $ExpectedArchiveSha256,
      '-ExpectedCacheVersion', $ExpectedCacheVersion, '-Execute', 'false'
    )
  }
  'worker-deploy' {
    Require-Value $Commit 'Commit'
    Require-Value $ExpectedArchiveSha256 'ExpectedArchiveSha256'
    Require-Value $ExpectedCacheVersion 'ExpectedCacheVersion'
    Invoke-RemoteScript 'deploy-remote-worker-release.ps1' @(
      '-Commit', $Commit, '-ExpectedArchiveSha256', $ExpectedArchiveSha256,
      '-ExpectedCacheVersion', $ExpectedCacheVersion, '-Execute', 'true'
    )
  }
}
