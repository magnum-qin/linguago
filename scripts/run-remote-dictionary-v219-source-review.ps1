param(
  [string]$Root = 'D:\linguago-runner',
  [string]$Report = 'batches\v219-daily-zhja-validation100g.json',
  [string]$Out = 'logs\v219-daily-zhja-source-review20.json',
  [ValidateRange(1, 1000000)][int]$Limit = 100,
  [bool]$Resume = $true,
  [ValidateRange(1, 10)][int]$MaxAttempts = 2,
  [string]$NodeNames = 'a6000-143,rtx4090-56',
  [string]$Endpoints = 'http://100.99.99.99:11441,http://100.99.99.99:11447',
  [string]$Model = 'unsloth/Qwen3.6-35B-A3B-MTP-GGUF',
  [string]$EndpointGgufVariants = '11441=UD-Q4_K_XL,11447=UD-IQ4_NL'
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root
if (-not $env:UNSLOTH_API_KEY) {
  $env:UNSLOTH_API_KEY = [Environment]::GetEnvironmentVariable('UNSLOTH_API_KEY', 'User')
}
if (-not $env:UNSLOTH_API_KEY) { throw 'UNSLOTH_API_KEY not available; no request sent' }
$Dashboard = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/api/status' -TimeoutSec 15
$RequestedNodes = @($NodeNames.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not $RequestedNodes.Count) { throw 'At least one node name is required' }
foreach ($Name in $RequestedNodes) {
  $HostRow = @($Dashboard.hosts | Where-Object { $_.name -eq $Name })
  if ($HostRow.Count -ne 1 -or -not $HostRow[0].agent_reachable -or $HostRow[0].gpu.temp_c -gt 84) { throw "Node not safely available: $Name" }
  $Foreign = @($HostRow[0].processes | Where-Object { $_.gpu_mem_mb -ge 256 -and $_.user -ne 'g24tka12' })
  if ($Foreign.Count) { throw "External GPU process on $Name" }
}
& node.exe scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs `
  --report $Report `
  --source-db data/processed/linguago_v2_full.db `
  --out $Out `
  --limit $Limit --max-attempts $MaxAttempts --checkpoint-every 1 --resume $($Resume.ToString().ToLowerInvariant()) `
  --endpoints $Endpoints `
  --model $Model `
  --endpoint-gguf-variants $EndpointGgufVariants `
  --require-daily-primary true --prompt-mode compact --response-format json-object `
  --max-tokens 512 --max-seq-length 8192 --timeout-ms 90000 --load-timeout-ms 180000
exit $LASTEXITCODE
