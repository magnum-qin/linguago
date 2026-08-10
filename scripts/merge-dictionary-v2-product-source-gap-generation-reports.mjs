import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPaths = String(args.reports || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = path.resolve(args.out || 'logs/product-source-gap-generation-merged.json');
const allowedReportPath = args['allowed-report'] ? path.resolve(args['allowed-report']) : null;

if (reportPaths.length < 2) throw new Error('Provide at least two comma-separated --reports');
for (const reportPath of reportPaths) {
  if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
}
if (allowedReportPath && !fs.existsSync(allowedReportPath)) {
  throw new Error(`Allowed report not found: ${allowedReportPath}`);
}

const reports = reportPaths.map((reportPath) => JSON.parse(fs.readFileSync(reportPath, 'utf8')));
const allowedSourceEntryIds = allowedReportPath
  ? loadSourceEntryIds(JSON.parse(fs.readFileSync(allowedReportPath, 'utf8')))
  : null;
const selected = new Map();
const attempts = new Map();

for (let reportIndex = 0; reportIndex < reports.length; reportIndex += 1) {
  const report = reports[reportIndex];
  if (!Array.isArray(report.generated)) throw new Error(`Report has no generated array: ${reportPaths[reportIndex]}`);
  for (const row of report.generated) {
    const sourceEntryId = Number(row?.source_entry_id);
    if (!Number.isInteger(sourceEntryId)) continue;
    if (allowedSourceEntryIds && !allowedSourceEntryIds.has(sourceEntryId)) continue;
    attempts.set(sourceEntryId, (attempts.get(sourceEntryId) || 0) + 1);
    const existing = selected.get(sourceEntryId);
    if (!existing || row?.valid === true || existing.row?.valid !== true) {
      selected.set(sourceEntryId, { row, reportIndex });
    }
  }
}

const generated = [...selected.values()]
  .map(({ row, reportIndex }) => ({
    ...row,
    merged_from_report: path.relative(process.cwd(), reportPaths[reportIndex])
  }))
  .sort((left, right) => Number(left.source_entry_id) - Number(right.source_entry_id));
const accepted = generated.filter((row) => row?.valid === true).length;
const rejected = generated.length - accepted;
const base = reports[0];
const output = {
  ...base,
  ok: accepted === generated.length,
  partial: accepted !== generated.length,
  generated_at: new Date().toISOString(),
  merged_from: reportPaths.map((reportPath) => path.relative(process.cwd(), reportPath)),
  stats: {
    ...(base.stats || {}),
    source_reports: reportPaths.length,
    allowed_report: allowedReportPath ? path.relative(process.cwd(), allowedReportPath) : null,
    allowed_source_entry_ids: allowedSourceEntryIds?.size ?? null,
    source_rows: reports.reduce((sum, report) => sum + report.generated.length, 0),
    unique_source_entry_ids: generated.length,
    repeated_source_entry_ids: [...attempts.values()].filter((count) => count > 1).length,
    generated: generated.length,
    accepted,
    rejected,
    evidence_rejected: 0,
    validation_rejected: rejected,
    infrastructure_rejected: generated.filter((row) => row?.valid !== true && row?.infrastructure_failure === true).length
  },
  generated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), stats: output.stats }, null, 2));

function loadSourceEntryIds(report) {
  const rows = report.selected || report.approved || report.candidates || report.residuals;
  if (!Array.isArray(rows)) throw new Error('Allowed report has no candidate array');
  return new Set(
    rows
      .map((row) => Number(row?.source_entry_id))
      .filter((value) => Number.isInteger(value))
  );
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
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
