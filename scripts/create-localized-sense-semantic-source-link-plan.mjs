import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const planPath = requiredPath(args.plan, 'plan');
const primaryPath = requiredPath(args.primary, 'primary');
const secondaryPath = requiredPath(args.secondary, 'secondary');
const outPath = path.resolve(args.out || 'logs/localized-sense-semantic-source-link-plan.json');
const threshold = bounded(args.threshold, 0.9);
const plan = readJson(planPath);
const primary = readJson(primaryPath);
const secondary = readJson(secondaryPath);
const primaryById = new Map((primary.reviews || []).map((row) => [row.candidate_id, row]));
const secondaryById = new Map((secondary.reviews || []).map((row) => [row.candidate_id, row]));
const links = [];
const rejected = [];

for (const link of plan.links || []) {
  const candidateId = `product:${Number(link.product_sense_id)}:source:${Number(link.source_sense_id)}`;
  const first = primaryById.get(candidateId);
  const second = secondaryById.get(candidateId);
  const approved = first?.valid && second?.valid &&
    first.decision === 'aligned' && second.decision === 'aligned' &&
    Number(first.confidence) >= threshold && Number(second.confidence) >= threshold;
  if (!approved) {
    rejected.push({ candidate_id: candidateId, product_sense_id: link.product_sense_id,
      source_sense_id: link.source_sense_id, reason: rejectionReason(first, second, threshold),
      primary: compact(first), secondary: compact(second) });
    continue;
  }
  links.push({ ...link,
    match_method: `${link.match_method}+qwen_gemma_semantic_alignment`,
    confidence: Math.min(Number(link.confidence || 1), Number(first.confidence), Number(second.confidence)),
    semantic_review: {
      status: 'independent_qwen_gemma_aligned', threshold,
      primary_model: first.model, primary_confidence: Number(first.confidence),
      secondary_model: second.model, secondary_confidence: Number(second.confidence)
    }
  });
}

const output = {
  ok: true, created_at: new Date().toISOString(), database_write: false,
  apply_allowed: links.length > 0, source_plan: relative(planPath),
  inputs: { primary: relative(primaryPath), secondary: relative(secondaryPath) },
  policy: { dual_model_semantic_alignment_required: true, minimum_confidence: threshold },
  summary: { candidates: (plan.links || []).length, approved_links: links.length, rejected: rejected.length },
  links, rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function rejectionReason(first, second, threshold) { if(!first?.valid)return 'missing_or_invalid_primary_review'; if(!second?.valid)return 'missing_or_invalid_secondary_review'; if(first.decision!=='aligned')return `primary_${first.decision}`; if(second.decision!=='aligned')return `secondary_${second.decision}`; if(Number(first.confidence)<threshold)return 'primary_confidence_below_threshold'; return 'secondary_confidence_below_threshold'; }
function compact(row){return row?{decision:row.decision,confidence:row.confidence,model:row.model,reason_codes:row.reason_codes}:null;}
function bounded(value,fallback){const n=value==null?fallback:Number(value);if(!Number.isFinite(n)||n<0||n>1)throw new Error(`Invalid threshold: ${value}`);return n;}
function relative(file){return path.relative(process.cwd(),file);}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
