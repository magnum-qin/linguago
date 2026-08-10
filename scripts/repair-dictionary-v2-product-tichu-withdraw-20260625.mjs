import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const SENSE_ID = 8334;

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const before = db
  .prepare(
    `
    SELECT lang, term, pronunciation, definition, source
    FROM product_localizations
    WHERE product_sense_id = ?
    ORDER BY lang
  `
  )
  .all(SENSE_ID);

let updated = 0;
if (apply) {
  updated = db
    .prepare(
      `
      UPDATE product_localizations
      SET term = 'withdraw; take out',
          pronunciation = '/wɪðˈdrɔː/; /teɪk aʊt/',
          pronunciation_system = 'IPA',
          definition = 'To take something out; to withdraw money or an item from a place.',
          source = 'manual:tichu-withdraw-repair-20260625',
          confidence = 0.95,
          needs_review = 0
      WHERE product_sense_id = ?
        AND lang = 'en'
    `
    )
    .run(SENSE_ID).changes;
}

const after = db
  .prepare(
    `
    SELECT lang, term, pronunciation, definition, source
    FROM product_localizations
    WHERE product_sense_id = ?
    ORDER BY lang
  `
  )
  .all(SENSE_ID);

console.log(
  JSON.stringify(
    {
      ok: before.some((row) => row.lang === 'en'),
      apply,
      updated,
      sense_id: SENSE_ID,
      before,
      after
    },
    null,
    2
  )
);

db.close();

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
