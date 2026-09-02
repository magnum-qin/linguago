import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputs = String(args.inputs || '').split(',').map((value) => value.trim()).filter(Boolean).map((value) => path.resolve(value));
if (!inputs.length) throw new Error('Missing --inputs');
const out = path.resolve(args.out || 'logs/localized-sense-repair-plan-aggregate.json');
const evidenceOut = args['evidence-out'] ? path.resolve(args['evidence-out']) : null;
const reports = inputs.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const grouped = new Map();

for (const report of reports) {
  for (const repair of report.repairs || []) {
    const key = `${repair.entry_id}:${repair.sense_id}`;
    const current = grouped.get(key) || {
      entry_id: repair.entry_id,
      headword: repair.headword,
      sense_id: repair.sense_id,
      status: 'manual_value_required',
      apply_allowed: false,
      query_forms: [],
      target_localizations: [],
      primary_notes: [],
      secondary_notes: []
    };
    current.query_forms.push(...(repair.query_forms || []));
    current.target_localizations.push(...(repair.target_localizations || []));
    current.primary_notes.push(...(repair.primary_notes || []));
    current.secondary_notes.push(...(repair.secondary_notes || []));
    grouped.set(key, current);
  }
}

const repairs = [...grouped.values()].map((repair) => ({
  ...repair,
  query_forms: uniqueObjects(repair.query_forms, (row) => `${row.lang}:${row.term}`),
  target_localizations: mergeTargets(repair.target_localizations),
  primary_notes: [...new Set(repair.primary_notes)],
  secondary_notes: [...new Set(repair.secondary_notes)]
})).sort((left, right) => left.entry_id - right.entry_id || left.sense_id - right.sense_id);

const output = {
  ok: reports.every((report) => report.ok),
  created_at: new Date().toISOString(),
  database_write: false,
  automatic_apply: false,
  inputs: inputs.map((file) => path.relative(process.cwd(), file)),
  summary: {
    source_reports: reports.length,
    unique_query_forms: new Set(repairs.flatMap((repair) => repair.query_forms.map(
      (form) => `${repair.entry_id}:${form.lang}:${form.term}`
    ))).size,
    query_form_to_sense_bindings: repairs.reduce((sum, repair) => sum + repair.query_forms.length, 0),
    deduplicated_entry_sense_repairs: repairs.length,
    affected_entries: new Set(repairs.map((repair) => repair.entry_id)).size
  },
  repairs
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (evidenceOut) {
  const evidenceInput = {
    ok: output.ok,
    created_at: output.created_at,
    database_write: false,
    automatic_apply: false,
    summary: output.summary,
    repairs: repairs.map(({ entry_id, headword, sense_id, status, apply_allowed, query_forms, target_localizations }) => ({
      entry_id,
      headword,
      sense_id,
      status,
      apply_allowed,
      query_forms,
      target_localizations
    }))
  };
  fs.mkdirSync(path.dirname(evidenceOut), { recursive: true });
  fs.writeFileSync(evidenceOut, `${JSON.stringify(evidenceInput, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({
  ok: output.ok,
  out: path.relative(process.cwd(), out),
  evidence_out: evidenceOut ? path.relative(process.cwd(), evidenceOut) : null,
  summary: output.summary
}, null, 2));

function mergeTargets(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const fields = grouped.get(row.lang) || new Set();
    for (const field of row.fields || []) fields.add(field);
    grouped.set(row.lang, fields);
  }
  return [...grouped].map(([lang, fields]) => ({ lang, fields: [...fields].sort() }));
}

function uniqueObjects(rows, keyOf) {
  return [...new Map(rows.map((row) => [keyOf(row), row])).values()];
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
