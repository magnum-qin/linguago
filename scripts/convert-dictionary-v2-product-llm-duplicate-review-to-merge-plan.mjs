import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REVIEW = 'logs/product-semantic-duplicate-llm-review-20260624.json';
const DEFAULT_OUT = 'logs/product-llm-approved-duplicate-merge-plan-20260624.json';

const args = parseArgs(process.argv.slice(2));
const reviewPath = path.resolve(args.review || DEFAULT_REVIEW);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const minConfidence = Number(args['min-confidence'] || 0.85);

if (!fs.existsSync(reviewPath)) throw new Error(`LLM review not found: ${reviewPath}`);

const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const candidates = [];
const skipped = [];

for (const row of review.reviews || []) {
  if (!row.valid) {
    skipped.push({ pair_key: row.pair_key, headword: row.headword, reason: 'invalid_review' });
    continue;
  }
  if (row.decision !== 'merge') {
    skipped.push({ pair_key: row.pair_key, headword: row.headword, reason: row.decision });
    continue;
  }
  if (Number(row.confidence) < minConfidence) {
    skipped.push({
      pair_key: row.pair_key,
      headword: row.headword,
      reason: 'low_confidence',
      confidence: row.confidence
    });
    continue;
  }
  candidates.push({
    entry_id: row.entry_id,
    headword: row.headword,
    frequency_rank: row.frequency_rank,
    keep_sense_id: row.keep_sense_id,
    remove_sense_id: row.remove_sense_id,
    reason: 'llm_semantic_duplicate_review',
    confidence: row.confidence,
    llm_reason: row.reason,
    evidence: row.evidence,
    pair_key: row.pair_key
  });
}

const report = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_review: path.relative(process.cwd(), reviewPath),
  min_confidence: minConfidence,
  summary: {
    candidates: candidates.length,
    skipped: skipped.length,
    skipped_by_reason: countBy(skipped.map((row) => row.reason))
  },
  candidates,
  skipped
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: report.summary }, null, 2));

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
