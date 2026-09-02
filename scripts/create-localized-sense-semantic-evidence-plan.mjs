import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = path.resolve(args.out || 'logs/localized-sense-semantic-evidence-plan.json');
const threshold = bounded(args.threshold, 0.9);
const input = readJson(inputPath), primary = readJson(primaryPath), secondary = readJson(secondaryPath);
const primaryById = new Map((primary.reviews || []).map((row) => [row.candidate_id, row]));
const secondaryById = new Map((secondary.reviews || []).map((row) => [row.candidate_id, row]));
const approved = [], rejected = [], links = [];

for (const candidate of input.candidates || []) {
  const first = primaryById.get(candidate.candidate_id), second = secondaryById.get(candidate.candidate_id);
  const accepted = first?.valid && second?.valid && first.decision === 'aligned' && second.decision === 'aligned' && Number(first.confidence) >= threshold && Number(second.confidence) >= threshold;
  if (!accepted) {
    rejected.push({ candidate_id: candidate.candidate_id, origin: candidate.origin, reason: rejectionReason(first, second, threshold), primary: compact(first), secondary: compact(second) });
    continue;
  }
  const review = { candidate_id: candidate.candidate_id, product_sense_id: Number(candidate.product_sense.sense_id), source_sense_id: Number(candidate.proposed_source_sense.sense_id), source_family: candidate.proposed_source_link.source_family, origin: candidate.origin, primary_model: first.model, primary_confidence: Number(first.confidence), secondary_model: second.model, secondary_confidence: Number(second.confidence) };
  approved.push(review);
  if (candidate.origin === 'discovered_suggestion') {
    links.push({
      product_sense_id: Number(candidate.product_sense.sense_id), product_entry_id: Number(candidate.product_sense.entry_id), headword: candidate.product_sense.headword,
      expected_existing_source_sense_ids: candidate.expected_existing_source_sense_ids,
      source_entry_id: Number(candidate.proposed_source_sense.entry_id), source_sense_id: Number(candidate.proposed_source_sense.sense_id),
      source_lang: candidate.proposed_source_sense.source_lang, source_word: candidate.proposed_source_sense.word,
      source_frequency_rank: candidate.proposed_source_sense.frequency_rank, source_name: candidate.proposed_source_sense.source,
      source_family: candidate.proposed_source_link.source_family,
      match_method: 'qwen_gemma_semantic_alignment_from_localized_repair_discovery',
      confidence: Math.min(Number(first.confidence), Number(second.confidence)),
      semantic_review: { status: 'independent_qwen_gemma_aligned', threshold, primary_model: first.model, primary_confidence: Number(first.confidence), secondary_model: second.model, secondary_confidence: Number(second.confidence) }
    });
  }
}
const output = { ok: true, created_at: new Date().toISOString(), database_write: false, apply_allowed: links.length > 0, input: relative(inputPath), inputs: { primary: relative(primaryPath), secondary: relative(secondaryPath) }, policy: { dual_model_semantic_alignment_required: true, minimum_confidence: threshold }, summary: { candidates: (input.candidates || []).length, approved_evidence: approved.length, approved_existing: approved.filter((row) => row.origin === 'existing_link').length, approved_new_links: links.length, rejected: rejected.length }, approved, links, rejected };
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function rejectionReason(first, second, threshold) { if (!first?.valid) return 'missing_or_invalid_primary_review'; if (!second?.valid) return 'missing_or_invalid_secondary_review'; if (first.decision !== 'aligned') return `primary_${first.decision}`; if (second.decision !== 'aligned') return `secondary_${second.decision}`; if (Number(first.confidence) < threshold) return 'primary_confidence_below_threshold'; return 'secondary_confidence_below_threshold'; }
function compact(row) { return row ? { decision: row.decision, confidence: row.confidence, model: row.model, reason_codes: row.reason_codes } : null; }
function bounded(value, fallback) { const n = value == null ? fallback : Number(value); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`Invalid threshold: ${value}`); return n; }
function relative(file) { return path.relative(process.cwd(), file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const file = path.resolve(value); if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`); return file; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2), next = argv[i + 1]; out[key] = next && !next.startsWith('--') ? argv[++i] : 'true'; } return out; }
