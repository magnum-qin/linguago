import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const productDb = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const sourceDb = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const outPath = args.out ? path.resolve(args.out) : null;

if (!fs.existsSync(productDb)) throw new Error(`Product database not found: ${productDb}`);
if (!fs.existsSync(sourceDb)) throw new Error(`Source database not found: ${sourceDb}`);

const db = new Database(productDb, { readonly: true });
db.pragma('busy_timeout = 30000');
db.prepare('ATTACH DATABASE ? AS source_db').run(sourceDb);

const driftRows = db.prepare(`
  SELECT
    l.id AS link_id,
    l.product_sense_id,
    pe.headword,
    pe.primary_lang,
    ps.sense_order,
    ps.gloss_key,
    l.source_entry_id,
    l.source_sense_id,
    l.source_lang,
    l.source_word,
    l.match_method,
    e.id AS linked_entry_id,
    e.word AS linked_word,
    e.source_lang AS linked_lang,
    s.gloss_key AS linked_gloss
  FROM product_sense_source_links l
  JOIN product_senses ps ON ps.id = l.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  LEFT JOIN source_db.senses s ON s.id = l.source_sense_id
  LEFT JOIN source_db.entries e ON e.id = s.entry_id
  WHERE s.id IS NULL
     OR e.id IS NULL
     OR l.source_entry_id <> s.entry_id
     OR lower(trim(COALESCE(l.source_word, ''))) <> lower(trim(COALESCE(e.word, '')))
     OR lower(trim(COALESCE(l.source_lang, ''))) <> lower(trim(COALESCE(e.source_lang, '')))
  ORDER BY l.id
`).all();

const candidateStmt = db.prepare(`
  SELECT
    e.id AS source_entry_id,
    e.word,
    e.source_lang,
    s.id AS source_sense_id,
    s.sense_order,
    s.part_of_speech,
    s.gloss_key,
    s.source,
    s.confidence,
    s.needs_review
  FROM source_db.entries e
  JOIN source_db.senses s ON s.entry_id = e.id
  WHERE e.id = ?
  ORDER BY s.sense_order, s.id
`);

const snapshotCandidateStmt = db.prepare(`
  SELECT
    e.id AS source_entry_id,
    e.word,
    e.source_lang,
    s.id AS source_sense_id,
    s.sense_order,
    s.part_of_speech,
    s.gloss_key,
    s.source,
    s.confidence,
    s.needs_review
  FROM source_db.entries e
  JOIN source_db.senses s ON s.entry_id = e.id
  WHERE lower(trim(e.word)) = lower(trim(?))
    AND lower(trim(e.source_lang)) = lower(trim(?))
  ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id, s.sense_order, s.id
`);

const rows = driftRows.map((row) => ({
  ...row,
  source_entry_candidates: candidateStmt.all(row.source_entry_id),
  snapshot_candidates: snapshotCandidateStmt.all(row.source_word, row.source_lang)
}));
const report = {
  ok: rows.length === 0,
  product_db: path.relative(process.cwd(), productDb),
  source_db: path.relative(process.cwd(), sourceDb),
  drift_links: rows.length,
  rows
};
const output = `${JSON.stringify(report, null, 2)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, output, 'utf8');
}
process.stdout.write(output);
db.close();
process.exitCode = report.ok ? 0 : 2;

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
