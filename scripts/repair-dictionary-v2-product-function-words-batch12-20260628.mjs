import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const SOURCE = 'manual:function-word-batch12-20260628';

const repairs = [
  simple(
    11,
    'article',
    'definite article used before a specific noun',
    'the',
    'Definite article used before a specific noun.'
  ),
  simple(
    18,
    'preposition',
    'indicates direction, purpose, relation, or infinitive marker',
    'to',
    'Indicates direction, purpose, relation, or the infinitive marker.'
  ),
  simple(
    49,
    'preposition',
    'indicates possession, origin, relation, or part of a whole',
    'of',
    'Indicates possession, origin, relation, or part of a whole.'
  ),
  simple(54, 'verb', 'third-person singular present of be', 'is', 'Third-person singular present of be.'),
  full(63, 'pronoun', 'interrogative pronoun asking for information', {
    en: loc(
      'what',
      null,
      null,
      '/w\u028ct/',
      'IPA',
      'Interrogative pronoun used to ask for information about something.'
    ),
    zh: loc(
      '\u4ec0\u4e48',
      'sh\u00e9n me',
      'pinyin',
      null,
      null,
      '\u7591\u95ee\u4ee3\u8bcd\uff0c\u7528\u6765\u8be2\u95ee\u4e8b\u7269\u6216\u4fe1\u606f\u3002'
    ),
    ja: loc(
      '\u4f55',
      '\u306a\u306b',
      'kana',
      null,
      null,
      '\u7269\u4e8b\u3084\u60c5\u5831\u3092\u5c0b\u306d\u308b\u7591\u554f\u8a5e\u3002'
    ),
    'pt-BR': loc(
      'o que',
      null,
      null,
      '/u \u02c8k\u025b/',
      'IPA',
      'Pronome interrogativo usado para perguntar sobre algo ou alguma informa\u00e7\u00e3o.'
    )
  }),
  simple(95, 'determiner', 'belonging to or associated with me', 'my', 'Belonging to or associated with me.'),
  full(128, 'verb', 'past tense singular form of be', {
    en: loc('was', null, null, '/w\u0259z/', 'IPA', 'Past tense singular form of be.'),
    zh: loc(
      '\u662f\uff1b\u66fe\u662f',
      'sh\u00ec; c\u00e9ng sh\u00ec',
      'pinyin',
      null,
      null,
      '\u52a8\u8bcd be \u7684\u8fc7\u53bb\u65f6\u5355\u6570\u5f62\u5f0f\uff0c\u8868\u793a\u8fc7\u53bb\u7684\u72b6\u6001\u3001\u8eab\u4efd\u6216\u5b58\u5728\u3002'
    ),
    ja: loc(
      '\u3060\u3063\u305f',
      '\u3060\u3063\u305f',
      'kana',
      null,
      null,
      '\u52d5\u8a5e be \u306e\u904e\u53bb\u5f62\u5358\u6570\u3002\u904e\u53bb\u306e\u72b6\u614b\u3084\u5b58\u5728\u3092\u8868\u3059\u3002'
    ),
    'pt-BR': loc('era', null, null, '/\u02c8\u025b.\u027e\u0250/', 'IPA', 'Forma singular do passado do verbo be.')
  }),
  simple(
    149,
    'verb',
    'to exist or have a state, identity, or quality',
    'be',
    'To exist or have a state, identity, or quality.'
  ),
  simple(279, 'adverb', 'in what way or manner', 'how', 'In what way or manner.'),
  simple(360, 'adverb', 'at what time or during which time', 'when', 'At what time or during which time.'),
  full(403, 'pronoun', 'objective form of we', {
    en: loc(
      'us',
      null,
      null,
      '/\u028cs/',
      'IPA',
      'Objective form of we, used for the speaker and one or more other people.'
    ),
    zh: loc(
      '\u6211\u4eec',
      'w\u01d2 men',
      'pinyin',
      null,
      null,
      '\u4ee3\u8bcd we \u7684\u5bbe\u683c\u5f62\u5f0f\uff0c\u6307\u8bf4\u8bdd\u8005\u548c\u5176\u4ed6\u4eba\u3002'
    ),
    ja: loc(
      '\u79c1\u305f\u3061\u3092',
      '\u308f\u305f\u3057\u305f\u3061\u3092',
      'kana',
      null,
      null,
      '\u4ee3\u540d\u8a5e we \u306e\u76ee\u7684\u683c\u3002\u8a71\u3057\u624b\u3068\u4ed6\u306e\u4eba\u3092\u6307\u3059\u3002'
    ),
    'pt-BR': loc('nos', null, null, '/nos/', 'IPA', 'Forma objetiva de we, usada para o falante e uma ou mais pessoas.')
  }),
  simple(505, 'pronoun', 'an unspecified or unknown thing', 'something', 'An unspecified or unknown thing.'),
  simple(679, 'preposition', 'to or toward the inside of something', 'into', 'To or toward the inside of something.'),
  simple(1152, 'adverb', 'other or additional', 'else', 'Other or additional.'),
  simple(
    2015,
    'preposition',
    'in opposition to, touching, or facing',
    'against',
    'In opposition to, touching, or facing.'
  ),
  simple(2647, 'pronoun', 'reflexive or emphatic form of he', 'himself', 'Reflexive or emphatic form of he.'),
  simple(3496, 'conjunction', 'except if or if not', 'unless', 'Except if or if not.'),
  simple(5221, 'pronoun', 'reflexive or emphatic form of she', 'herself', 'Reflexive or emphatic form of she.'),
  simple(
    6388,
    'preposition',
    'in the direction of or with regard to',
    'towards',
    'In the direction of or with regard to.'
  ),
  full(8236, 'preposition', 'for each or by means of', {
    en: loc('per', null, null, '/p\u025cr/', 'IPA', 'For each, by means of, or according to a unit or rate.'),
    zh: loc(
      '\u6bcf\uff1b\u6309',
      'm\u011bi; \u00e0n',
      'pinyin',
      null,
      null,
      '\u4ecb\u8bcd\uff0c\u8868\u793a\u6bcf\u4e00\u5355\u4f4d\u3001\u6309\u7167\u6216\u901a\u8fc7\u67d0\u79cd\u65b9\u5f0f\u3002'
    ),
    ja: loc(
      '\uff5e\u3054\u3068\u306b',
      '\uff5e\u3054\u3068\u306b',
      'kana',
      null,
      null,
      '\u5358\u4f4d\u3042\u305f\u308a\u3001\u307e\u305f\u306f\u300c\uff5e\u306b\u3088\u3063\u3066\u300d\u3092\u8868\u3059\u524d\u7f6e\u8a5e\u3002'
    ),
    'pt-BR': loc(
      'por',
      null,
      null,
      '/po\u0281/',
      'IPA',
      'Indica cada unidade, taxa, meio ou forma; equivalente a por ou a cada.'
    )
  }),
  simple(
    11801,
    'preposition',
    'in the direction of or with regard to',
    'toward',
    'In the direction of or with regard to.'
  )
];

const db = new Database(dbPath);
db.pragma('busy_timeout = 30000');

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = ?,
      gloss_key = ?,
      confidence = MAX(confidence, 0.92)
  WHERE id = ?
`);

const updateEnglishDefinition = db.prepare(`
  UPDATE product_localizations
  SET term = ?,
      definition = ?,
      source = ?,
      confidence = MAX(confidence, 0.92),
      needs_review = 0
  WHERE product_sense_id = ?
    AND lang = 'en'
`);

const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = ?,
      reading = ?,
      reading_system = ?,
      pronunciation = ?,
      pronunciation_system = ?,
      definition = ?,
      source = ?,
      confidence = MAX(confidence, 0.92),
      needs_review = 0
  WHERE product_sense_id = ?
    AND lang = ?
`);

const verifyLocs = db.prepare(`
  SELECT COUNT(*) AS n
  FROM product_localizations
  WHERE product_sense_id = ?
`);

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    const locCount = verifyLocs.get(repair.sense_id).n;
    if (locCount !== 4) throw new Error(`Expected 4 localizations for sense ${repair.sense_id}, got ${locCount}`);
    const senseResult = updateSense.run(repair.part_of_speech, repair.gloss_key, repair.sense_id);
    if (senseResult.changes !== 1) throw new Error(`Missing product_sense ${repair.sense_id}`);
    if (repair.localizations) {
      for (const [lang, value] of Object.entries(repair.localizations)) {
        const result = updateLocalization.run(
          value.term,
          value.reading,
          value.reading_system,
          value.pronunciation,
          value.pronunciation_system,
          value.definition,
          SOURCE,
          repair.sense_id,
          lang
        );
        if (result.changes !== 1) throw new Error(`Missing localization ${repair.sense_id}:${lang}`);
      }
    } else {
      const result = updateEnglishDefinition.run(repair.en_term, repair.en_definition, SOURCE, repair.sense_id);
      if (result.changes !== 1) throw new Error(`Missing English localization ${repair.sense_id}`);
    }
  }
});

if (apply) transaction();

console.log(
  JSON.stringify(
    {
      ok: true,
      apply,
      db: path.relative(process.cwd(), dbPath),
      repaired_sense_ids: repairs.map((repair) => repair.sense_id)
    },
    null,
    2
  )
);

db.close();

function simple(sense_id, part_of_speech, gloss_key, en_term, en_definition) {
  return { sense_id, part_of_speech, gloss_key, en_term, en_definition };
}

function full(sense_id, part_of_speech, gloss_key, localizations) {
  return { sense_id, part_of_speech, gloss_key, localizations };
}

function loc(term, reading, reading_system, pronunciation, pronunciation_system, definition) {
  return { term, reading, reading_system, pronunciation, pronunciation_system, definition };
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
