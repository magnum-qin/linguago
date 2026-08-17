#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runPaths = String(args.runs || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map(resolveSummary);
if (!runPaths.length) throw new Error('Missing --runs <run-dir-or-summary,...>');

const minimumGeneratedSample = positiveInteger(args['min-generated-sample'], 20);
const minimumGenerationValidRate = boundedRate(args['min-generation-valid-rate'], 0.9);
const minimumReverseSupportedRate = boundedRate(args['min-reverse-supported-rate'], 0.8);
const minimumFinalAcceptedRate = boundedRate(args['min-final-accepted-rate'], 0.8);
const maximumInfrastructureFailureRate = boundedRate(args['max-infrastructure-failure-rate'], 0.02);

const runs = runPaths.map((filePath) => {
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const summary = report.summary || {};
  const runDir = path.dirname(filePath);
  const qwenReview = optionalJson(path.join(runDir, '01-qwen-source-review.json'));
  const gemmaReview = optionalJson(path.join(runDir, '03-gemma-source-review.json'));
  const generation = optionalJson(path.join(runDir, '05-qwen-generation.json'));
  const repairGeneration = optionalJson(path.join(runDir, '09-qwen-repair-generation.json'));
  return {
    run_id: report.run_id || path.basename(runDir),
    summary_path: relative(filePath),
    input: number(summary.input),
    generation_ready: number(summary.generation_preflight_ready),
    generated_valid: number(summary.generated_valid),
    reverse_supported: number(summary.reverse_supported),
    final_accepted: number(summary.total_final_accepted),
    infrastructure_failures:
      number(qwenReview?.summary?.failed) +
      number(gemmaReview?.summary?.failed) +
      number(generation?.stats?.infrastructure_rejected) +
      number(repairGeneration?.stats?.infrastructure_rejected)
  };
});

const totals = sumRows(runs);
const rates = {
  candidate_to_generation_ready: rate(totals.generation_ready, totals.input),
  generation_valid: rate(totals.generated_valid, totals.generation_ready),
  reverse_supported: rate(totals.reverse_supported, totals.generated_valid),
  final_accepted: rate(totals.final_accepted, totals.generated_valid),
  infrastructure_failure: rate(totals.infrastructure_failures, totals.input)
};
const gates = {
  generated_sample: totals.generated_valid >= minimumGeneratedSample,
  generation_valid_rate: rates.generation_valid >= minimumGenerationValidRate,
  reverse_supported_rate: rates.reverse_supported >= minimumReverseSupportedRate,
  final_accepted_rate: rates.final_accepted >= minimumFinalAcceptedRate,
  infrastructure_failure_rate:
    rates.infrastructure_failure <= maximumInfrastructureFailureRate
};
const output = {
  ok: Object.values(gates).every(Boolean),
  evaluated_at: new Date().toISOString(),
  policy: {
    denominator: 'generated_valid records for reverse/final quality; raw candidates are a review funnel',
    minimum_generated_sample: minimumGeneratedSample,
    minimum_generation_valid_rate: minimumGenerationValidRate,
    minimum_reverse_supported_rate: minimumReverseSupportedRate,
    minimum_final_accepted_rate: minimumFinalAcceptedRate,
    maximum_infrastructure_failure_rate: maximumInfrastructureFailureRate
  },
  totals,
  rates,
  gates,
  runs
};
const outPath = args.out ? path.resolve(args.out) : null;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

function resolveSummary(value) {
  const resolved = path.resolve(value);
  const filePath = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'summary.json')
    : resolved;
  if (!fs.existsSync(filePath)) throw new Error(`Run summary not found: ${filePath}`);
  return filePath;
}

function optionalJson(filePath) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function sumRows(rows) {
  return rows.reduce((total, row) => {
    for (const key of ['input', 'generation_ready', 'generated_valid', 'reverse_supported', 'final_accepted', 'infrastructure_failures']) {
      total[key] += number(row[key]);
    }
    return total;
  }, { input: 0, generation_ready: 0, generated_valid: 0, reverse_supported: 0, final_accepted: 0, infrastructure_failures: 0 });
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedRate(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
