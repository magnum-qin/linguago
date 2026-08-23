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
$ScriptPath = Join-Path $Root 'scripts\complete-remote-dictionary-production-run.ps1'
if (-not (Test-Path -LiteralPath $ScriptPath)) { throw "Supervisor script not found: $ScriptPath" }

$Existing = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -like '*complete-remote-dictionary-production-run.ps1*' -and
    $_.CommandLine -like "*$RunId*"
  } |
  Select-Object -First 1
if ($Existing) {
  [pscustomobject]@{ Ok = $true; RunId = $RunId; AlreadyRunning = $true; Pid = $Existing.ProcessId } |
    ConvertTo-Json
  exit 0
}

New-Item -ItemType Directory -Path $RunDir -Force | Out-Null
$Stdout = Join-Path $RunDir 'production-supervisor.stdout.log'
$Stderr = Join-Path $RunDir 'production-supervisor.stderr.log'
$Arguments = @(
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', $ScriptPath,
  '-Root', $Root,
  '-RunId', $RunId,
  '-ExpectedMainSha256', $ExpectedMainSha256,
  '-PollSeconds', [string]$PollSeconds
)
$Process = Start-Process powershell.exe `
  -ArgumentList $Arguments `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $Stdout `
  -RedirectStandardError $Stderr `
  -PassThru

[pscustomobject]@{
  Ok = $true
  RunId = $RunId
  AlreadyRunning = $false
  Pid = $Process.Id
  Stdout = $Stdout
  Stderr = $Stderr
} | ConvertTo-Json
