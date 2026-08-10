import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const apply = args.apply === 'true' || args.apply === true;

const senseId = 12840;
const source = 'manual:pet-trumpet-repair-20260624';

const localizations = [
  {
    lang: 'en',
    term: 'trumpet',
    reading: null,
    reading_system: null,
    pronunciation: '/ˈtrʌm.pɪt/',
    pronunciation_system: 'IPA',
    definition: 'A brass musical instrument played by blowing through a mouthpiece.'
  },
  {
    lang: 'ja',
    term: 'トランペット',
    reading: 'トランペット',
    reading_system: 'katakana',
    pronunciation: null,
    pronunciation_system: null,
    definition: '金管楽器の一種。唇を振動させて音を出す楽器。'
  },
  {
    lang: 'zh',
    term: '小号',
    reading: 'xiǎohào',
    reading_system: 'pinyin',
    pronunciation: null,
    pronunciation_system: null,
    definition: '一种铜管乐器，通过吹嘴吹奏发声。'
  },
  {
    lang: 'pt-BR',
    term: 'trompete',
    reading: null,
    reading_system: null,
    pronunciation: '/tɾõˈpe.tʃi/',
    pronunciation_system: 'IPA',
    definition: 'Instrumento musical de sopro da família dos metais, tocado com um bocal.'
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const before = readRows();
const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = 'noun',
      gloss_key = 'trumpet'
  WHERE id = ?
`);
const updateLoc = db.prepare(`
  UPDATE product_localizations
  SET term = @term,
      reading = @reading,
      reading_system = @reading_system,
      pronunciation = @pronunciation,
      pronunciation_system = @pronunciation_system,
      definition = @definition,
      source = @source,
      confidence = 0.95,
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

let changes = 0;
if (apply) {
  db.transaction(() => {
    changes += updateSense.run(senseId).changes;
    for (const localization of localizations) {
      changes += updateLoc.run({ ...localization, sense_id: senseId, source }).changes;
    }
  })();
}

const after = readRows();
console.log(JSON.stringify({ ok: true, db: dbPath, apply, changes, before, after }, null, 2));
db.close();

function readRows() {
  return db
    .prepare(
      `
      SELECT s.id AS sense_id, s.sense_order, s.part_of_speech, s.gloss_key,
             l.lang, l.term, l.reading, l.reading_system,
             l.pronunciation, l.pronunciation_system, l.definition, l.source
      FROM product_senses s
      JOIN product_localizations l ON l.product_sense_id = s.id
      WHERE s.id = ?
      ORDER BY l.lang
    `
    )
    .all(senseId);
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
