param(
  [string]$Root = 'D:\linguago-runner',
  [int]$Limit = 100,
  [string]$Name = 'v219-daily-mixed-validation100',
  [string]$HeadwordLanguageQuotas = ''
)

$ErrorActionPreference = 'Stop'
if ($Limit -lt 1 -or $Limit -gt 500) { throw 'Limit must be between 1 and 500' }
$Root = [IO.Path]::GetFullPath($Root)
$NominalHeadwordLimit = [Math]::Ceiling($Limit * 0.60)
$HeadwordLimit = $Limit
$AdditionalLimit = $Limit - $NominalHeadwordLimit
$HeadwordZh = [Math]::Floor($HeadwordLimit * 0.30)
$HeadwordJa = [Math]::Floor($HeadwordLimit * 0.30)
$HeadwordPt = [Math]::Floor($HeadwordLimit * 0.25)
$HeadwordEn = $HeadwordLimit - $HeadwordZh - $HeadwordJa - $HeadwordPt
$HeadwordLangQuotas = "zh=$HeadwordZh,ja=$HeadwordJa,pt-BR=$HeadwordPt,en=$HeadwordEn"
if ($HeadwordLanguageQuotas) {
  $Seen = @{}
  $Total = 0
  foreach ($Part in $HeadwordLanguageQuotas.Split(',')) {
    if ($Part -notmatch '^(zh|ja|pt-BR|en)=(\d+)$') { throw 'Invalid headword language quota' }
    $Lang = $Matches[1]
    if ($Seen.ContainsKey($Lang)) { throw "Duplicate language quota: $Lang" }
    $Seen[$Lang] = [int]$Matches[2]
    $Total += $Seen[$Lang]
  }
  if ($Total -ne $HeadwordLimit) { throw 'Headword language quotas must sum to Limit' }
  $HeadwordLangQuotas = (@('zh','ja','pt-BR','en') | ForEach-Object { "$($_)=$([int]$Seen[$_])" }) -join ','
}
$Headwords = "batches\$Name-headwords.json"
$Additional = "batches\$Name-additional-senses.json"
$Merged = "batches\$Name.json"
$Audit = "logs\$Name-audit.json"

& node.exe (Join-Path $Root 'scripts\build-dictionary-v2-additional-sense-attempt-index.mjs') `
  --root $Root --runs-root 'runs' --out 'state\additional-sense-attempt-index.json'
if ($LASTEXITCODE -ne 0) { throw "Additional-sense attempt index failed with exit=$LASTEXITCODE" }

& (Join-Path $Root 'scripts\new-remote-dictionary-production-batch.ps1') `
  -Root $Root -Limit $HeadwordLimit -Out $Headwords -CandidateMode native-daily `
  -NativeLangQuotas $HeadwordLangQuotas -SkipVerify
if ($LASTEXITCODE -ne 0) { throw "Headword lane failed with exit=$LASTEXITCODE" }

& (Join-Path $Root 'scripts\new-remote-dictionary-production-batch.ps1') `
  -Root $Root -Limit $AdditionalLimit -Out $Additional -CandidateMode additional-sense `
  -AdditionalSenseAttemptIndex 'state\additional-sense-attempt-index.json' -SkipVerify
if ($LASTEXITCODE -ne 0) { throw "Additional-sense lane failed with exit=$LASTEXITCODE" }

& node.exe (Join-Path $Root 'scripts\merge-dictionary-v2-daily-production-lanes.mjs') `
  --headwords (Join-Path $Root $Headwords) --additional-senses (Join-Path $Root $Additional) `
  --out (Join-Path $Root $Merged) --headword-limit $NominalHeadwordLimit --additional-sense-limit $AdditionalLimit
if ($LASTEXITCODE -ne 0) { throw "Lane merge failed with exit=$LASTEXITCODE" }

& node.exe (Join-Path $Root 'scripts\audit-dictionary-v2-daily-candidate-cohort.mjs') `
  --report (Join-Path $Root $Merged) --out (Join-Path $Root $Audit) `
  --inspect-count ([Math]::Min(50, $Limit)) --minimum-candidates $Limit
$AuditExit = $LASTEXITCODE
$AuditResult = [IO.File]::ReadAllText((Join-Path $Root $Audit), [Text.Encoding]::UTF8) | ConvertFrom-Json
$Selected = [int]$AuditResult.summary.selected_count
$ShortfallOnly = $AuditExit -eq 2 -and $AuditResult.summary.findings -eq 0 -and $Selected -lt $Limit
$Status = if ($ShortfallOnly -and $Selected -eq 0) { 'candidate_exhausted' } elseif ($ShortfallOnly) { 'candidate_shortfall' } elseif ($AuditExit -eq 0) { 'ready_for_semantic_review' } else { 'candidate_quality_review_required' }

[pscustomobject]@{
  Ok = ($AuditExit -eq 0 -or $ShortfallOnly)
  Status = $Status
  ValidationGatePassed = $AuditExit -eq 0
  Selected = $Selected
  HeadwordLanguageQuotas = $HeadwordLangQuotas
  CandidateReport = Join-Path $Root $Merged
  AuditReport = Join-Path $Root $Audit
  Requested = $Limit
  HeadwordTarget = $NominalHeadwordLimit
  AdditionalSenseTarget = $AdditionalLimit
  DatabaseWriteAttempted = $false
  GpuStarted = $false
} | ConvertTo-Json -Depth 4
if ($ShortfallOnly) { exit 0 }
exit $AuditExit
