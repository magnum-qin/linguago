import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true' || args.apply === true;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  {
    sense_id: 7830,
    lang: 'ja',
    term: '卿',
    reading: 'きょう',
    reading_system: 'kana',
    definition: '高官や貴族への敬称。また、称号として用いられる接尾的な語。'
  },
  {
    sense_id: 18194,
    lang: 'ja',
    term: '卿',
    reading: 'きょう',
    reading_system: 'kana',
    definition: '歴史的文脈で相手を敬って呼ぶ二人称的な敬称。'
  },
  {
    sense_id: 14476,
    lang: 'pt-BR',
    term: 'não mesmo',
    definition: "negação informal ou enfática, equivalente a 'nuh-uh' ou 'de jeito nenhum'"
  },
  {
    sense_id: 18243,
    lang: 'pt-BR',
    term: 'não',
    definition: 'resposta negativa geral usada para negar, recusar ou discordar'
  },
  {
    sense_id: 22799,
    lang: 'pt-BR',
    term: 'afugentar',
    definition: 'fazer alguém ou algo se afastar causando medo'
  },
  {
    sense_id: 23139,
    lang: 'pt-BR',
    term: 'amedrontar',
    definition: 'causar medo ou ansiedade em alguém'
  },
  {
    sense_id: 23139,
    lang: 'ja',
    term: '怖がらせる',
    reading: 'こわがらせる',
    reading_system: 'kana',
    definition: '人に恐怖や不安を感じさせる'
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const before = getRows();
const update = db.prepare(`
  UPDATE product_localizations
  SET term = COALESCE(@term, term),
      reading = COALESCE(@reading, reading),
      reading_system = COALESCE(@reading_system, reading_system),
      definition = @definition,
      source = 'manual:keep-separate-duplicate-repair-20260624'
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

let changes = 0;
if (apply) {
  db.transaction(() => {
    for (const repair of repairs) {
      changes += update.run({ reading: null, reading_system: null, ...repair }).changes;
    }
  })();
}

const after = getRows();
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      apply,
      changes,
      before,
      after
    },
    null,
    2
  )
);

function getRows() {
  const ids = repairs.map((repair) => repair.sense_id);
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(
      `
      SELECT ps.id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
             pl.lang, pl.term, pl.reading, pl.reading_system, pl.definition, pl.source
      FROM product_senses ps
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.id IN (${placeholders})
        AND pl.lang IN ('ja', 'pt-BR')
      ORDER BY ps.product_entry_id, ps.sense_order, ps.id, pl.lang
    `
    )
    .all(...ids);
}

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
