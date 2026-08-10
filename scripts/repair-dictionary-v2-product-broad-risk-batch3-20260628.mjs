import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const SOURCE = 'manual:broad-risk-batch3-conservative-repair-20260628';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const stats = {
  apply,
  updated_senses: 0,
  inserted_senses: 0,
  updated_localizations: 0,
  inserted_localizations: 0,
  inserted_source_links: 0,
  inserted_blocks: 0,
  notes: []
};

const getMaxSenseId = db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM product_senses');
const getSense = db.prepare('SELECT * FROM product_senses WHERE id = ?');
const getLoc = db.prepare('SELECT * FROM product_localizations WHERE product_sense_id = ? AND lang = ?');
const getBlock = db.prepare(
  'SELECT id FROM product_sense_publication_blocks WHERE product_sense_id = ? AND block_code = ?'
);

const updateSense = db.prepare(`
  UPDATE product_senses
  SET part_of_speech = @part_of_speech,
      gloss_key = @gloss_key,
      confidence = MAX(confidence, @confidence)
  WHERE id = @id
`);

const insertSense = db.prepare(`
  INSERT INTO product_senses (id, product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
  VALUES (@id, @product_entry_id, @sense_order, @part_of_speech, @gloss_key, 'accepted', @confidence, datetime('now'))
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
      confidence = @confidence,
      needs_review = 0
  WHERE product_sense_id = @product_sense_id
    AND lang = @lang
`);

const insertLoc = db.prepare(`
  INSERT INTO product_localizations (
    product_sense_id, lang, term, reading, reading_system, pronunciation,
    pronunciation_system, definition, source, confidence, needs_review
  )
  VALUES (
    @product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation,
    @pronunciation_system, @definition, @source, @confidence, 0
  )
`);

const insertSourceLink = db.prepare(`
  INSERT INTO product_sense_source_links (
    product_sense_id, source_entry_id, source_sense_id, source_lang, source_word,
    source_frequency_rank, match_method, confidence
  )
  SELECT @new_sense_id, source_entry_id, source_sense_id, source_lang, source_word,
         source_frequency_rank, @match_method, @confidence
  FROM product_sense_source_links
  WHERE product_sense_id = @old_sense_id
`);

const insertBlock = db.prepare(`
  INSERT INTO product_sense_publication_blocks (
    product_sense_id, block_code, rationale, recommendation, created_at, updated_at
  )
  VALUES (@product_sense_id, @block_code, @rationale, @recommendation, datetime('now'), datetime('now'))
`);

const transaction = db.transaction(() => {
  repairLiver();
  repairProven();
  blockBaconMixedProperNameSense();
});

if (apply) transaction();
else {
  stats.notes.push('dry-run only; pass --apply true to write changes');
  validateInputs();
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function repairLiver() {
  const original = getSense.get(13814);
  if (!original) throw new Error('Missing liver sense 13814');
  const foodSenseId = Number(getMaxSenseId.get().n) + 1;

  stats.updated_senses += updateSense.run({
    id: 13814,
    part_of_speech: 'noun',
    gloss_key: 'anatomical organ',
    confidence: 0.9
  }).changes;

  const organLocs = {
    en: loc(
      'liver',
      null,
      null,
      '/\u02c8l\u026av\u0259r/',
      'IPA',
      'A large glandular organ in the abdomen that secretes bile, supports metabolism and detoxification, and helps regulate blood chemistry.'
    ),
    zh: loc(
      '\u809d\u810f',
      'g\u0101n z\u00e0ng',
      'pinyin',
      null,
      null,
      '\u8179\u8154\u4e2d\u7684\u5927\u578b\u7ea2\u8910\u8272\u5668\u5b98\uff0c\u5206\u6ccc\u80c6\u6c41\uff0c\u53c2\u4e0e\u4ee3\u8c22\u548c\u89e3\u6bd2\u3002'
    ),
    ja: loc(
      '\u809d\u81d3',
      '\u304b\u3093\u305e\u3046',
      'kana',
      null,
      null,
      '\u8179\u90e8\u306b\u3042\u308b\u5927\u304d\u306a\u5668\u5b98\u3002\u80c6\u6c41\u306e\u5206\u6ccc\u3001\u4ee3\u8b1d\u3001\u89e3\u6bd2\u306a\u3069\u306b\u95a2\u308f\u308b\u3002'
    ),
    'pt-BR': loc(
      'f\u00edgado',
      null,
      null,
      '/\u02c8fi.\u0261a.du/',
      'IPA',
      '\u00d3rg\u00e3o glandular no abdome que secreta bile, participa do metabolismo e ajuda na desintoxica\u00e7\u00e3o.'
    )
  };
  upsertLocs(13814, organLocs);

  stats.inserted_senses += insertSense.run({
    id: foodSenseId,
    product_entry_id: original.product_entry_id,
    sense_order: 2,
    part_of_speech: 'noun',
    gloss_key: 'animal liver used as food',
    confidence: 0.9
  }).changes;

  const foodLocs = {
    en: loc('liver', null, null, '/\u02c8l\u026av\u0259r/', 'IPA', 'The liver of an animal used as meat or food.'),
    zh: loc(
      '\u52a8\u7269\u809d\u810f',
      'd\u00f2ng w\u00f9 g\u0101n z\u00e0ng',
      'pinyin',
      null,
      null,
      '\u4f5c\u4e3a\u98df\u7269\u98df\u7528\u7684\u52a8\u7269\u809d\u810f\u3002'
    ),
    ja: loc(
      '\u30ec\u30d0\u30fc',
      '\u308c\u3070\u30fc',
      'kana',
      null,
      null,
      '\u98df\u7528\u306b\u3059\u308b\u52d5\u7269\u306e\u809d\u81d3\u3002'
    ),
    'pt-BR': loc(
      'f\u00edgado',
      null,
      null,
      '/\u02c8fi.\u0261a.du/',
      'IPA',
      'F\u00edgado de animal usado como carne ou alimento.'
    )
  };
  upsertLocs(foodSenseId, foodLocs);

  stats.inserted_source_links += insertSourceLink.run({
    new_sense_id: foodSenseId,
    old_sense_id: 13814,
    match_method: SOURCE,
    confidence: 0.9
  }).changes;
  stats.notes.push(`split liver sense 13814 into organ + food sense ${foodSenseId}`);
}

function repairProven() {
  if (!getSense.get(19406)) throw new Error('Missing proven sense 19406');
  stats.updated_senses += updateSense.run({
    id: 19406,
    part_of_speech: 'adjective',
    gloss_key: 'established beyond doubt',
    confidence: 0.9
  }).changes;
  const locs = {
    en: loc(
      'proven',
      null,
      null,
      '/\u02c8pru\u02d0v\u0259n/',
      'IPA',
      'Established beyond doubt; shown to be true or valid by evidence or proof.'
    ),
    zh: loc(
      '\u5df2\u8bc1\u5b9e\u7684',
      'y\u01d0 zh\u00e8ng sh\u00ed de',
      'pinyin',
      null,
      null,
      '\u5df2\u7ecf\u901a\u8fc7\u8bc1\u636e\u6216\u8bba\u8bc1\u8868\u660e\u4e3a\u771f\u5b9e\u6216\u6709\u6548\u7684\u3002'
    ),
    ja: loc(
      '\u8a3c\u660e\u3055\u308c\u305f',
      '\u3057\u3087\u3046\u3081\u3044\u3055\u308c\u305f',
      'kana',
      null,
      null,
      '\u8a3c\u62e0\u3084\u8a3c\u660e\u306b\u3088\u3063\u3066\u771f\u5b9f\u307e\u305f\u306f\u6709\u52b9\u3067\u3042\u308b\u3053\u3068\u304c\u793a\u3055\u308c\u305f\u3002'
    ),
    'pt-BR': loc(
      'comprovado',
      null,
      null,
      '/k\u00f5.p\u027e\u0254.\u02c8va.du/',
      'IPA',
      'Demonstrado como verdadeiro ou v\u00e1lido por evid\u00eancia ou prova.'
    )
  };
  upsertLocs(19406, locs);
  stats.notes.push('reduced proven sense 19406 to the published adjective sense');
}

function blockBaconMixedProperNameSense() {
  const productSenseId = 16099;
  if (!getSense.get(productSenseId)) throw new Error('Missing bacon mixed sense 16099');
  const code = 'blocked_source_ambiguous';
  if (!getBlock.get(productSenseId, code)) {
    stats.inserted_blocks += insertBlock.run({
      product_sense_id: productSenseId,
      block_code: code,
      rationale:
        'Mixed bacon food sense with Roger Bacon and Francis Bacon proper-name encyclopedia senses; entry already has a clean bacon food sense.',
      recommendation: 'Keep blocked unless proper-name entries are intentionally modeled separately.'
    }).changes;
  }
  stats.notes.push('blocked bacon sense 16099; clean food sense 16098 remains publishable');
}

function upsertLocs(senseId, locs) {
  for (const [lang, value] of Object.entries(locs)) {
    const payload = {
      product_sense_id: senseId,
      lang,
      ...value,
      source: SOURCE,
      confidence: 0.9
    };
    if (getLoc.get(senseId, lang)) stats.updated_localizations += updateLoc.run(payload).changes;
    else stats.inserted_localizations += insertLoc.run(payload).changes;
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

function validateInputs() {
  for (const id of [13814, 16099, 19406]) {
    if (!getSense.get(id)) throw new Error(`Missing required sense ${id}`);
  }
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
