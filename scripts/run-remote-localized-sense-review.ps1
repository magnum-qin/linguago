param(
  [string]$Root = 'D:\linguago-runner',
  [string]$RunId = ('localized-sense-review-' + (Get-Date -Format 'yyyyMMdd-HHmmss')),
  [int]$Limit = 100,
  [int]$Concurrency = 4,
  [int]$TimeoutMs = 60000,
  [int]$CheckpointEvery = 10,
  [string]$RiskInput = '',
  [string]$QwenOut = '',
  [string]$GemmaOut = '',
  [string]$ConsensusOut = '',
  [switch]$SkipSecondary,
  [switch]$SecondaryReviewAll
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($Root)
$runDir = [IO.Path]::GetFullPath((Join-Path $Root (Join-Path 'runs' $RunId)))
if (-not $runDir.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw 'RunId escapes runner root' }
$db = Join-Path $Root 'data\processed\linguago_v2_product_top5000_freedict_filtered_candidate.db'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$statusPath = Join-Path $runDir 'localized-sense-status.json'
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

function Resolve-RunnerPath([string]$Value, [string]$Default) {
  $Selected = if ([string]::IsNullOrWhiteSpace($Value)) { $Default } else { $Value }
  $Resolved = if ([IO.Path]::IsPathRooted($Selected)) { [IO.Path]::GetFullPath($Selected) } else { [IO.Path]::GetFullPath((Join-Path $Root $Selected)) }
  if (-not $Resolved.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase)) { throw "Path escapes runner root: $Selected" }
  return $Resolved
}
function Write-Status([string]$Stage, [string]$State, [string]$Message = '') {
  $Payload = [ordered]@{ ok=$State -ne 'failed'; run_id=$RunId; stage=$Stage; state=$State; message=$Message; updated_at=[DateTime]::UtcNow.ToString('o'); pid=$PID; database_write=$false }
  $Temporary = "$statusPath.$PID.tmp"
  [IO.File]::WriteAllText($Temporary, ($Payload | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $Temporary -Destination $statusPath -Force
}

$risk = Resolve-RunnerPath $RiskInput (Join-Path $runDir '00-localized-sense-risk.json')
$qwen = Resolve-RunnerPath $QwenOut (Join-Path $runDir '01-qwen-review.json')
$gemma = Resolve-RunnerPath $GemmaOut (Join-Path $runDir '02-gemma-review.json')
$consensus = Resolve-RunnerPath $ConsensusOut (Join-Path $runDir '03-consensus.json')
$key = [Environment]::GetEnvironmentVariable('UNSLOTH_API_KEY', 'User')
if ([string]::IsNullOrWhiteSpace($key)) { throw 'User UNSLOTH_API_KEY is missing' }
$env:UNSLOTH_API_KEY = $key

try {
  if (-not (Test-Path -LiteralPath $risk)) {
    Write-Status 'risk' 'running'
    & $node (Join-Path $Root 'scripts\report-dictionary-v2-localized-sense-isolation-risk.mjs') --db $db --out $risk --limit $Limit
    if ($LASTEXITCODE -ne 0) { throw 'Risk report failed' }
  }
  Write-Status 'qwen' 'running'
  & $node (Join-Path $Root 'scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs') `
    --input $risk --out $qwen --role primary --limit $Limit --concurrency $Concurrency `
    --checkpoint-every $CheckpointEvery --timeout-ms $TimeoutMs --max-attempts 2 `
    --dashboard-url 'http://127.0.0.1:18080/api/status' --resume true
  if ($LASTEXITCODE -ne 0) { throw 'Qwen review failed' }

  if (-not $SkipSecondary) {
    Write-Status 'gemma' 'running'
    $SecondaryArgs = @(
      (Join-Path $Root 'scripts\review-dictionary-v2-localized-sense-isolation-unsloth.mjs'),
      '--input', $qwen, '--out', $gemma, '--role', 'secondary', '--limit', $Limit,
      '--concurrency', $Concurrency, '--checkpoint-every', $CheckpointEvery,
      '--timeout-ms', $TimeoutMs, '--max-attempts', 2,
      '--dashboard-url', 'http://127.0.0.1:18080/api/status', '--resume', 'true'
    )
    if ($SecondaryReviewAll) { $SecondaryArgs += @('--secondary-review-all', 'true') }
    & $node @SecondaryArgs
    if ($LASTEXITCODE -ne 0) { throw 'Gemma review failed' }
    Write-Status 'consensus' 'running'
    & $node (Join-Path $Root 'scripts\adjudicate-dictionary-v2-localized-sense-reviews.mjs') `
      --primary $qwen --secondary $gemma --out $consensus --confidence-threshold 0.9
    if ($LASTEXITCODE -ne 0) { throw 'Consensus adjudication failed' }
  }
  Write-Status 'complete' 'complete'
} catch {
  Write-Status 'pipeline' 'failed' ($_ | Out-String)
  throw
}

[pscustomobject]@{ Ok=$true; RunId=$RunId; RunDir=$runDir; Status=$statusPath; DatabaseWrite=$false; QwenReport=$qwen; GemmaReport=$(if($SkipSecondary){$null}else{$gemma}); ConsensusReport=$(if($SkipSecondary){$null}else{$consensus}) } | ConvertTo-Json -Depth 4
