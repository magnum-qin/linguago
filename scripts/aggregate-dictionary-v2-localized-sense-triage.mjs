import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputs = String(args.inputs || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
if (inputs.length === 0) throw new Error('Missing --inputs');
const out = path.resolve(args.out || 'logs/product-localized-sense-triage-aggregate.json');

const reports = inputs.map((file) => {
  if (!fs.existsSync(file)) throw new Error(`Input not found: ${file}`);
  return { file, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
});

const current = unique(reports.flatMap(({ value }) => value.current_binding_confirmed || []));
const evidence = unique(reports.flatMap(({ value }) => value.independent_evidence_required || []));
const manual = unique(reports.flatMap(({ value }) => value.manual_review || []))
  .map((row) => ({ ...row, review_priority: priority(row) }))
  .sort((left, right) => right.review_priority - left.review_priority
    || left.entry_id - right.entry_id
    || left.candidate_id.localeCompare(right.candidate_id));
const repairs = unique(reports.flatMap(({ value }) => value.deterministic_localization_repairs || []));

const output = {
  ok: reports.every(({ value }) => value.ok),
  created_at: new Date().toISOString(),
  database_write: false,
  inputs: reports.map(({ file }) => path.relative(process.cwd(), file)),
  priority_policy: ['non_isolate_repair', 'non_isolate_split', 'model_disagreement', 'non_isolate_keep'],
  summary: {
    reports: reports.length,
    reviewed_rows: current.length + evidence.length + manual.length,
    current_binding_confirmed: current.length,
    independent_evidence_required: evidence.length,
    manual_review: manual.length,
    manual_by_reason: counts(manual, 'reason'),
    deterministic_localization_repairs: repairs.length
  },
  current_binding_confirmed: current,
  independent_evidence_required: evidence,
  prioritized_manual_review: manual,
  deterministic_localization_repairs: repairs
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), out), summary: output.summary }, null, 2));

function priority(row) {
  if (row.reason === 'non_isolate_repair') return 400;
  if (row.reason === 'non_isolate_split') return 300;
  if (row.reason === 'model_disagreement') return 200;
  if (row.reason === 'non_isolate_keep') return 100;
  return 0;
}

function unique(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = row.candidate_id || `${row.entry_id}:${row.query_lang}:${row.query_term}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function counts(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = row[key] || 'unknown';
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map())].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return output;
}
