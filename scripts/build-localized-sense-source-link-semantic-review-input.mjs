import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const planPath = requiredPath(args.plan, 'plan');
const dbPath = requiredPath(args.db, 'db');
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const outPath = path.resolve(args.out || 'logs/localized-sense-source-link-semantic-review-input.json');
const plan = readJson(planPath);
const db = new Database(dbPath, { readonly: true });
const sourceDb = new Database(sourceDbPath, { readonly: true });

const getProductSense = db.prepare(`
  SELECT ps.id AS sense_id, ps.product_entry_id AS entry_id, ps.sense_order,
         ps.part_of_speech, ps.gloss_key, pe.headword, pe.primary_lang
  FROM product_senses ps JOIN product_entries pe ON pe.id=ps.product_entry_id
  WHERE ps.id=?
`);
const getProductLocalizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence
  FROM product_localizations WHERE product_sense_id=? ORDER BY lang
`);
const getSourceSense = sourceDb.prepare(`
  SELECT s.id AS sense_id, s.entry_id, s.sense_order, s.part_of_speech,
         s.gloss_key, s.source, s.confidence, s.needs_review,
         e.word, e.source_lang, e.frequency_rank
  FROM senses s JOIN entries e ON e.id=s.entry_id WHERE s.id=?
`);
const getSourceLocalizations = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM sense_localizations WHERE sense_id=? ORDER BY lang
`);

const candidates = [];
const rejected = [];
for (const link of plan.links || []) {
  const product = getProductSense.get(link.product_sense_id);
  const source = getSourceSense.get(link.source_sense_id);
  const candidateId = candidateKey(link);
  if (!product || product.entry_id !== link.product_entry_id || product.headword !== link.headword) {
    rejected.push({ candidate_id: candidateId, reason: 'product_snapshot_mismatch' });
    continue;
  }
  if (!source || source.entry_id !== link.source_entry_id || source.word !== link.source_word || source.needs_review) {
    rejected.push({ candidate_id: candidateId, reason: 'source_snapshot_mismatch_or_review_required' });
    continue;
  }
  candidates.push({
    candidate_id: candidateId,
    product_sense: product,
    product_localizations: getProductLocalizations.all(product.sense_id),
    proposed_source_link: {
      product_sense_id: link.product_sense_id,
      source_entry_id: link.source_entry_id,
      source_sense_id: link.source_sense_id,
      source_family: link.source_family,
      match_method: link.match_method,
      supported_target_terms: link.supported_target_terms || []
    },
    proposed_source_sense: source,
    proposed_source_localizations: getSourceLocalizations.all(source.sense_id)
  });
}

const output = {
  ok: rejected.length === 0,
  created_at: new Date().toISOString(),
  database_write: false,
  plan: relative(planPath),
  database: relative(dbPath),
  source_db: relative(sourceDbPath),
  summary: { plan_links: (plan.links || []).length, candidates: candidates.length, rejected: rejected.length },
  candidates,
  rejected
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary: output.summary }, null, 2));
db.close();
sourceDb.close();
process.exitCode = output.ok ? 0 : 2;

function candidateKey(link) { return `product:${Number(link.product_sense_id)}:source:${Number(link.source_sense_id)}`; }
function relative(file) { return path.relative(process.cwd(), file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value, name) { if (!value) throw new Error(`Missing --${name}`); const file=path.resolve(value); if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`); return file; }
function parseArgs(argv) { const out={}; for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue; const key=argv[i].slice(2),next=argv[i+1]; out[key]=next&&!next.startsWith('--')?argv[++i]:'true';} return out; }
