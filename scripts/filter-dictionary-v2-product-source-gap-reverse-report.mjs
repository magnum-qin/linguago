import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const candidatesPath = requiredPath(args.candidates, 'candidates');
const outPath = requiredPath(args.out, 'out');
const decision = String(args.decision || 'supported');

const report = readJson(reportPath);
const candidates = readJson(candidatesPath);
const candidateRows = Array.isArray(candidates.selected)
  ? candidates.selected
  : Array.isArray(candidates.generated)
    ? candidates.generated
    : [];
const candidateIds = new Set(
  candidateRows
    .map((row) => row?.source_entry_id)
    .filter((id) => id !== undefined && id !== null)
    .map(String)
);
const validations = (report.validations || []).filter(
  (row) => candidateIds.has(String(row?.source_entry_id)) && row?.decision === decision
);

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: {
    report: relative(reportPath),
    candidates: relative(candidatesPath),
    decision
  },
  summary: {
    ...(report.summary || {}),
    filter: {
      input_validations: (report.validations || []).length,
      candidate_ids: candidateIds.size,
      candidate_container: Array.isArray(candidates.selected) ? 'selected' : 'generated',
      decision,
      selected_validations: validations.length
    }
  },
  validations
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify(
    {
      ok: true,
      out: relative(outPath),
      input_validations: (report.validations || []).length,
      candidate_ids: candidateIds.size,
      selected_validations: validations.length
    },
    null,
    2
  )
);

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
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
