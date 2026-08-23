#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runDir = path.resolve(required(args['run-dir'], 'run-dir'));
const outPath = path.resolve(args.out || path.join(runDir, 'production-gate.json'));
const summary = readJson(path.join(runDir, 'summary.json'));
const generation = readJson(path.join(runDir, '05-qwen-generation.json'));
const cadence = readJson(path.join(runDir, 'production-cadence-audit.json'));

const input = Number(summary?.summary?.input || 0);
const generationReady = Number(summary?.summary?.jmdict_generation_ready || 0);
const generatedValid = Number(summary?.summary?.generated_valid || 0);
const reverseSupported = Number(summary?.summary?.reverse_supported || 0);
const finalAccepted = Number(summary?.summary?.final_accepted || 0);
const finalRejected = Number(summary?.summary?.final_rejected || 0);
const generated = Number(generation?.stats?.generated || 0);
const infrastructureRejected = Number(generation?.stats?.infrastructure_rejected || 0);
const jsonFailures = (generation.generated || []).filter((row) =>
  (row.errors || []).some((error) => /json|parse|schema/i.test(String(error)))
).length;

const metrics = {
  raw_to_final: ratio(finalAccepted, input),
  generation_valid: ratio(generatedValid, generated),
  final_no_correction: ratio(finalAccepted, finalAccepted + finalRejected),
  infrastructure_failure: ratio(infrastructureRejected, generated),
  json_failure: ratio(jsonFailures, generated)
};
const thresholds = {
  raw_to_final: numberArg(args['min-final-rate'], 0.05),
  generation_valid: numberArg(args['min-generation-valid'], 0.95),
  final_no_correction: numberArg(args['min-final-acceptance'], 0.9),
  infrastructure_failure: numberArg(args['max-infrastructure-failure'], 0.02),
  json_failure: numberArg(args['max-json-failure'], 0.02)
};
const failures = [];
const warnings = [];
if (cadence.ok !== true) failures.push('production cadence audit must pass');
if (input <= 0) failures.push('input must be positive');
if (generationReady <= 0) failures.push('generation-ready count must be positive');
if (finalAccepted <= 0) failures.push('final accepted count must be positive');
if (Number(summary?.summary?.automatic_database_writes || 0) !== 0) failures.push('automatic database writes must be zero');
if (metrics.raw_to_final < thresholds.raw_to_final) {
  warnings.push(`raw_to_final ${metrics.raw_to_final} < ${thresholds.raw_to_final}`);
}
for (const key of ['generation_valid', 'final_no_correction']) {
  if (metrics[key] < thresholds[key]) failures.push(`${key} ${metrics[key]} < ${thresholds[key]}`);
}
for (const key of ['infrastructure_failure', 'json_failure']) {
  if (metrics[key] > thresholds[key]) failures.push(`${key} ${metrics[key]} > ${thresholds[key]}`);
}
if (reverseSupported < finalAccepted) failures.push('final accepts exceed reverse-evidence support');

const output = {
  ok: failures.length === 0,
  generated_at: new Date().toISOString(),
  run_id: summary.run_id,
  counts: { input, generation_ready: generationReady, generated_valid: generatedValid, reverse_supported: reverseSupported, final_accepted: finalAccepted, final_rejected: finalRejected, generated, infrastructure_rejected: infrastructureRejected, json_failures: jsonFailures },
  cadence: {
    checkpoint_commits: Number(cadence?.counts?.checkpoint_commits || 0),
    generation_windows: Array.isArray(cadence?.generation_windows) ? cadence.generation_windows.length : 0,
    validation_windows: Array.isArray(cadence?.validation_windows) ? cadence.validation_windows.length : 0
  },
  metrics,
  thresholds,
  warnings,
  failures
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exitCode = 1;

function ratio(value, total) { return total > 0 ? value / total : 0; }
function readJson(filePath) { if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`); return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return value; }
function numberArg(value, fallback) { const parsed = Number(value ?? fallback); if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`); return parsed; }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { if (!argv[index].startsWith('--')) continue; const key = argv[index].slice(2); const next = argv[index + 1]; out[key] = next && !next.startsWith('--') ? argv[++index] : true; } return out; }
