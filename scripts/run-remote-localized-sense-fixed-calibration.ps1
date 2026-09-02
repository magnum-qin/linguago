param(
  [string]$Root = 'D:\linguago-runner',
  [string]$Input = 'runs\localized-sense-review-v7-fixed25-input.json',
  [string]$RunId = 'localized-sense-review-v7-fixed25',
  [int]$Limit = 25,
  [int]$Concurrency = 4
)
$ErrorActionPreference = 'Stop'
$node = 'C:\nvm4w\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { throw "Node runtime not found: $node" }
Set-Location $Root
$qwen = "runs\$RunId-qwen.json"
$gemma = "runs\$RunId-gemma.json"
$consensus = "runs\$RunId-consensus.json"

& $node 'scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs' `
  --input $Input --out $qwen --role primary --limit $Limit --concurrency $Concurrency `
  --dashboard-url 'http://127.0.0.1:18080/api/status' --resume false
if ($LASTEXITCODE -ne 0) { throw 'Primary calibration review failed' }

& $node 'scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs' `
  --input $qwen --out $gemma --role secondary --limit $Limit --concurrency $Concurrency `
  --dashboard-url 'http://127.0.0.1:18080/api/status' --resume false
if ($LASTEXITCODE -ne 0) { throw 'Secondary calibration review failed' }

& $node 'scripts\adjudicate-dictionary-v2-localized-sense-reviews.mjs' `
  --primary $qwen --secondary $gemma --out $consensus --confidence-threshold 0.9
if ($LASTEXITCODE -ne 0) { throw 'Calibration adjudication failed' }

@{ Ok = $true; DatabaseWrite = $false; Qwen = $qwen; Gemma = $gemma; Consensus = $consensus } |
  ConvertTo-Json -Depth 4
