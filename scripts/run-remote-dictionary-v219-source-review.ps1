param([string]$Root = 'D:\linguago-runner')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $Root
if (-not $env:UNSLOTH_API_KEY) {
  $env:UNSLOTH_API_KEY = [Environment]::GetEnvironmentVariable('UNSLOTH_API_KEY', 'User')
}
if (-not $env:UNSLOTH_API_KEY) { throw 'UNSLOTH_API_KEY not available; no request sent' }
$Dashboard = Invoke-RestMethod -Uri 'http://127.0.0.1:18080/api/status' -TimeoutSec 15
$Nodes = @{'a6000-143'='11441'; 'rtx4090-56'='11447'}
foreach ($Name in $Nodes.Keys) {
  $HostRow = @($Dashboard.hosts | Where-Object { $_.name -eq $Name })
  if ($HostRow.Count -ne 1 -or -not $HostRow[0].agent_reachable -or $HostRow[0].state -ne 'idle' -or $HostRow[0].gpu.util_gpu -gt 10 -or $HostRow[0].gpu.temp_c -gt 84) { throw "Node not safely idle: $Name" }
  $Foreign = @($HostRow[0].processes | Where-Object { $_.gpu_mem_mb -ge 256 -and $_.user -ne 'g24tka12' })
  if ($Foreign.Count) { throw "External GPU process on $Name" }
}
& node.exe scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs `
  --report batches/v219-daily-zhja-validation100g.json `
  --source-db data/processed/linguago_v2_full.db `
  --out logs/v219-daily-zhja-source-review20.json `
  --limit 20 --max-attempts 1 --checkpoint-every 1 `
  --endpoints http://100.99.99.99:11441,http://100.99.99.99:11447 `
  --model unsloth/Qwen3.6-35B-A3B-MTP-GGUF `
  --endpoint-gguf-variants 11441=UD-Q4_K_XL,11447=UD-IQ4_NL `
  --require-daily-primary true --prompt-mode compact --response-format json-object `
  --max-tokens 512 --max-seq-length 8192 --timeout-ms 90000 --load-timeout-ms 180000
exit $LASTEXITCODE
