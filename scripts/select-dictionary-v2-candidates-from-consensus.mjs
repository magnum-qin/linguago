import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const candidatesPath = requiredPath(args.candidates, '--candidates');
const consensusPath = requiredPath(args.consensus, '--consensus');
const outPath = requiredPath(args.out, '--out');
const limit = positiveInteger(args.limit, Number.POSITIVE_INFINITY);

const candidatesReport = readJson(candidatesPath);
const consensusReport = readJson(consensusPath);
const candidates = candidateRows(candidatesReport);
const accepted = new Map(
  reviewRows(consensusReport)
    .filter(isAcceptedNoCorrectionReview)
    .map((review) => [candidateKey(review), review])
);

const seen = new Set();
const selected = [];
for (const candidate of candidates) {
  const key = candidateKey(candidate);
  if (!accepted.has(key) || seen.has(key)) continue;
  seen.add(key);
  selected.push({
    ...candidate,
    final_consensus_review: accepted.get(key),
    final_consensus_provenance: {
      kind: 'independent_no_correction_consensus',
      consensus_report: path.relative(process.cwd(), consensusPath),
      automatic_promotion: false
    }
  });
  if (selected.length >= limit) break;
}

const missing = [...accepted.keys()].filter((key) => !seen.has(key));
const result = {
  ok: missing.length === 0 || Number.isFinite(limit),
  generated_at: new Date().toISOString(),
  source_reports: {
    candidates: path.relative(process.cwd(), candidatesPath),
    consensus: path.relative(process.cwd(), consensusPath)
  },
  policy: {
    exact_source_identity: true,
    require_valid: true,
    require_accept: true,
    require_consensus_accepted: true,
    require_no_corrections: true,
    automatic_promotion: false
  },
  accepted_review_count: accepted.size,
  selected_count: selected.length,
  missing_count: missing.length,
  missing_keys: missing,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({
  ok: result.ok,
  selected: selected.length,
  accepted_reviews: accepted.size,
  missing: missing.length,
  out: path.relative(process.cwd(), outPath)
}, null, 2));

function candidateRows(report) {
  for (const key of ['selected', 'candidates', 'rows']) {
    if (Array.isArray(report?.[key])) return report[key];
  }
  throw new Error('Candidate report must contain selected, candidates, or rows.');
}

function reviewRows(report) {
  if (!Array.isArray(report?.reviews)) throw new Error('Consensus report must contain reviews.');
  return report.reviews;
}

function isAcceptedNoCorrectionReview(review) {
  return review?.valid === true &&
    review?.decision === 'accept' &&
    review?.consensus_accepted === true &&
    Array.isArray(review?.corrections) &&
    review.corrections.length === 0;
}

function candidateKey(value) {
  const entryId = Number(value?.source_entry_id);
  const senseId = Number(value?.source_sense_id ?? value?.first_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) {
    throw new Error(`Row lacks exact source identity: ${JSON.stringify(value)}`);
  }
  return `${entryId}:${senseId}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, flag) {
  if (!value) throw new Error(`${flag} is required.`);
  return path.resolve(value);
}

function positiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=', 2);
    if (inlineValue !== undefined) parsed[rawKey] = inlineValue;
    else if (argv[index + 1] && !argv[index + 1].startsWith('--')) parsed[rawKey] = argv[++index];
    else parsed[rawKey] = 'true';
  }
  return parsed;
}
