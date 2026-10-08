import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const cohortPath = required(args.cohort, 'cohort');
const frozenPath = required(args.frozen, 'frozen');
const outPath = path.resolve(required(args.out, 'out'));

const cohort = readJson(cohortPath);
const frozen = readJson(frozenPath);
const cohortRows = rows(cohort, ['selected', 'candidates', 'items']);
const frozenRows = rows(frozen, ['selected', 'reviews', 'candidates', 'items'])
  .filter((row) => row.approved !== false && row.decision !== 'reject');
const cohortByKey = uniqueIndex(cohortRows, 'cohort');
const frozenByKey = uniqueIndex(frozenRows, 'frozen');

const missingFrozen = [...frozenByKey.keys()].filter((key) => !cohortByKey.has(key));
if (missingFrozen.length > 0) {
  throw new Error(`Frozen consensus identities missing from cohort: ${missingFrozen.slice(0, 10).join(', ')}`);
}

const selected = cohortRows.filter((row) => !frozenByKey.has(key(row)));
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  purpose: 'review_only_replacements_for_frozen_consensus',
  automatic_publication: false,
  source_cohort: path.relative(process.cwd(), cohortPath),
  frozen_report: path.relative(process.cwd(), frozenPath),
  summary: {
    cohort: cohortRows.length,
    frozen: frozenRows.length,
    replacements: selected.length,
    missing_frozen: 0,
  },
  selected,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function key(row) {
  const entry = Number(row?.source_entry_id);
  const sense = Number(row?.source_sense_id ?? row?.first_sense_id);
  if (!Number.isInteger(entry) || !Number.isInteger(sense)) throw new Error('Row lacks exact source identity');
  return `${entry}:${sense}`;
}

function uniqueIndex(values, label) {
  const result = new Map();
  for (const row of values) {
    const identity = key(row);
    if (result.has(identity)) throw new Error(`Duplicate ${label} identity: ${identity}`);
    result.set(identity, row);
  }
  return result;
}

function rows(report, keys) {
  for (const name of keys) if (Array.isArray(report?.[name])) return report[name];
  return [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    result[name] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return result;
}
