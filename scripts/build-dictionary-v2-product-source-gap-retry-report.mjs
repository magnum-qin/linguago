import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const attemptPath = requiredPath(args['attempt-log'], 'attempt-log');
const outPath = path.resolve(args.out || 'logs/product-source-gap-retry-report.json');
const wantedErrors = new Set(
  String(args.errors || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

const report = readJson(reportPath);
const attempt = readJson(attemptPath);
const sourceRows = Array.isArray(report.selected) ? report.selected : [];
const latestBySource = new Map();

for (const item of attempt.generated || []) {
  const sourceEntryId = Number(item?.source_entry_id);
  if (!Number.isInteger(sourceEntryId)) continue;
  const sourceSenseId = Number(item?.output?.source_sense_id ?? item?.source_sense_id);
  if (!Number.isInteger(sourceSenseId)) continue;
  latestBySource.set(`${sourceEntryId}:${sourceSenseId}`, item);
}

const selected = sourceRows
  .map((row) => {
    const sourceSenseId = Number(row.source_sense_id ?? row.first_sense_id ?? row.useful_senses?.[0]?.id);
    const latest = latestBySource.get(`${Number(row.source_entry_id)}:${sourceSenseId}`);
    const errors = Array.isArray(latest?.errors) ? latest.errors : [];
    if (!errors.length) return null;
    if (wantedErrors.size && !errors.some((error) => wantedErrors.has(error))) return null;
    return {
      ...row,
      latest_errors: errors,
      latest_endpoint: latest.endpoint || null,
      latest_seconds: latest.seconds ?? null,
      latest_quality_review_errors: latest.quality_review?.errors || [],
      latest_quality_review_reason: latest.quality_review?.reason || null,
      latest_ja_term: latest.output?.localizations?.ja?.term || null,
      latest_ja_reading: latest.output?.localizations?.ja?.reading || null,
      latest_zh_term: latest.output?.localizations?.zh?.term || null,
      latest_zh_reading: latest.output?.localizations?.zh?.reading || null
    };
  })
  .filter(Boolean);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  attempt_log: path.relative(process.cwd(), attemptPath),
  error_filter: [...wantedErrors],
  summary: {
    source_rows: sourceRows.length,
    attempts_indexed: latestBySource.size,
    selected: selected.length,
    error_counts: countBy(selected.flatMap((row) => row.latest_errors))
  },
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`${name} not found: ${resolved}`);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[key] = 'true';
    else {
      result[key] = next;
      index++;
    }
  }
  return result;
}
