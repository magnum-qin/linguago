import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const consensusPath = requiredPath(args.consensus, 'consensus');
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = path.resolve(args.out || 'logs/localized-sense-consensus-repair-plan.json');

const consensus = readJson(consensusPath);
const primary = readJson(primaryPath);
const secondary = readJson(secondaryPath);
const primaryById = new Map((primary.reviews || []).map((row) => [row.candidate_id, row]));
const secondaryById = new Map((secondary.reviews || []).map((row) => [row.candidate_id, row]));
const grouped = new Map();

for (const row of consensus.rows || []) {
  if (row.status !== 'consensus' || row.decision !== 'repair') continue;
  const first = primaryById.get(row.candidate_id);
  const second = secondaryById.get(row.candidate_id);
  const firstActions = repairActions(first);
  const secondActions = repairActions(second);
  const agreedSenseIds = intersect(
    firstActions.flatMap((action) => action.sense_ids),
    secondActions.flatMap((action) => action.sense_ids)
  );

  for (const senseId of agreedSenseIds) {
    const firstTargets = repairTargetsForSense(firstActions, senseId);
    const secondTargets = repairTargetsForSense(secondActions, senseId);
    const agreedTargets = intersectTargets(firstTargets, secondTargets);
    const key = `${row.entry_id}:${senseId}`;
    const item = grouped.get(key) || {
      entry_id: row.entry_id,
      headword: row.headword,
      sense_id: senseId,
      status: 'manual_value_required',
      apply_allowed: false,
      query_forms: [],
      target_localizations: [],
      primary_notes: [],
      secondary_notes: []
    };
    item.query_forms.push({ lang: row.query_lang, term: row.query_term });
    item.target_localizations.push(...agreedTargets);
    item.primary_notes.push(...notesForSense(firstActions, senseId));
    item.secondary_notes.push(...notesForSense(secondActions, senseId));
    grouped.set(key, item);
  }
}

const repairs = [...grouped.values()].map((item) => ({
  ...item,
  query_forms: uniqueObjects(item.query_forms),
  target_localizations: uniqueTargets(item.target_localizations),
  primary_notes: unique(item.primary_notes),
  secondary_notes: unique(item.secondary_notes)
})).sort((a, b) => a.entry_id - b.entry_id || a.sense_id - b.sense_id);

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  automatic_apply: false,
  inputs: {
    consensus: relative(consensusPath),
    primary: relative(primaryPath),
    secondary: relative(secondaryPath)
  },
  summary: {
    consensus_repair_query_forms: (consensus.rows || []).filter(
      (row) => row.status === 'consensus' && row.decision === 'repair'
    ).length,
    deduplicated_entry_sense_repairs: repairs.length,
    affected_entries: new Set(repairs.map((row) => row.entry_id)).size
  },
  repairs,
  next_step: 'Resolve exact replacement values from source dictionaries, then create a separate deterministic replay. This report cannot be applied directly.'
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function repairActions(row) {
  return (row?.actions || []).filter((action) => action?.type === 'repair_localization').map((action) => ({
    ...action,
    sense_ids: unique((action.sense_ids || []).map(Number).filter(Number.isInteger)),
    target_lang: action.target_lang || null,
    fields: unique((action.fields || []).filter(Boolean))
  }));
}

function repairTargetsForSense(actions, senseId) {
  return actions.filter((action) => action.sense_ids.includes(senseId) && action.target_lang)
    .map((action) => ({ lang: action.target_lang, fields: action.fields }));
}

function intersectTargets(left, right) {
  const output = [];
  for (const first of left) {
    for (const second of right.filter((row) => row.lang === first.lang)) {
      const fields = intersect(first.fields, second.fields);
      if (fields.length) output.push({ lang: first.lang, fields });
    }
  }
  return uniqueTargets(output);
}

function notesForSense(actions, senseId) {
  return actions.filter((action) => action.sense_ids.includes(senseId)).map((action) => action.note).filter(Boolean);
}

function intersect(left, right) {
  const rightSet = new Set(right);
  return unique(left.filter((value) => rightSet.has(value)));
}

function unique(values) { return [...new Set(values)]; }
function uniqueObjects(values) {
  return [...new Map(values.map((value) => [`${value.lang}:${value.term}`, value])).values()];
}
function uniqueTargets(values) {
  const grouped = new Map();
  for (const value of values) {
    const fields = grouped.get(value.lang) || new Set();
    for (const field of value.fields || []) fields.add(field);
    grouped.set(value.lang, fields);
  }
  return [...grouped].map(([lang, fields]) => ({ lang, fields: [...fields].sort() }));
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`Report not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return out;
}
