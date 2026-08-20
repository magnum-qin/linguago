param(
  [string]$Root = 'D:\linguago-runner',
  [Parameter(Mandatory = $true)]
  [string]$Commit,
  [Parameter(Mandatory = $true)]
  [string]$Archive,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedArchiveSha256
)

$ErrorActionPreference = 'Stop'
$Commit = $Commit.Trim().ToLowerInvariant()
if ($Commit -notmatch '^[0-9a-f]{40}$') { throw 'Commit must be a full 40-character Git SHA' }

$Root = [IO.Path]::GetFullPath($Root)
$ArchivePath = [IO.Path]::GetFullPath($Archive)
$IncomingRoot = [IO.Path]::GetFullPath((Join-Path $Root 'incoming'))
if (-not $ArchivePath.StartsWith($IncomingRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Archive must stay under the runner incoming directory'
}
if (-not (Test-Path -LiteralPath $ArchivePath)) { throw "Archive not found: $ArchivePath" }

$ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToUpperInvariant()
$ExpectedHash = $ExpectedArchiveSha256.Trim().ToUpperInvariant()
if ($ActualHash -ne $ExpectedHash) {
  throw "Archive hash mismatch: expected=$ExpectedHash actual=$ActualHash"
}

$DeployRoot = [IO.Path]::GetFullPath('D:\linguago-deploy')
$ReleasesRoot = Join-Path $DeployRoot 'releases'
$ReleaseDir = Join-Path $ReleasesRoot $Commit
$MetadataPath = Join-Path $ReleaseDir '.linguago-release.json'
New-Item -ItemType Directory -Path $ReleasesRoot -Force | Out-Null

if (Test-Path -LiteralPath $ReleaseDir) {
  if (-not (Test-Path -LiteralPath $MetadataPath)) {
    throw "Existing release lacks metadata: $ReleaseDir"
  }
  $Existing = [IO.File]::ReadAllText($MetadataPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if ($Existing.commit -ne $Commit -or $Existing.archive_sha256 -ne $ActualHash) {
    throw "Existing release metadata mismatch: $ReleaseDir"
  }
} else {
  $Staging = Join-Path $DeployRoot ("staging-$Commit-$PID")
  New-Item -ItemType Directory -Path $Staging -Force | Out-Null
  try {
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Staging -Force
    foreach ($Required in @('package.json', 'package-lock.json', 'wrangler.jsonc', 'worker\index.ts', 'src\main.ts')) {
      if (-not (Test-Path -LiteralPath (Join-Path $Staging $Required))) {
        throw "Release archive is missing required file: $Required"
      }
    }
    $Metadata = [ordered]@{
      commit = $Commit
      archive_sha256 = $ActualHash
      staged_at = [DateTime]::UtcNow.ToString('o')
      source = 'local-git-archive'
    }
    [IO.File]::WriteAllText(
      (Join-Path $Staging '.linguago-release.json'),
      ($Metadata | ConvertTo-Json -Depth 4),
      (New-Object Text.UTF8Encoding($false))
    )
    Move-Item -LiteralPath $Staging -Destination $ReleaseDir
  } finally {
    if (Test-Path -LiteralPath $Staging) {
      Remove-Item -LiteralPath $Staging -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

$CurrentPath = Join-Path $DeployRoot 'current.json'
$Current = [ordered]@{
  commit = $Commit
  archive_sha256 = $ActualHash
  release_dir = $ReleaseDir
  selected_at = [DateTime]::UtcNow.ToString('o')
}
[IO.File]::WriteAllText(
  $CurrentPath,
  ($Current | ConvertTo-Json -Depth 4),
  (New-Object Text.UTF8Encoding($false))
)

[pscustomobject]@{
  Ok = $true
  Commit = $Commit
  ArchiveSha256 = $ActualHash
  ReleaseDir = $ReleaseDir
  Current = $CurrentPath
} | ConvertTo-Json -Depth 4
