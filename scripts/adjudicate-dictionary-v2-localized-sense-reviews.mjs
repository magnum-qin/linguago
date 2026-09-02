import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const primaryPath = path.resolve(args.primary || 'logs/product-localized-sense-isolation-qwen-review.json');
const secondaryPath = path.resolve(args.secondary || 'logs/product-localized-sense-isolation-gemma-review.json');
const outPath = path.resolve(args.out || 'logs/product-localized-sense-isolation-consensus.json');
const threshold = boundedNumber(args['confidence-threshold'], 0.9, 0, 1);
for (const file of [primaryPath, secondaryPath]) if (!fs.existsSync(file)) throw new Error(`Report not found: ${file}`);
const primary = JSON.parse(fs.readFileSync(primaryPath, 'utf8'));
const secondary = JSON.parse(fs.readFileSync(secondaryPath, 'utf8'));
const primaryById = new Map((primary.reviews || []).map((row) => [row.candidate_id, row]));
const secondaryById = new Map((secondary.reviews || []).map((row) => [row.candidate_id, row]));
const rows = [];
for (const [candidateId, first] of primaryById) {
  const second = secondaryById.get(candidateId);
  const decisionsAgree = first.valid && second?.valid && first.decision === second.decision;
  const senseIdsAgree = decisionsAgree && sameIds(first.matched_sense_ids, second.matched_sense_ids);
  const confidencePass = Number(first.confidence) >= threshold && Number(second?.confidence) >= threshold;
  const consensus = decisionsAgree && senseIdsAgree && confidencePass;
  rows.push({
    candidate_id: candidateId,
    entry_id: first.entry_id,
    headword: first.headword,
    query_lang: first.query_lang,
    query_term: first.query_term,
    status: consensus ? 'consensus' : 'manual_review',
    decision: consensus ? first.decision : null,
    matched_sense_ids: consensus ? [...first.matched_sense_ids].map(Number).sort((a, b) => a - b) : [],
    primary: compact(first),
    secondary: second ? compact(second) : null,
    disagreement_codes: [
      ...(!second ? ['secondary_missing'] : []),
      ...(!first.valid ? ['primary_invalid'] : []),
      ...(second && !second.valid ? ['secondary_invalid'] : []),
      ...(first.valid && second?.valid && !decisionsAgree ? ['decision_disagreement'] : []),
      ...(decisionsAgree && !senseIdsAgree ? ['sense_id_disagreement'] : []),
      ...(decisionsAgree && senseIdsAgree && !confidencePass ? ['confidence_below_threshold'] : [])
    ],
    candidate: first.candidate
  });
}
const consensusRows = rows.filter((row) => row.status === 'consensus');
const summary = {
  total: rows.length,
  consensus: consensusRows.length,
  manual_review: rows.length - consensusRows.length,
  decisions: countBy(consensusRows, (row) => row.decision),
  disagreement_codes: countMany(rows, (row) => row.disagreement_codes)
};
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  confidence_threshold: threshold,
  primary: path.relative(process.cwd(), primaryPath),
  secondary: path.relative(process.cwd(), secondaryPath),
  summary,
  rows
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

function compact(row) { return { valid: row.valid, decision: row.decision, confidence: row.confidence, matched_sense_ids: row.matched_sense_ids, reason_codes: row.reason_codes, reason: row.reason, endpoint: row.endpoint, model: row.model }; }
function sameIds(left, right) { const a = [...(left || [])].map(Number).sort((x, y) => x - y); const b = [...(right || [])].map(Number).sort((x, y) => x - y); return a.length === b.length && a.every((value, index) => value === b[index]); }
function countBy(rows, getter) { const out = {}; for (const row of rows) { const key = getter(row) || 'null'; out[key] = (out[key] || 0) + 1; } return out; }
function countMany(rows, getter) { const out = {}; for (const row of rows) for (const key of getter(row) || []) out[key] = (out[key] || 0) + 1; return out; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : 'true'; } return out; }
function boundedNumber(value, fallback, minimum, maximum) { const parsed = value == null ? fallback : Number(value); if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid number: ${value}`); return parsed; }
