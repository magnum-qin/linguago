import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || '');
const reviewPath = path.resolve(args.review || '');
const outPath = path.resolve(args.out || 'logs/product-source-gap-review-retry.json');

if (!fs.existsSync(reportPath)) throw new Error(`Coverage report not found: ${reportPath}`);
if (!fs.existsSync(reviewPath)) throw new Error(`Review report not found: ${reviewPath}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const candidates = Array.isArray(report.selected) ? report.selected : [];
const reviews = Array.isArray(review.reviews) ? review.reviews : [];
const invalidKeys = new Set(reviews.filter((row) => row?.valid !== true).map(candidateKey));
const selected = candidates.filter((row) => invalidKeys.has(candidateKey(row)));

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  source_review: path.relative(process.cwd(), reviewPath),
  selection: 'invalid_reviews_only',
  invalid_review_count: invalidKeys.size,
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), selected: selected.length }, null, 2));

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id);
  return `${entryId}:${Number.isInteger(senseId) && senseId > 0 ? senseId : '*'}`;
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
