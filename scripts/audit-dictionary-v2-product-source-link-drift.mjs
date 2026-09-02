import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const productDb = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const sourceDb = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const outPath = args.out ? path.resolve(args.out) : null;
const sampleLimit = Number(args['sample-limit'] || 50);

if (!fs.existsSync(productDb)) throw new Error(`Product database not found: ${productDb}`);
if (!fs.existsSync(sourceDb)) throw new Error(`Source database not found: ${sourceDb}`);

const db = new Database(productDb, { readonly: true });
db.pragma('busy_timeout = 30000');
db.prepare('ATTACH DATABASE ? AS source_db').run(sourceDb);

const summary = db.prepare(`
  SELECT
    COUNT(*) AS links,
    SUM(CASE WHEN s.id IS NULL THEN 1 ELSE 0 END) AS missing_source_sense,
    SUM(CASE WHEN s.id IS NOT NULL AND e.id IS NULL THEN 1 ELSE 0 END) AS missing_source_entry,
    SUM(CASE WHEN s.id IS NOT NULL AND e.id IS NOT NULL
      AND l.source_entry_id <> s.entry_id THEN 1 ELSE 0 END) AS entry_id_mismatches,
    SUM(CASE WHEN s.id IS NOT NULL AND e.id IS NOT NULL AND (
      lower(trim(COALESCE(l.source_word, ''))) <> lower(trim(COALESCE(e.word, '')))
      OR lower(trim(COALESCE(l.source_lang, ''))) <> lower(trim(COALESCE(e.source_lang, '')))
    ) THEN 1 ELSE 0 END) AS snapshot_mismatches
  FROM product_sense_source_links l
  LEFT JOIN source_db.senses s ON s.id = l.source_sense_id
  LEFT JOIN source_db.entries e ON e.id = s.entry_id
`).get();

const samples = db.prepare(`
  SELECT
    l.id AS link_id,
    l.product_sense_id,
    l.source_sense_id,
    l.source_lang AS snapshot_lang,
    l.source_word AS snapshot_word,
    e.source_lang AS current_lang,
    e.word AS current_word,
    CASE
      WHEN s.id IS NULL THEN 'missing_source_sense'
      WHEN e.id IS NULL THEN 'missing_source_entry'
      WHEN l.source_entry_id <> s.entry_id THEN 'entry_id_mismatch'
      ELSE 'snapshot_mismatch'
    END AS reason
  FROM product_sense_source_links l
  LEFT JOIN source_db.senses s ON s.id = l.source_sense_id
  LEFT JOIN source_db.entries e ON e.id = s.entry_id
  WHERE s.id IS NULL
     OR e.id IS NULL
     OR l.source_entry_id <> s.entry_id
     OR lower(trim(COALESCE(l.source_word, ''))) <> lower(trim(COALESCE(e.word, '')))
     OR lower(trim(COALESCE(l.source_lang, ''))) <> lower(trim(COALESCE(e.source_lang, '')))
  ORDER BY l.id
  LIMIT ?
`).all(sampleLimit);

const report = {
  ok:
    Number(summary.missing_source_sense) === 0 &&
    Number(summary.missing_source_entry) === 0 &&
    Number(summary.entry_id_mismatches) === 0 &&
    Number(summary.snapshot_mismatches) === 0,
  product_db: path.relative(process.cwd(), productDb),
  source_db: path.relative(process.cwd(), sourceDb),
  summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value)])),
  samples
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
