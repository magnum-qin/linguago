import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const type = String(args.type || '');
const reportPaths = String(args.reports || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = requiredPath(args.out, 'out');
const configs = {
  selection: { outputKey: 'selected', inputKeys: ['selected'] },
  generation: { outputKey: 'generated', inputKeys: ['generated', 'replayed'] },
  evidence: { outputKey: 'validations', inputKeys: ['validations'] },
  consensus: { outputKey: 'reviews', inputKeys: ['reviews'] }
};
const config = configs[type];
if (!config) throw new Error(`Invalid --type: ${type}`);
if (reportPaths.length < 2) throw new Error('Provide at least two comma-separated --reports');

const reports = reportPaths.map(readJson);
const merged = new Map();
const attempts = new Map();

for (let index = 0; index < reports.length; index += 1) {
  const rows = firstArray(reports[index], config.inputKeys);
  if (!rows) throw new Error(`Report has no ${config.inputKeys.join('/')} array: ${reportPaths[index]}`);
  for (const row of rows) {
    const key = candidateKey(row);
    if (!key) continue;
    attempts.set(key, (attempts.get(key) || 0) + 1);
    merged.set(key, {
      ...row,
      merged_from_report: relative(reportPaths[index]),
      merged_from_index: index
    });
  }
}

const rows = [...merged.values()].sort(
  (left, right) =>
    Number(left.source_entry_id) - Number(right.source_entry_id) ||
    Number(sourceSenseId(left)) - Number(sourceSenseId(right))
);
const output = {
  ...reports[0],
  ok: true,
  generated_at: new Date().toISOString(),
  merged_type: type,
  merged_from: reportPaths.map(relative),
  merge_summary: {
    source_reports: reports.length,
    source_rows: reportPaths.reduce(
      (sum, _item, index) => sum + firstArray(reports[index], config.inputKeys).length,
      0
    ),
    unique_candidates: rows.length,
    retried_candidates: [...attempts.values()].filter((count) => count > 1).length
  },
  [config.outputKey]: rows
};
if (type === 'generation') {
  output.stats = {
    ...(reports[0].stats || {}),
    generated: rows.length,
    accepted: rows.filter((row) => row?.valid === true).length,
    rejected: rows.filter((row) => row?.valid !== true).length
  };
  delete output.replayed;
}
if (type === 'evidence') output.summary = summarizeEvidence(rows);
if (type === 'consensus') output.summary = summarizeConsensus(rows);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    { ok: true, out: relative(outPath), merge_summary: output.merge_summary, summary: output.summary || output.stats },
    null,
    2
  )
);

function summarizeEvidence(rows) {
  return {
    validated_rows: rows.length,
    supported: rows.filter((row) => row?.decision === 'supported').length,
    manual_review: rows.filter((row) => row?.decision === 'manual_review').length,
    unsupported: rows.filter((row) => row?.decision === 'unsupported').length
  };
}

function summarizeConsensus(rows) {
  return {
    targeted: rows.length,
    valid: rows.filter((row) => row?.valid === true).length,
    consensus_accepted: rows.filter((row) => row?.consensus_accepted === true).length,
    rejected: rows.filter((row) => row?.valid === true && row?.consensus_accepted !== true).length,
    failed: rows.filter((row) => row?.valid !== true).length
  };
}

function firstArray(report, keys) {
  for (const key of keys) if (Array.isArray(report?.[key])) return report[key];
  return null;
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(sourceSenseId(row));
  return Number.isInteger(entryId) && Number.isInteger(senseId) ? `${entryId}:${senseId}` : null;
}

function sourceSenseId(row) {
  return row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
