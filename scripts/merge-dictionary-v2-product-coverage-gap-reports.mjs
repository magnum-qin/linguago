import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const basePaths = parsePaths(args.base);
const manualPath = args['manual-source'] ? path.resolve(args['manual-source']) : null;
const manualIds = parseIds(args['manual-source-entry-ids']);
const onlyIds = parseIds(args['only-source-entry-ids']);
const outPath = path.resolve(args.out || 'logs/product-coverage-gaps-merged.json');

if (!basePaths.length) throw new Error('At least one --base report is required.');
if (manualIds.size && !manualPath) throw new Error('--manual-source is required with manual IDs.');

const selected = [];
const seen = new Set();
const sources = [];

for (const filePath of basePaths) {
  const report = readReport(filePath);
  sources.push(path.relative(process.cwd(), filePath));
  for (const row of report.selected) addRow(row, 'review_approved', filePath);
}

if (manualPath) {
  const report = readReport(manualPath);
  sources.push(path.relative(process.cwd(), manualPath));
  const available = new Set(report.selected.map((row) => Number(row.source_entry_id)));
  const missing = [...manualIds].filter((id) => !available.has(id));
  if (missing.length) throw new Error(`Manual IDs not found in source report: ${missing.join(',')}`);
  for (const row of report.selected) {
    if (manualIds.has(Number(row.source_entry_id))) addRow(row, 'manual_evidence_override', manualPath);
  }
}

if (onlyIds.size) {
  const available = new Set(selected.map((row) => Number(row.source_entry_id)));
  const missing = [...onlyIds].filter((id) => !available.has(id));
  if (missing.length) throw new Error(`Requested IDs not found in merged reports: ${missing.join(',')}`);
  const filtered = selected.filter((row) => onlyIds.has(Number(row.source_entry_id)));
  selected.splice(0, selected.length, ...filtered);
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: [...new Set(sources)],
  selected_count: selected.length,
  selected,
  merge_summary: {
    review_approved: selected.filter((row) => row.candidate_review_provenance?.kind === 'review_approved').length,
    manual_evidence_override: selected.filter(
      (row) => row.candidate_review_provenance?.kind === 'manual_evidence_override'
    ).length
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), ...output.merge_summary }, null, 2));

function addRow(row, kind, sourcePath) {
  const id = Number(row?.source_entry_id);
  if (!Number.isInteger(id)) throw new Error(`Invalid source_entry_id in ${sourcePath}`);
  if (seen.has(id)) return;
  seen.add(id);
  const existingProvenance = row?.candidate_review_provenance;
  const provenance =
    kind === 'review_approved' && existingProvenance?.kind
      ? existingProvenance
      : {
          kind,
          source_report: path.relative(process.cwd(), sourcePath)
        };
  selected.push({
    ...row,
    candidate_review_provenance: provenance
  });
}

function readReport(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Report not found: ${filePath}`);
  const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(report.selected)) throw new Error(`Report has no selected array: ${filePath}`);
  return report;
}

function parsePaths(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function parseIds(value) {
  const ids = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item))
    .filter(Number.isInteger);
  return new Set(ids);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
