#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runDir = path.resolve(required(args['run-dir'], 'run-dir'));
const outPath = path.resolve(args.out || path.join(runDir, 'production-cadence-audit.json'));
const generationWindowSize = positiveInteger(args['generation-window-size'], 500);
const validationWindowSize = positiveInteger(args['validation-window-size'], 1000);
const maxCheckpointCommitSize = positiveInteger(args['max-checkpoint-commit-size'], 50);

const checkpoint = readJson(path.join(runDir, '05-qwen-generation.checkpoint.json'));
const generation = readJson(path.join(runDir, '05-qwen-generation.json'));
const reverse = readJson(path.join(runDir, '06-reverse-evidence.json'));
const finalReview = readJson(path.join(runDir, '07-final-gemma.json'));
const controlled = readJson(path.join(runDir, '08-controlled-replay.json'));

const checkpointItems = Object.values(checkpoint.items || {}).sort(compareCompletedAt);
const configuredChunkSize = Number(checkpoint?.config?.chunk_size);
const generatedRows = rowsFrom(generation, ['generated']);
const generatedByKey = indexByKey(generatedRows);
const reverseByKey = indexByKey(rowsFrom(reverse, ['validations', 'selected']));
const finalByKey = indexByKey(rowsFrom(finalReview, ['reviews']));
const controlledKeys = new Set(rowsFrom(controlled, ['selected', 'generated']).map(candidateKey));

const commitGroups = groupCheckpointCommits(checkpointItems);
const generationWindows = windows(checkpointItems, generationWindowSize).map((items, index) => {
  const generated = items.map((item) => generatedByKey.get(candidateKey(item)) || item.generated_item).filter(Boolean);
  const valid = generated.filter((item) => item.valid === true).length;
  const infrastructureFailures = generated.filter((item) => item.infrastructure_failure === true).length;
  const jsonFailures = generated.filter(hasJsonFailure).length;
  return {
    window: index + 1,
    start: index * generationWindowSize + 1,
    end: index * generationWindowSize + items.length,
    completed: items.length,
    valid,
    rejected: items.length - valid,
    infrastructure_failures: infrastructureFailures,
    json_failures: jsonFailures,
    valid_rate: ratio(valid, items.length),
    infrastructure_failure_rate: ratio(infrastructureFailures, items.length),
    json_failure_rate: ratio(jsonFailures, items.length)
  };
});

const validationWindows = windows(checkpointItems, validationWindowSize).map((items, index) => {
  const keys = items.map(candidateKey);
  const generatedValid = keys.filter((key) => generatedByKey.get(key)?.valid === true).length;
  const reverseSupported = keys.filter((key) => reverseByKey.get(key)?.decision === 'supported').length;
  const finalAccepted = keys.filter((key) => finalByKey.get(key)?.consensus_accepted === true).length;
  const controlledAccepted = keys.filter((key) => controlledKeys.has(key)).length;
  return {
    window: index + 1,
    start: index * validationWindowSize + 1,
    end: index * validationWindowSize + items.length,
    completed: items.length,
    generated_valid: generatedValid,
    reverse_supported: reverseSupported,
    final_accepted: finalAccepted,
    controlled_replay_accepted: controlledAccepted,
    final_acceptance_rate: ratio(finalAccepted, generatedValid),
    controlled_replay_rate: ratio(controlledAccepted, finalAccepted)
  };
});

const failures = [];
if (!checkpointItems.length) failures.push('generation checkpoint contains no completed items');
if (!Number.isInteger(configuredChunkSize) || configuredChunkSize < 1) {
  failures.push('checkpoint config is missing a valid chunk_size');
} else if (configuredChunkSize > maxCheckpointCommitSize) {
  failures.push(`configured checkpoint chunk_size exceeds ${maxCheckpointCommitSize}`);
}
if (commitGroups.some((group) => group.items > maxCheckpointCommitSize)) {
  failures.push(`checkpoint commit exceeds ${maxCheckpointCommitSize} items`);
}
if (checkpointItems.some((item) => !item.completed_at)) failures.push('checkpoint item missing completed_at');
if (checkpointItems.some((item) => !generatedByKey.has(candidateKey(item)))) {
  failures.push('checkpoint item missing from generation report');
}
if ([...controlledKeys].some((key) => finalByKey.get(key)?.consensus_accepted !== true)) {
  failures.push('controlled replay contains item without final no-correction acceptance');
}
if ([...controlledKeys].some((key) => reverseByKey.get(key)?.decision !== 'supported')) {
  failures.push('controlled replay contains item without deterministic reverse support');
}

const output = {
  ok: failures.length === 0,
  generated_at: new Date().toISOString(),
  run_id: path.basename(runDir),
  policy: {
    checkpoint_commit_max: maxCheckpointCommitSize,
    generation_audit_window: generationWindowSize,
    deterministic_validation_window: validationWindowSize,
    main_database_mutation: false,
    controlled_promotion_after_final_review_only: true
  },
  counts: {
    checkpoint_items: checkpointItems.length,
    checkpoint_commits: commitGroups.length,
    configured_chunk_size: Number.isInteger(configuredChunkSize) ? configuredChunkSize : null,
    generation_rows: generatedRows.length,
    reverse_rows: reverseByKey.size,
    final_review_rows: finalByKey.size,
    controlled_replay_rows: controlledKeys.size
  },
  checkpoint_commits: commitGroups,
  generation_windows: generationWindows,
  validation_windows: validationWindows,
  failures
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), counts: output.counts, failures }, null, 2));
if (!output.ok) process.exitCode = 1;

function groupCheckpointCommits(items) {
  const groups = [];
  for (const item of items) {
    const completedAt = String(item.completed_at || 'missing');
    const previous = groups.at(-1);
    if (previous?.completed_at === completedAt) previous.items += 1;
    else groups.push({ completed_at: completedAt, items: 1 });
  }
  return groups;
}

function windows(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function rowsFrom(report, keys) {
  for (const key of keys) if (Array.isArray(report?.[key])) return report[key];
  return [];
}

function indexByKey(rows) {
  return new Map(rows.map((row) => [candidateKey(row), row]));
}

function candidateKey(value) {
  const sourceEntryId = Number(value?.source_entry_id);
  const sourceSenseId = Number(value?.source_sense_id ?? value?.first_sense_id ?? value?.output?.source_sense_id);
  return `${sourceEntryId}:${Number.isInteger(sourceSenseId) ? sourceSenseId : 'none'}`;
}

function hasJsonFailure(item) {
  return (item?.errors || []).some((error) => /json|parse|schema/iu.test(String(error)));
}

function compareCompletedAt(left, right) {
  return String(left?.completed_at || '').localeCompare(String(right?.completed_at || ''));
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function ratio(value, total) { return total > 0 ? value / total : 0; }
function positiveInteger(value, fallback) { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`); return parsed; }
function required(value, name) { if (!value) throw new Error(`Missing --${name}`); return String(value); }
function relative(value) { return path.relative(process.cwd(), value); }
function parseArgs(argv) { const out = {}; for (let index = 0; index < argv.length; index += 1) { if (!argv[index].startsWith('--')) continue; const key = argv[index].slice(2); const next = argv[index + 1]; out[key] = next && !next.startsWith('--') ? argv[++index] : 'true'; } return out; }
