import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const consensusPath = requiredPath(args.consensus, 'consensus');
const riskPath = requiredPath(args.risk, 'risk');
const outPath = path.resolve(args.out || 'logs/product-localized-sense-consensus-triage.json');
const consensus = readJson(consensusPath);
const risk = readJson(riskPath);

const currentBindingConfirmed = [];
const evidenceRequired = [];
const manualReview = [];
for (const row of consensus.rows || []) {
  if (row.status !== 'consensus') {
    manualReview.push(compact(row, 'model_disagreement'));
    continue;
  }
  if (row.decision !== 'isolate') {
    manualReview.push(compact(row, `non_isolate_${row.decision || 'unknown'}`));
    continue;
  }
  const reviewedIds = sortedIds(row.matched_sense_ids);
  const currentIds = sortedIds(row.candidate?.deterministic_matched_sense_ids);
  const item = {
    candidate_id: row.candidate_id,
    entry_id: row.entry_id,
    headword: row.headword,
    query_lang: row.query_lang,
    query_term: row.query_term,
    reviewed_sense_ids: reviewedIds,
    current_binding_sense_ids: currentIds,
    confidence: Math.min(Number(row.primary?.confidence) || 0, Number(row.secondary?.confidence) || 0)
  };
  if (sameIds(reviewedIds, currentIds)) currentBindingConfirmed.push({ ...item, status: 'already_effective' });
  else evidenceRequired.push({
    ...item,
    status: 'independent_evidence_required',
    add_sense_ids: reviewedIds.filter((id) => !currentIds.includes(id)),
    remove_sense_ids: currentIds.filter((id) => !reviewedIds.includes(id))
  });
}

const deterministicRepairs = (risk.deterministic_exclusions || []).map((row) => ({
  ...row,
  status: 'localization_repair_required',
  automatic_apply: false
}));
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  inputs: { consensus: relative(consensusPath), risk: relative(riskPath) },
  summary: {
    reviewed_rows: (consensus.rows || []).length,
    current_binding_confirmed: currentBindingConfirmed.length,
    independent_evidence_required: evidenceRequired.length,
    manual_review: manualReview.length,
    deterministic_localization_repairs: deterministicRepairs.length
  },
  current_binding_confirmed: currentBindingConfirmed,
  independent_evidence_required: evidenceRequired,
  manual_review: manualReview,
  deterministic_localization_repairs: deterministicRepairs,
  next_step: 'Do not apply model-only binding expansions. Prove each proposed sense form with exact native target-language evidence from two independent source families.'
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function compact(row, reason) {
  return {
    candidate_id: row.candidate_id,
    entry_id: row.entry_id,
    headword: row.headword,
    query_lang: row.query_lang,
    query_term: row.query_term,
    status: 'manual_review',
    reason,
    disagreement_codes: row.disagreement_codes || [],
    primary: row.primary || null,
    secondary: row.secondary || null
  };
}
function sortedIds(values) { return [...new Set((values || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b); }
function sameIds(left, right) { return left.length === right.length && left.every((value, index) => value === right[index]); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`Report not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return output;
}
