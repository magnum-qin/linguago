import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const SOURCE = 'manual:short-gloss-batch14-20260628';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const repairs = [
  {
    sense_id: 22882,
    part_of_speech: 'noun',
    gloss_key: 'traditional Chinese unit of length cun',
    locs: {
      en: loc(
        'cun',
        null,
        null,
        '/tsu\u02d0n/',
        'IPA',
        'A traditional Chinese unit of length, approximately equal to three centimeters.'
      ),
      zh: loc(
        '\u5bf8',
        'c\u00f9n',
        'pinyin',
        null,
        null,
        '\u4e2d\u56fd\u4f20\u7edf\u957f\u5ea6\u5355\u4f4d\uff0c\u7ea6\u7b49\u4e8e\u4e09\u5398\u7c73\u3002'
      ),
      ja: loc(
        '\u5bf8',
        '\u3059\u3093',
        'kana',
        null,
        null,
        '\u4e2d\u56fd\u306e\u4f1d\u7d71\u7684\u306a\u9577\u3055\u306e\u5358\u4f4d\u3002\u7d04\u4e09\u30bb\u30f3\u30c1\u30e1\u30fc\u30c8\u30eb\u306b\u76f8\u5f53\u3059\u308b\u3002'
      ),
      'pt-BR': loc(
        'cun',
        null,
        null,
        '/tsu\u02d0n/',
        'IPA',
        'Unidade tradicional chinesa de comprimento, aproximadamente igual a tres centimetros.'
      )
    }
  },
  {
    sense_id: 19266,
    part_of_speech: 'noun',
    gloss_key: 'Latin legal term meaning law',
    locs: {
      en: loc('lex', null, null, '/l\u025bks/', 'IPA', 'A Latin word meaning law, used in legal phrases.'),
      zh: loc(
        '\u6cd5',
        'f\u01ce',
        'pinyin',
        null,
        null,
        '\u62c9\u4e01\u8bed\u8bcd\u6c47\uff0c\u610f\u4e3a\u6cd5\u5f8b\uff0c\u5e38\u7528\u4e8e\u6cd5\u5f8b\u77ed\u8bed\u3002'
      ),
      ja: loc(
        '\u6cd5',
        '\u307b\u3046',
        'kana',
        null,
        null,
        '\u6cd5\u5f8b\u3092\u610f\u5473\u3059\u308b\u30e9\u30c6\u30f3\u8a9e\u306e\u8a9e\u3002\u6cd5\u5f8b\u7528\u8a9e\u3067\u7528\u3044\u3089\u308c\u308b\u3002'
      ),
      'pt-BR': loc(
        'lex',
        null,
        null,
        '/l\u025bks/',
        'IPA',
        'Termo latino que significa lei, usado em expressoes juridicas.'
      )
    }
  },
  {
    sense_id: 19927,
    part_of_speech: 'verb',
    gloss_key: 'to stain or soil with color',
    locs: {
      en: loc('stain', null, null, '/ste\u026an/', 'IPA', 'To stain, soil, or mark something with color.'),
      zh: loc(
        '\u6db4',
        'w\u00f2',
        'pinyin',
        null,
        null,
        '\u4f7f\u7269\u4f53\u67d3\u4e0a\u989c\u8272\u6216\u6c61\u8ff9\u3002'
      ),
      ja: loc(
        '\u6c5a\u3059',
        '\u3088\u3054\u3059',
        'kana',
        null,
        null,
        '\u7269\u306b\u8272\u3084\u6c5a\u308c\u3092\u3064\u3051\u308b\u3002'
      ),
      'pt-BR': loc('manchar', null, null, null, null, 'Manchar ou sujar algo com cor.')
    }
  },
  {
    sense_id: 21523,
    part_of_speech: 'abbreviation',
    gloss_key: 'abbreviation for June',
    locs: {
      en: loc('Jun.', null, null, '/d\u0292u\u02d0n/', 'IPA', 'Abbreviation for June, the sixth month of the year.'),
      zh: loc(
        '\u516d\u6708',
        'li\u00f9 yu\u00e8',
        'pinyin',
        null,
        null,
        '\u516d\u6708\u7684\u82f1\u6587\u7f29\u5199\uff0c\u8868\u793a\u4e00\u5e74\u4e2d\u7684\u7b2c\u516d\u4e2a\u6708\u3002'
      ),
      ja: loc(
        '\u516d\u6708',
        '\u308d\u304f\u304c\u3064',
        'kana',
        null,
        null,
        '\u516d\u6708\u3092\u8868\u3059\u82f1\u8a9e\u306e\u7565\u8a18\u3002'
      ),
      'pt-BR': loc('jun.', null, null, null, null, 'Abreviatura de junho, o sexto mes do ano.')
    }
  },
  {
    sense_id: 24542,
    part_of_speech: 'noun',
    gloss_key: 'disease or illness condition',
    locs: {
      en: loc('mal', null, null, '/m\u00e6l/', 'IPA', 'A disease, illness, or pathological condition.'),
      zh: loc('\u75c5', 'b\u00ecng', 'pinyin', null, null, '\u75be\u75c5\u6216\u75c5\u7406\u72b6\u6001\u3002'),
      ja: loc('\u75c5', '\u3084\u307e\u3044', 'kana', null, null, '\u75c5\u6c17\u3084\u75c5\u7406\u72b6\u614b\u3002'),
      'pt-BR': loc('mal', null, null, '/m\u0250w/', 'IPA', 'Doenca, enfermidade ou condicao patologica.')
    }
  },
  {
    sense_id: 29184,
    part_of_speech: 'interjection',
    gloss_key: 'marching call used to coordinate steps',
    locs: {
      en: loc('hup', null, null, '/h\u028cp/', 'IPA', 'A call used to coordinate steps while marching.'),
      zh: loc(
        '\u563f\u54df',
        'h\u0113i y\u014d',
        'pinyin',
        null,
        null,
        '\u884c\u8fdb\u6216\u64cd\u7ec3\u65f6\u7528\u6765\u534f\u8c03\u6b65\u4f10\u7684\u53e3\u4ee4\u58f0\u3002'
      ),
      ja: loc(
        '\u30cf\u30c3\u30d7',
        '\u306f\u3063\u3077',
        'kana',
        null,
        null,
        '\u884c\u9032\u306e\u6b69\u8abf\u3092\u5408\u308f\u305b\u308b\u305f\u3081\u306e\u639b\u3051\u58f0\u3002'
      ),
      'pt-BR': loc('hup', null, null, '/h\u028cp/', 'IPA', 'Exclamacao usada para coordenar passos durante uma marcha.')
    }
  }
];

const blocks = [
  {
    sense_id: 24290,
    block_code: 'blocked_source_ambiguous',
    rationale:
      "The 'nan' row mixes grandmother, Thai river, and bread senses, while zh/ja localizations incorrectly publish the Chinese character for south.",
    recommendation: "Keep blocked until 'nan' is split into source-backed senses or rebuilt from a validated source."
  },
  {
    sense_id: 28101,
    block_code: 'blocked_source_ambiguous',
    rationale:
      "The 'sod' row mixes an informal British person sense with a turf-covering verb sense in one localization set.",
    recommendation: 'Keep blocked until noun and verb senses are separated with clean four-language localizations.'
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const getSense = db.prepare('SELECT id FROM product_senses WHERE id = ?');
const getLoc = db.prepare('SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?');
const getBlock = db.prepare(
  'SELECT id FROM product_sense_publication_blocks WHERE product_sense_id = ? AND block_code = ?'
);

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = @part_of_speech,
      gloss_key = @gloss_key,
      confidence = MAX(confidence, 0.9)
  WHERE id = @sense_id
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
      confidence = MAX(confidence, 0.9),
      needs_review = 0
  WHERE product_sense_id = @sense_id
    AND lang = @lang
`);

const insertBlock = db.prepare(`
  INSERT INTO product_sense_publication_blocks (
    product_sense_id, block_code, rationale, recommendation, created_at, updated_at
  )
  VALUES (@sense_id, @block_code, @rationale, @recommendation, datetime('now'), datetime('now'))
`);

const stats = {
  apply,
  repaired_sense_ids: repairs.map((repair) => repair.sense_id),
  blocked_sense_ids: blocks.map((block) => block.sense_id),
  repaired_senses: 0,
  updated_localizations: 0,
  inserted_blocks: 0
};

validateInputs();

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    stats.repaired_senses += updateSense.run(repair).changes;
    for (const [lang, value] of Object.entries(repair.locs)) {
      stats.updated_localizations += updateLoc.run({
        sense_id: repair.sense_id,
        lang,
        ...value,
        source: SOURCE
      }).changes;
    }
  }

  for (const block of blocks) {
    if (!getBlock.get(block.sense_id, block.block_code)) {
      stats.inserted_blocks += insertBlock.run(block).changes;
    }
  }
});

if (apply) transaction();

console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), ...stats }, null, 2));
db.close();

function validateInputs() {
  for (const repair of repairs) {
    if (!getSense.get(repair.sense_id)) throw new Error(`Missing product_sense ${repair.sense_id}`);
    for (const lang of Object.keys(repair.locs)) {
      if (!getLoc.get(repair.sense_id, lang)) throw new Error(`Missing localization ${repair.sense_id}:${lang}`);
    }
  }
  for (const block of blocks) {
    if (!getSense.get(block.sense_id)) throw new Error(`Missing block sense ${block.sense_id}`);
  }
}

function loc(term, reading, readingSystem, pronunciation, pronunciationSystem, definition) {
  return {
    term,
    reading,
    reading_system: readingSystem,
    pronunciation,
    pronunciation_system: pronunciationSystem,
    definition
  };
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
