import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.argv[2] || 'output/batches/deepseek-cost-pro-100/generated.jsonl');
const model = process.argv[3] || 'deepseek-v4-pro';

const pricesCny = {
  'deepseek-v4-flash': {
    cacheHitInput: 0.02,
    cacheMissInput: 1,
    output: 2
  },
  'deepseek-v4-pro': {
    cacheHitInput: 0.025,
    cacheMissInput: 3,
    output: 6
  }
};

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const rows = fs
  .readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const totals = rows.reduce(
  (acc, row) => {
    const usage = row.usage || {};
    const promptDetails = usage.prompt_tokens_details || {};
    const cacheHit = Number(usage.prompt_cache_hit_tokens ?? promptDetails.cached_tokens ?? 0);
    const prompt = Number(usage.prompt_tokens || 0);
    const completion = Number(usage.completion_tokens || 0);
    const total = Number(usage.total_tokens || prompt + completion);
    const cacheMiss = Math.max(0, Number(usage.prompt_cache_miss_tokens ?? prompt - cacheHit));

    acc.prompt_tokens += prompt;
    acc.prompt_cache_hit_tokens += cacheHit;
    acc.prompt_cache_miss_tokens += cacheMiss;
    acc.completion_tokens += completion;
    acc.total_tokens += total;
    acc.seconds += Number(row.seconds || 0);
    if (!row.usage) acc.rows_missing_usage += 1;
    return acc;
  },
  {
    rows: rows.length,
    prompt_tokens: 0,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    seconds: 0,
    rows_missing_usage: 0
  }
);

const price = pricesCny[model] || pricesCny['deepseek-v4-pro'];
const costCny =
  (totals.prompt_cache_hit_tokens / 1_000_000) * price.cacheHitInput +
  (totals.prompt_cache_miss_tokens / 1_000_000) * price.cacheMissInput +
  (totals.completion_tokens / 1_000_000) * price.output;

const report = {
  file: path.relative(process.cwd(), file),
  model,
  rows: totals.rows,
  token_usage: {
    prompt_tokens: totals.prompt_tokens,
    prompt_cache_hit_tokens: totals.prompt_cache_hit_tokens,
    prompt_cache_miss_tokens: totals.prompt_cache_miss_tokens,
    completion_tokens: totals.completion_tokens,
    total_tokens: totals.total_tokens
  },
  pricing_cny_per_1m_tokens: price,
  estimated_cost_cny: Number(costCny.toFixed(6)),
  avg_cost_cny_per_entry: Number((costCny / Math.max(1, totals.rows)).toFixed(6)),
  avg_seconds_per_entry: Number((totals.seconds / Math.max(1, totals.rows)).toFixed(2)),
  rows_missing_usage: totals.rows_missing_usage
};

console.log(JSON.stringify(report, null, 2));
