param(
  [string]$Token = $env:UNSLOTH_API_KEY,
  [string]$Report = "logs\product-coverage-gaps-clean-high-value-balanced-v74-wikdict-omw-21.json",
  [string]$Out = "logs\product-source-gap-unsloth-dry-run-v74-wikdict-omw-20.json"
)

if (-not $Token) {
  throw "Set UNSLOTH_API_KEY or pass -Token before running this dry-run."
}

$env:UNSLOTH_API_KEY = $Token

& node scripts\supplement-dictionary-v2-product-source-gaps-unsloth.mjs `
  --report $Report `
  --limit 21 `
  --dry-run true `
  --apply false `
  --concurrency 4 `
  --batch-size 1 `
  --endpoints http://100.99.99.99:11441,http://100.99.99.99:11444,http://100.99.99.99:11448,http://100.99.99.99:11447 `
  --out $Out
