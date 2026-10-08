import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPaths = requiredPaths(args.reports, 'reports');
const consensusPaths = requiredPaths(args.consensus, 'consensus');
const outPath = path.resolve(args.out || 'logs/product-source-gap-consensus-retry.json');
const decisions = new Set(csv(args.decisions || 'reject,manual_review'));

const candidates = new Map();
for (const reportPath of reportPaths) {
  const report = readJson(reportPath);
  for (const row of report.selected || []) {
    const key = candidateKey(row);
    if (key) candidates.set(key, row);
  }
}

const rejected = new Map();
for (const consensusPath of consensusPaths) {
  const report = readJson(consensusPath);
  for (const review of report.reviews || []) {
    if (
      review?.valid !== true ||
      review?.consensus_accepted === true ||
      !decisions.has(String(review?.decision || ''))
    ) continue;
    const key = candidateKey(review);
    if (key) rejected.set(key, review);
  }
}

const selected = [];
const missing = [];
for (const [key, review] of rejected) {
  const candidate = candidates.get(key);
  if (!candidate) {
    missing.push(key);
    continue;
  }
  selected.push({
    ...candidate,
    latest_errors: ['quality_review_rejected'],
    latest_quality_review_errors: (review.corrections || []).map(formatCorrection),
    latest_quality_review_reason: review.reason || null,
    consensus_retry_provenance: {
      decision: review.decision,
      confidence: review.confidence,
      risk_flags: review.risk_flags || []
    }
  });
}

if (missing.length) throw new Error(`Missing source candidates for consensus keys: ${missing.join(',')}`);

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_reports: reportPaths.map(relative),
  consensus_reports: consensusPaths.map(relative),
  policy: {
    retry_decisions: [...decisions].sort(),
    preserve_exact_candidate_identity: true,
    automatic_publication: false
  },
  summary: { candidates: candidates.size, rejected_reviews: rejected.size, selected: selected.length },
  selected_count: selected.length,
  selected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function formatCorrection(value) {
  if (typeof value === 'string') return value;
  return Object.entries(value || {}).map(([key, item]) => `${key}=${item}`).join(', ');
}

function csv(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(
    row?.source_sense_id ??
      row?.output?.source_sense_id ??
      row?.sense_alignment?.aligned_sense_id ??
      row?.first_sense_id
  );
  if (Number.isInteger(entryId) && Number.isInteger(senseId)) return `${entryId}:${senseId}`;
  if (/^\d+:\d+$/.test(String(row?.candidate_key || ''))) return String(row.candidate_key);
  return null;
}

function requiredPaths(value, name) {
  const values = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
  if (!values.length) throw new Error(`Missing --${name}`);
  for (const filePath of values) if (!fs.existsSync(filePath)) throw new Error(`${name} not found: ${filePath}`);
  return values;
}

function readJson(filePath) {
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
