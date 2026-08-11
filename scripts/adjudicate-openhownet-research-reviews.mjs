import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const qwenPath = path.resolve(args.qwen || 'logs/product-source-gap-v90-openhownet-qwen-review.json');
const gemmaPath = path.resolve(args.gemma || 'logs/product-source-gap-v90-openhownet-gemma-review.json');
const outPath = path.resolve(args.out || 'logs/product-source-gap-v90-openhownet-dual-model-consensus.json');
const threshold = Number(args['confidence-threshold'] || 0.9);
const qwen = readResearchReport(qwenPath);
const gemma = readResearchReport(gemmaPath);
const qwenMap = new Map(qwen.reviews.map((row) => [row.candidate_key, row]));
const gemmaMap = new Map(gemma.reviews.map((row) => [row.candidate_key, row]));
const keys = [...new Set([...qwenMap.keys(), ...gemmaMap.keys()])].sort();
const decisions = keys.map((candidateKey) => {
  const a = qwenMap.get(candidateKey); const b = gemmaMap.get(candidateKey);
  const selectedTerms = [a?.selected_zh_term, b?.selected_zh_term].filter(Boolean);
  const sameSelectedTerm = selectedTerms.length === 0 || (selectedTerms.length === 2 && selectedTerms[0] === selectedTerms[1]);
  const accept = sameSelectedTerm && [a, b].every((row) => row?.valid && row.decision === 'accept' && row.confidence >= threshold && !row.suggested_zh_term);
  const disagreement = Boolean(a && b && a.decision !== b.decision);
  return {
    candidate_key: candidateKey,
    selected_zh_term: accept && selectedTerms.length === 2 ? selectedTerms[0] : null,
    status: accept ? 'license_blocked_dual_model_accept' : disagreement ? 'license_blocked_model_disagreement' : 'license_blocked_manual_review',
    consensus_accept: accept, generation_allowed: false, publication_evidence: false,
    qwen: pick(a), gemma: pick(b)
  };
});
const summary = {
  total: decisions.length,
  consensus_accept: decisions.filter((row) => row.consensus_accept).length,
  disagreements: decisions.filter((row) => row.status === 'license_blocked_model_disagreement').length,
  blocked_other: decisions.filter((row) => !row.consensus_accept && row.status !== 'license_blocked_model_disagreement').length
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({
  ok: true, generated_at: new Date().toISOString(), research_only: true, production_publishable: false,
  generation_allowed: false, publication_evidence: false, confidence_threshold: threshold,
  inputs: [path.relative(process.cwd(), qwenPath), path.relative(process.cwd(), gemmaPath)], summary, decisions
}, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

function readResearchReport(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing review: ${file}`);
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (report.research_only !== true || report.production_publishable !== false) throw new Error(`Unsafe review metadata: ${file}`);
  return report;
}
function pick(row) { return row ? { valid: row.valid, decision: row.decision, confidence: row.confidence, approved: row.approved, reason: row.reason || row.error || '', risk_flags: row.risk_flags || [], suggested_zh_term: row.suggested_zh_term || null, selected_zh_term: row.selected_zh_term || null } : null; }
function parseArgs(argv) { const out = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const key = argv[i].slice(2); const next = argv[i + 1]; if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true; } return out; }
