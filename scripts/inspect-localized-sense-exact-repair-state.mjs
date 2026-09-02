import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const senseId = Number(args['sense-id'] || 125);
const lang = args.lang || 'zh';
const db = new Database(dbPath, { readonly: true });
const localization = db.prepare(`
  SELECT product_sense_id, lang, term, reading, reading_system, pronunciation,
         pronunciation_system, definition, source, confidence, needs_review
  FROM product_localizations WHERE product_sense_id=? AND lang=?
`).get(senseId, lang) || null;
db.close();
const hash = createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
console.log(JSON.stringify({ ok: Boolean(localization), db: path.relative(process.cwd(), dbPath), sha256: hash, localization }, null, 2));

function parseArgs(argv){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--'))continue;const key=argv[i].slice(2),next=argv[i+1];out[key]=next&&!next.startsWith('--')?argv[++i]:'true';}return out;}
