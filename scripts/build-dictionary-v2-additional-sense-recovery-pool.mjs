#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || '.');
const runsRoot = path.resolve(root, args['runs-root'] || 'runs');
const productDbPath = path.resolve(
  root,
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db',
);
const outPath = path.resolve(root, args.out || 'batches/additional-sense-recovery.json');
const limit = positiveInteger(args.limit, 100);
const recoveryPrefix = String(args['recovery-prefix'] || 'v212-additional-recovery').trim();
const unattemptedReportPath = args['unattempted-report']
  ? path.resolve(root, args['unattempted-report'])
  : null;

const history = new Map();
const accepted = new Set();
const alreadyRetried = new Set();
let runsRead = 0;

if (fs.existsSync(runsRoot)) {
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(runsRoot, entry.name);
    const manifest = readJson(path.join(runDir, 'manifest.json'));
    const inputPath = resolveRunInput(manifest?.input);
    for (const row of readJson(inputPath)?.selected || []) {
      if (row?.candidate_lane !== 'additional_sense_recovery') continue;
      const key = candidateKey(row);
      if (key) alreadyRetried.add(key);
    }
    const daily = readJson(path.join(runDir, '00a-daily-primary-senses.json'));
    if (!daily) continue;
    runsRead += 1;
    const aligned = keysFromRows(readJson(path.join(runDir, '00b-source-sense-aligned.json'))?.selected);
    const approvedReport = readJson(path.join(runDir, '03-gemma-source-review-approved.json'));
    const approvedRows = approvedReport?.selected || [];
    const approved = keysFromRows(approvedRows);
    const approvedByKey = new Map(approvedRows.map((row) => [candidateKey(row), row]));
    const reverse = readJson(path.join(runDir, '04b-source-consensus-reverse-evidence.json'));
    const reverseDecision = new Map(
      (reverse?.validations || []).map((row) => [candidateKey(row), String(row.decision || '')]),
    );
    for (const row of readJson(path.join(runDir, '07-final-gemma-accepted.json'))?.reviews || []) {
      if (row?.consensus_accepted === false) continue;
      const key = candidateKey(row);
      if (key) accepted.add(key);
    }
    for (const row of daily.selected || []) {
      const key = candidateKey(row);
      if (!key) continue;
      if (entry.name.startsWith(recoveryPrefix) || row.candidate_lane === 'additional_sense_recovery') {
        alreadyRetried.add(key);
        continue;
      }
      const record = history.get(key) || {
        key,
        row,
        source_runs: new Set(),
        binding_failures: 0,
        source_review_approved: 0,
        reverse_unsupported: 0,
      };
      record.source_runs.add(entry.name);
      if (!aligned.has(key)) record.binding_failures += 1;
      if (approved.has(key)) {
        record.source_review_approved += 1;
        record.row = approvedByKey.get(key) || record.row;
        if (reverseDecision.get(key) !== 'supported') record.reverse_unsupported += 1;
      }
      history.set(key, record);
    }
  }
}

const linked = loadLinkedSourceSenses(productDbPath);
const eligible = [];
let nonAuthoritativeExcluded = 0;
for (const row of readJson(unattemptedReportPath)?.selected || []) {
  const key = candidateKey(row);
  if (!key || accepted.has(key) || linked.has(key) || alreadyRetried.has(key) || !isViableCandidate(row)) continue;
  if (!hasAuthoritativeSelectedSense(row)) {
    nonAuthoritativeExcluded += 1;
    continue;
  }
  eligible.push(withRecoveryProvenance(row, key, 'unattempted_authoritative_source_sense', {
    source_runs: [],
    binding_failures: 0,
    source_review_approved: 0,
    reverse_unsupported: 0,
  }));
}
for (const record of history.values()) {
  if (accepted.has(record.key) || linked.has(record.key) || alreadyRetried.has(record.key)) continue;
  const lane = record.reverse_unsupported > 0
    ? 'source_approved_reverse_retry'
    : record.binding_failures > 0
      ? 'source_sense_binding_retry'
      : null;
  if (!lane || !isViableCandidate(record.row)) continue;
  if (!hasAuthoritativeSelectedSense(record.row)) {
    nonAuthoritativeExcluded += 1;
    continue;
  }
  eligible.push(withRecoveryProvenance(record.row, record.key, lane, record));
}

eligible.sort((left, right) =>
  recoveryPriority(left) - recoveryPriority(right)
  || Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) - Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER)
  || candidateKey(left).localeCompare(candidateKey(right)),
);
const selected = balancedTake(eligible, limit);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  product_db: relative(productDbPath),
  runs_root: relative(runsRoot),
  policy: {
    exact_source_sense_dedupe: true,
    linked_source_senses_excluded: true,
    previously_final_accepted_excluded: true,
    one_recovery_attempt_per_source_sense: true,
    reverse_evidence_gate_unchanged: true,
    final_gemma_gate_unchanged: true,
    automatic_database_write: false,
  },
  summary: {
    runs_read: runsRead,
    historical_source_senses: history.size,
    linked_source_senses: linked.size,
    final_accepted_source_senses: accepted.size,
    previously_retried_source_senses: alreadyRetried.size,
    non_authoritative_excluded: nonAuthoritativeExcluded,
    unattempted_report: unattemptedReportPath ? relative(unattemptedReportPath) : null,
    eligible: eligible.length,
    selected: selected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    selected_by_lane: countBy(selected, (row) => row.recovery_provenance.lane),
  },
  selected_count: selected.length,
  selected,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function loadLinkedSourceSenses(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  const rows = db.prepare(`
    SELECT DISTINCT source_entry_id, source_sense_id
    FROM product_sense_source_links
    WHERE source_entry_id IS NOT NULL AND source_sense_id IS NOT NULL
  `).all();
  db.close();
  return new Set(rows.map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`));
}

function balancedTake(rows, maximum) {
  const quotas = { zh: 0.3, ja: 0.3, 'pt-BR': 0.25, en: 0.15 };
  const selected = [];
  const used = new Set();
  for (const [lang, share] of Object.entries(quotas)) {
    const wanted = Math.floor(maximum * share);
    for (const row of rows) {
      if (selected.length >= maximum || countBy(selected, (item) => item.source_lang)[lang] >= wanted) break;
      const key = candidateKey(row);
      if (row.source_lang !== lang || used.has(key)) continue;
      selected.push(row);
      used.add(key);
    }
  }
  for (const row of rows) {
    if (selected.length >= maximum) break;
    const key = candidateKey(row);
    if (used.has(key)) continue;
    selected.push(row);
    used.add(key);
  }
  return selected;
}

function recoveryPriority(row) {
  if (row.recovery_provenance.lane === 'unattempted_authoritative_source_sense') return 0;
  if (row.recovery_provenance.lane === 'source_approved_reverse_retry') return 1;
  return 2;
}

function hasAuthoritativeSelectedSense(row) {
  const lang = String(row?.source_lang || '');
  const selectedSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
  const alternatives = Array.isArray(row?.daily_sense_selection?.alternatives)
    ? row.daily_sense_selection.alternatives
    : [];
  const selected = alternatives.find((item) => Number(item?.id) === selectedSenseId);
  const source = String(selected?.source || '').toLocaleLowerCase();
  if (lang === 'zh') return source.includes('cc-cedict');
  if (lang === 'ja') return source.includes('jmdict');
  if (lang === 'pt-BR') return source.includes('freedict') || source.includes('dicionario');
  if (lang === 'en') {
    return source.includes('freedict-eng-por') || source.includes('ecdict') || source.includes('wordnet');
  }
  return false;
}

function withRecoveryProvenance(row, key, lane, record) {
  return {
    ...row,
    candidate_key: key,
    candidate_lane: 'additional_sense_recovery',
    recovery_provenance: {
      lane,
      source_runs: [...(record.source_runs || [])].sort(),
      binding_failures: Number(record.binding_failures || 0),
      source_review_approved: Number(record.source_review_approved || 0),
      reverse_unsupported: Number(record.reverse_unsupported || 0),
      exact_source_sense_dedupe: true,
      quality_gates_unchanged: true,
    },
  };
}

function isViableCandidate(row) {
  const word = String(row?.word || '').normalize('NFKC').trim();
  if (!word) return false;
  if (row?.source_lang === 'ja' && [...word].length === 1) return false;
  if (/^[\p{Script=Latin}\p{M}'’-]+$/u.test(word) && [...word].length <= 2) return false;
  return true;
}

function resolveRunInput(input) {
  if (!input) return '';
  const resolved = path.resolve(root, String(input));
  return resolved.startsWith(root) ? resolved : '';
}

function keysFromRows(rows = []) {
  return new Set(rows.map(candidateKey).filter(Boolean));
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id);
  return Number.isInteger(entryId) && Number.isInteger(senseId) ? `${entryId}:${senseId}` : '';
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}

function relative(file) { return path.relative(process.cwd(), file); }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    result[token.slice(2)] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
