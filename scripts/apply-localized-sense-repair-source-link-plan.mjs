import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const planPath = requiredPath(args.plan, 'plan');
const apply = args.apply === 'true';
const plan = readJson(planPath);
if (!plan.apply_allowed) throw new Error('Plan is not applyable');
if (plan.policy?.dual_model_semantic_alignment_required !== true) {
  throw new Error('Refusing source-link plan without dual-model semantic alignment policy');
}
if ((plan.links || []).some((link) => link.semantic_review?.status !== 'independent_qwen_gemma_aligned')) {
  throw new Error('Refusing source link without independent Qwen/Gemma semantic approval');
}
const db = new Database(dbPath, { readonly: !apply });
db.pragma('busy_timeout = 30000');
const getTarget = db.prepare(`SELECT ps.id, ps.product_entry_id AS entry_id, pe.headword FROM product_senses ps JOIN product_entries pe ON pe.id=ps.product_entry_id WHERE ps.id=?`);
const getLinks = db.prepare(`SELECT source_sense_id FROM product_sense_source_links WHERE product_sense_id=? ORDER BY source_sense_id`);
const insert = apply ? db.prepare(`
  INSERT OR IGNORE INTO product_sense_source_links
    (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word,
     source_frequency_rank, match_method, confidence)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`) : null;
const results = [];
const appliedWithinPlan = new Map();

const execute = db.transaction(() => {
  for (const link of plan.links || []) {
    const target = getTarget.get(link.product_sense_id);
    const currentIds = getLinks.all(link.product_sense_id).map((row) => row.source_sense_id);
    const expectedIds = [...new Set([
      ...(link.expected_existing_source_sense_ids || []),
      ...(appliedWithinPlan.get(link.product_sense_id) || [])
    ])].sort((a, b) => a - b);
    let status = !target || target.entry_id !== link.product_entry_id || target.headword !== link.headword
      ? 'target_snapshot_mismatch'
      : currentIds.includes(link.source_sense_id)
        ? 'already_linked'
        : !sameIds(currentIds, expectedIds)
          ? 'source_links_snapshot_mismatch'
          : 'ready';
    if (status === 'ready' && apply) {
      const result = insert.run(link.product_sense_id, link.source_entry_id, link.source_sense_id,
        link.source_lang, link.source_word, link.source_frequency_rank, link.match_method, link.confidence);
      status = result.changes === 1 ? 'applied' : 'insert_skipped';
      if (status === 'applied') {
        const added = appliedWithinPlan.get(link.product_sense_id) || [];
        added.push(link.source_sense_id);
        appliedWithinPlan.set(link.product_sense_id, added);
      }
    }
    results.push({ product_sense_id: link.product_sense_id, source_sense_id: link.source_sense_id, status });
  }
});
execute();
const blockers = results.filter((row) => ['target_snapshot_mismatch','source_links_snapshot_mismatch','insert_skipped'].includes(row.status));
const output = { ok: blockers.length === 0, apply, database: path.relative(process.cwd(), dbPath), plan: path.relative(process.cwd(), planPath), summary: count(results), results };
console.log(JSON.stringify(output, null, 2));
db.close();
process.exitCode = output.ok ? 0 : 2;

function sameIds(left,right){return JSON.stringify(left||[])===JSON.stringify(right||[]);}
function count(rows){const out={total:rows.length};for(const row of rows)out[row.status]=(out[row.status]||0)+1;return out;}
function readJson(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
