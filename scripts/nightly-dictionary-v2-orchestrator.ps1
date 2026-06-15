param(
  [string]$DbPath = "data/processed/linguago_v2_full.db",
  [string]$Model = "qwen3.6:latest",
  [string]$PromptVersion = "dictionary-v2-localization-v1",
  [int]$StartHour = 23,
  [int]$EndHour = 8,
  [int]$BatchLimit = 100,
  [int]$MinIdleMinutes = 5,
  [int]$MaxGpuUtil = 10,
  [int]$MaxMemoryUsedMb = 4096,
  [switch]$SkipD1Push,
  [switch]$ForceNow,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$stateDir = Join-Path $root "state"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $stateDir, $logDir | Out-Null

$lockPath = Join-Path $stateDir "nightly-dictionary-v2.lock"
$lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)

try {
  $runId = "nightly-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
  $runLogDir = Join-Path $logDir $runId
  New-Item -ItemType Directory -Force -Path $runLogDir | Out-Null
  $mainLog = Join-Path $runLogDir "orchestrator.log"

  function Write-Log {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format o), $Message
    Write-Output $line
    Add-Content -LiteralPath $mainLog -Value $line
  }

  function In-Window {
    $now = Get-Date
    if ($StartHour -gt $EndHour) {
      return ($now.Hour -ge $StartHour -or $now.Hour -lt $EndHour)
    }
    return ($now.Hour -ge $StartHour -and $now.Hour -lt $EndHour)
  }

  function Get-StopAt {
    $now = Get-Date
    $candidate = Get-Date -Hour $EndHour -Minute 0 -Second 0
    if ($StartHour -gt $EndHour -and $now.Hour -ge $StartHour) {
      $candidate = $candidate.AddDays(1)
    }
    if ($candidate -le $now) {
      $candidate = $candidate.AddDays(1)
    }
    return $candidate
  }

  function Test-GpuIdle {
    param([string]$SshHost)
    try {
      Write-Log "gpu_idle_start ssh=$SshHost"
      $remoteCommand = "timeout 8 nvidia-smi --query-compute-apps=pid --format=csv,noheader | grep -q ."
      & ssh.exe `
        -n `
        -o BatchMode=yes `
        -o StrictHostKeyChecking=accept-new `
        -o ConnectTimeout=8 `
        $SshHost `
        $remoteCommand
      $code = $LASTEXITCODE
      if ($code -eq 0) {
        Write-Log "gpu_idle_done ssh=$SshHost idle=false reason=gpu_busy"
        return [pscustomobject]@{ Idle = $false; Reason = "gpu_busy" }
      }
      if ($code -eq 1) {
        Write-Log "gpu_idle_done ssh=$SshHost idle=true"
        return [pscustomobject]@{ Idle = $true; Reason = "idle" }
      }
      Write-Log "gpu_idle_error ssh=$SshHost exit=$code"
      return [pscustomobject]@{ Idle = $false; Reason = "gpu_status_unavailable exit=$code" }
    } catch {
      Write-Log "gpu_idle_error ssh=$SshHost error=$($_.Exception.Message)"
      return [pscustomobject]@{ Idle = $false; Reason = "gpu_status_unavailable" }
    }
  }

  function Test-NodeIdle {
    param([pscustomobject]$Node)

    $gpu = Test-GpuIdle -SshHost $Node.SshHost
    if (-not $gpu.Idle) { return [pscustomobject]@{ Idle = $false; Reason = $gpu.Reason } }

    Start-Sleep -Seconds ([Math]::Max(0, $MinIdleMinutes * 60))
    $gpu2 = Test-GpuIdle -SshHost $Node.SshHost
    if (-not $gpu2.Idle) { return [pscustomobject]@{ Idle = $false; Reason = "idle_recheck_failed $($gpu2.Reason)" } }

    return [pscustomobject]@{ Idle = $true; Reason = "idle" }
  }

  $nodes = @(
    [pscustomobject]@{ Alias = "a6000-143"; SshHost = "g24tka12@192.168.2.143"; Endpoint = "http://192.168.2.143:11433"; TargetLangs = "en,zh" },
    [pscustomobject]@{ Alias = "a6000-144"; SshHost = "g24tka12@192.168.2.151"; Endpoint = "http://192.168.2.151:11433"; TargetLangs = "ja" },
    [pscustomobject]@{ Alias = "a6000-048"; SshHost = "g24tka12@172.23.4.48"; Endpoint = "http://172.23.4.48:11433"; TargetLangs = "pt-BR" },
    [pscustomobject]@{ Alias = "a6000-147"; SshHost = "g24tka12@172.23.4.53"; Endpoint = "http://172.23.4.53:11433"; TargetLangs = "en,zh,ja,pt-BR" }
  )

  if (-not $ForceNow -and -not (In-Window)) {
    Write-Log "outside_window start_hour=$StartHour end_hour=$EndHour"
    exit 0
  }

  $stopAt = Get-StopAt
  Write-Log "started run_id=$runId db=$DbPath model=$Model stop_at=$($stopAt.ToString("o")) dry_run=$DryRun"

  $idleNodes = @()
  foreach ($node in $nodes) {
    Write-Log "node_check_start node=$($node.Alias) endpoint=$($node.Endpoint) ssh=$($node.SshHost)"
    $status = Test-NodeIdle -Node $node
    Write-Log "node=$($node.Alias) endpoint=$($node.Endpoint) idle=$($status.Idle) reason=$($status.Reason)"
    if ($status.Idle) { $idleNodes += $node }
  }

  if ($idleNodes.Count -eq 0) {
    Write-Log "no_idle_nodes"
    exit 0
  }

  $processes = @()
  foreach ($node in $idleNodes) {
    $stdout = Join-Path $runLogDir "$($node.Alias).out.log"
    $stderr = Join-Path $runLogDir "$($node.Alias).err.log"
    $args = @(
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", (Join-Path $root "scripts/run-dictionary-v2-until.ps1"),
      "-DbPath", $DbPath,
      "-Endpoint", $node.Endpoint,
      "-TargetLangs", $node.TargetLangs,
      "-StopAt", $stopAt.ToString("o"),
      "-BatchLimit", [string]$BatchLimit,
      "-Model", $Model,
      "-PromptVersion", $PromptVersion
    )
    Write-Log "worker_start node=$($node.Alias) target_langs=$($node.TargetLangs) stdout=$stdout"
    if (-not $DryRun) {
      $processes += Start-Process powershell.exe -ArgumentList $args -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru -WindowStyle Hidden
    }
  }

  if (-not $DryRun) {
    while ((Get-Date) -lt $stopAt -and @($processes | Where-Object { -not $_.HasExited }).Count -gt 0) {
      Start-Sleep -Seconds 60
    }
    foreach ($process in $processes) {
      if (-not $process.HasExited) {
        Write-Log "worker_stop pid=$($process.Id)"
        Stop-Process -Id $process.Id -Force
      }
    }
    foreach ($process in $processes) {
      $process.WaitForExit()
      Write-Log "worker_exit pid=$($process.Id) exit_code=$($process.ExitCode)"
    }
  }

  if (-not $SkipD1Push) {
    Write-Log "d1_push_start"
    if (-not $DryRun) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts/push-dictionary-v2-to-d1.ps1") -DbPath $DbPath
      if ($LASTEXITCODE -ne 0) { throw "D1 push failed" }
    }
    Write-Log "d1_push_done"
  }

  Write-Log "completed"
} finally {
  if ($lockStream) { $lockStream.Dispose() }
}
