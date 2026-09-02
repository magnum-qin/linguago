import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const evidencePath = requiredPath(args.evidence, 'evidence');
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = path.resolve(args.out || 'logs/localized-sense-repair-dispositions.json');
const threshold = bounded(args.threshold, 0.85);
const evidence = readJson(evidencePath), primary = readJson(primaryPath), secondary = readJson(secondaryPath);
const primaryBySense = new Map((primary.proposals || []).map((row) => [Number(row.sense_id), row]));
const secondaryBySense = new Map((secondary.proposals || []).map((row) => [Number(row.sense_id), row]));
const dispositions = [];

for (const repair of evidence.repairs || []) {
  const first = primaryBySense.get(Number(repair.sense_id));
  const second = secondaryBySense.get(Number(repair.sense_id));
  let disposition = 'manual_review_required';
  if (agrees(first, second, 'no_change', threshold)) disposition = 'verified_no_change';
  else if (agrees(first, second, 'repair', threshold) && samePatches(first.patches, second.patches)) disposition = 'exact_repair_candidate';
  dispositions.push({
    entry_id: repair.entry_id, sense_id: repair.sense_id, headword: repair.headword,
    query_forms: repair.query_forms, target_localizations: repair.target_localizations,
    disposition,
    evidence: {
      approved_source_links: repair.evidence_summary?.valid_links || 0,
      source_families: repair.evidence_summary?.independent_source_families || [],
      exact_replacement_available: Boolean(repair.evidence_summary?.eligible_for_model_patch_proposal)
    },
    primary: compact(first), secondary: compact(second)
  });
}
const summary = count(dispositions);
const output = { ok: true, created_at: new Date().toISOString(), database_write: false,
  inputs: { evidence: relative(evidencePath), primary: relative(primaryPath), secondary: relative(secondaryPath) },
  policy: { independent_qwen_gemma_required: true, minimum_confidence: threshold,
    manual_rows_are_not_authorized_for_database_repair: true }, summary, dispositions };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary }, null, 2));

function agrees(first, second, decision, threshold) { return first?.valid && second?.valid && first.decision === decision && second.decision === decision && Number(first.confidence) >= threshold && Number(second.confidence) >= threshold; }
function samePatches(left, right) { return canonical(left || []) === canonical(right || []); }
function compact(row) { return row ? { valid: row.valid, decision: row.decision, confidence: row.confidence, model: row.model, reason: row.reason, validation_errors: row.validation_errors } : null; }
function count(rows) { const out = { repairs: rows.length }; for (const row of rows) out[row.disposition] = (out[row.disposition] || 0) + 1; return out; }
function canonical(value) { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; return JSON.stringify(value); }
function bounded(value, fallback) { const n = value == null ? fallback : Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`Invalid threshold: ${value}`); return n; }
function relative(file) { return path.relative(process.cwd(), file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const file = path.resolve(value); if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`); return file; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2), next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : 'true'; } return out; }
