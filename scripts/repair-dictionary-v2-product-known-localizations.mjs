import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const source = 'known-localization-repair-20260619';
const fixes = [
  {
    headword: 'hello',
    primary_lang: 'en',
    gloss_key: 'n. an expression of greeting',
    lang: 'en',
    term: 'hello',
    pronunciation: '/həˈloʊ/',
    pronunciation_system: 'IPA',
    definition: 'Used as a greeting or to begin a telephone conversation.'
  },
  {
    headword: '你好',
    primary_lang: 'zh',
    gloss_key: 'hello; hi',
    lang: 'zh',
    term: '你好',
    reading: 'nǐ hǎo',
    reading_system: 'pinyin',
    definition: '用于问候或开始电话对话的致意语。'
  },
  {
    headword: 'shall',
    primary_lang: 'en',
    sense_order: 1,
    lang: 'ja',
    term: '〜するものとする',
    reading: '〜するものとする',
    reading_system: 'kana',
    definition: '英語の助動詞で、未来、義務、命令、約束などを表す。'
  },
  {
    headword: 'should',
    primary_lang: 'en',
    sense_order: 1,
    lang: 'ja',
    term: '〜すべきだ',
    reading: '〜すべきだ',
    reading_system: 'kana',
    definition: '英語の助動詞で、義務、助言、推量、条件などを表す。'
  }
];

const getSense = db.prepare(`
  SELECT ps.id
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pe.headword = ?
    AND pe.primary_lang = ?
    AND ps.gloss_key = ?
  ORDER BY ps.id
  LIMIT 1
`);

const getSenseByOrder = db.prepare(`
  SELECT ps.id
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pe.headword = ?
    AND pe.primary_lang = ?
    AND ps.sense_order = ?
  ORDER BY ps.id
  LIMIT 1
`);

const getLocalization = db.prepare(`
  SELECT id
  FROM product_localizations
  WHERE product_sense_id = ?
    AND lang = ?
`);

const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = @term,
      reading = @reading,
      reading_system = @reading_system,
      pronunciation = @pronunciation,
      pronunciation_system = @pronunciation_system,
      definition = @definition,
      source = @source,
      confidence = 0.99,
      needs_review = 0
  WHERE id = @id
`);

const insertLocalization = db.prepare(`
  INSERT INTO product_localizations
    (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
  VALUES
    (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, 0.99, 0)
`);

const stats = {
  db: path.relative(process.cwd(), dbPath),
  fixes: 0,
  inserted: 0,
  updated: 0,
  missing_senses: []
};

db.transaction(() => {
  for (const fix of fixes) {
    const sense = fix.gloss_key
      ? getSense.get(fix.headword, fix.primary_lang, fix.gloss_key)
      : getSenseByOrder.get(fix.headword, fix.primary_lang, fix.sense_order);
    if (!sense) {
      stats.missing_senses.push(
        `${fix.primary_lang}:${fix.headword}:${fix.gloss_key || `sense_order:${fix.sense_order}`}`
      );
      continue;
    }

    const payload = {
      product_sense_id: sense.id,
      lang: fix.lang,
      term: fix.term,
      reading: fix.reading || null,
      reading_system: fix.reading_system || null,
      pronunciation: fix.pronunciation || null,
      pronunciation_system: fix.pronunciation_system || null,
      definition: fix.definition,
      source
    };
    const localization = getLocalization.get(sense.id, fix.lang);
    if (localization) {
      updateLocalization.run({ ...payload, id: localization.id });
      stats.updated++;
    } else {
      insertLocalization.run(payload);
      stats.inserted++;
    }
    stats.fixes++;
  }
})();

db.close();
console.log(JSON.stringify(stats, null, 2));

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    output[key] = next && !next.startsWith('--') ? next : '1';
    if (next && !next.startsWith('--')) i++;
  }
  return output;
}
