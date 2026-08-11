import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPaths = String(args.reports || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
const outPath = path.resolve(required(args.out, 'out'));
if (!reportPaths.length) throw new Error('Missing --reports');

const reports = reportPaths.map((filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
});
if (reports.some((report) => report?.policy?.independent_model_families !== true)) {
  throw new Error('Every consensus report must certify independent model families');
}

const reviews = reports.flatMap((report) => report.reviews || []);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map((filePath) => path.relative(process.cwd(), filePath)),
  policy: {
    independent_model_families: true,
    automatic_promotion: false,
    merged_consensus_reports: true
  },
  summary: {
    reviews: reviews.length,
    accepted: reviews.filter((row) => row?.valid === true && row?.consensus_accepted === true).length
  },
  reviews
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return String(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) parsed[key] = argv[++index];
    else parsed[key] = 'true';
  }
  return parsed;
}
