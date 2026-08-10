import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true' || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const senseId = 22993;
const updates = [
  {
    lang: 'pt-BR',
    term: 'tia',
    definition:
      'mulher mais velha próxima, parente feminina ou amiga íntima da família, usada como tratamento carinhoso'
  },
  {
    lang: 'zh',
    term: '阿姨',
    definition: '对女性长辈、女性亲戚或亲近的家庭朋友的亲切称呼'
  },
  {
    lang: 'ja',
    term: 'おばさん',
    reading: 'おばさん',
    reading_system: 'kana',
    definition: '年上の女性、女性の親族、または家族ぐるみで親しい女性への親しみを込めた呼び方'
  }
];

const before = db
  .prepare(
    `
    SELECT ps.id, ps.part_of_speech, pl.lang, pl.term, pl.reading, pl.reading_system, pl.definition, pl.source
    FROM product_senses ps
    JOIN product_localizations pl ON pl.product_sense_id = ps.id
    WHERE ps.id = ?
    ORDER BY pl.lang
  `
  )
  .all(senseId);

const updateSense = db.prepare("UPDATE product_senses SET part_of_speech = 'noun' WHERE id = ?");
const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = COALESCE(@term, term),
      reading = COALESCE(@reading, reading),
      reading_system = COALESCE(@reading_system, reading_system),
      definition = @definition,
      source = 'manual:aunty-broad-sense-repair-20260624'
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

let changes = 0;
if (apply) {
  db.transaction(() => {
    changes += updateSense.run(senseId).changes;
    for (const update of updates) {
      changes += updateLocalization.run({ sense_id: senseId, reading: null, reading_system: null, ...update }).changes;
    }
  })();
}

const after = db
  .prepare(
    `
    SELECT ps.id, ps.part_of_speech, pl.lang, pl.term, pl.reading, pl.reading_system, pl.definition, pl.source
    FROM product_senses ps
    JOIN product_localizations pl ON pl.product_sense_id = ps.id
    WHERE ps.id = ?
    ORDER BY pl.lang
  `
  )
  .all(senseId);

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      apply,
      sense_id: senseId,
      changes,
      before,
      after
    },
    null,
    2
  )
);

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
