import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const planPath = requiredPath(args.plan, 'plan');
const apply = args.apply === 'true';
const plan = readJson(planPath);
if (!plan.apply_allowed) throw new Error('Plan is not applyable');
const db = new Database(dbPath, { readonly: !apply });
db.pragma('busy_timeout = 30000');
const get = db.prepare(`SELECT id, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review FROM product_localizations WHERE product_sense_id=? AND lang=?`);
const update = apply ? db.prepare(`UPDATE product_localizations SET term=?, reading=?, reading_system=?, pronunciation=?, pronunciation_system=?, definition=?, source=?, confidence=?, needs_review=0 WHERE id=?`) : null;
const results = [];

const execute = db.transaction(() => {
  for (const repair of plan.repairs || []) {
    const current = get.get(repair.sense_id, repair.lang);
    const status = !current ? 'missing_localization'
      : same(current, repair.replacement) ? 'already_applied'
      : !same(current, repair.expected_current) ? 'snapshot_mismatch'
      : 'ready';
    if (status === 'ready' && apply) {
      const row = repair.replacement;
      update.run(row.term, row.reading, row.reading_system, row.pronunciation, row.pronunciation_system,
        row.definition, plan.source, repair.confidence, current.id);
    }
    results.push({ sense_id: repair.sense_id, lang: repair.lang, status: status === 'ready' && apply ? 'applied' : status });
  }
});
execute();
const blockers = results.filter((row) => ['missing_localization', 'snapshot_mismatch'].includes(row.status));
const output = { ok: blockers.length === 0, apply, database: path.relative(process.cwd(), dbPath), plan: path.relative(process.cwd(), planPath), summary: count(results), results };
console.log(JSON.stringify(output, null, 2));
db.close();
process.exitCode = output.ok ? 0 : 2;

function same(left, right) { return ['term','reading','reading_system','pronunciation','pronunciation_system','definition'].every((key)=>String(left?.[key]??'')===String(right?.[key]??'')); }
function count(rows) { const out={total:rows.length}; for(const row of rows)out[row.status]=(out[row.status]||0)+1; return out; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function requiredPath(value,name){if(!value)throw new Error(`Missing --${name}`);const file=path.resolve(value);if(!fs.existsSync(file))throw new Error(`File not found: ${file}`);return file;}
function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
