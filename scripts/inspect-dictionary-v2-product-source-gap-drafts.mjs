import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const limit = Number.parseInt(args.limit || '120', 10);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
const rows = db
  .prepare(
    `
    SELECT
      ps.id AS sense_id,
      pe.id AS entry_id,
      pe.headword,
      pe.primary_lang,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status,
      ps.confidence
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    WHERE pe.group_method = 'source_gap_unsloth'
      AND ps.status = 'draft_single_source'
    ORDER BY ps.id DESC
    LIMIT ?
  `
  )
  .all(Number.isFinite(limit) && limit > 0 ? limit : 120)
  .reverse();

console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
db.close();

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed[key] = 'true';
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
