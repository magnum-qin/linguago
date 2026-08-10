import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const failures = [];

checkCompleteEntry('hello', 'en', { senses: 1, en: 'hello', zh: '你好', ja: 'こんにちは', pt: 'olá' });
checkCompleteEntry('你好', 'zh', { senses: 1, en: 'hello', zh: '你好', ja: 'こんにちは', pt: 'olá' });
checkCompleteEntry('inside', 'en', { senses: 1, en: 'inside', zh: '里面', ja: '中', pt: 'dentro' });
checkCompleteEntry('何時', 'ja', { minSenses: 3, enTerms: ['when', 'what time', 'normal times'] });
checkCompleteEntry('国際', 'ja', { minSenses: 2, enTerms: ['international', 'diplomatic relations'] });
checkCompleteEntry('ビジター', 'ja', { minSenses: 2, enTerms: ['visitor', 'visiting team'] });
checkPolyphone('中', 'zh', {
  expectedReadings: { zhong1: 3, zhong4: 2 },
  expectedEnglishTerms: ['hit; strike', 'win; be selected']
});
checkPolyphone('杆', 'zh', {
  expectedReadings: { gan1: 1, gan3: 1 },
  expectedEnglishTerms: ['pole; post; staff', 'shaft; handle; classifier']
});
checkSecretDisambiguation();

db.close();

const result = {
  ok: failures.length === 0,
  db: path.relative(process.cwd(), dbPath),
  failures
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

function checkCompleteEntry(headword, primaryLang, expectation) {
  const senses = loadSenses(headword, primaryLang);
  expect(senses.length >= (expectation.minSenses || expectation.senses || 1), `${headword}.sense_count`, {
    actual: senses.length,
    expected: expectation.minSenses || expectation.senses || 1
  });
  if (expectation.senses) {
    expect(senses.length === expectation.senses, `${headword}.exact_sense_count`, {
      actual: senses.length,
      expected: expectation.senses
    });
  }

  for (const sense of senses) {
    const langs = new Set(sense.localizations.map((row) => row.lang));
    for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
      expect(langs.has(lang), `${headword}.sense_${sense.sense_order}.has_${lang}`, sense);
    }
  }

  const first = senses[0];
  if (!first) return;
  if (expectation.en) expect(first.localizationsByLang.en?.term === expectation.en, `${headword}.en_term`, first);
  if (expectation.zh) expect(first.localizationsByLang.zh?.term === expectation.zh, `${headword}.zh_term`, first);
  if (expectation.ja) expect(first.localizationsByLang.ja?.term === expectation.ja, `${headword}.ja_term`, first);
  if (expectation.pt) expect(first.localizationsByLang['pt-BR']?.term === expectation.pt, `${headword}.pt_term`, first);

  if (expectation.enTerms) {
    const terms = senses.map((sense) => sense.localizationsByLang.en?.term).filter(Boolean);
    for (const term of expectation.enTerms) {
      expect(terms.includes(term), `${headword}.has_en_term.${term}`, { terms });
    }
  }
}

function checkPolyphone(headword, primaryLang, expectation) {
  const senses = loadSenses(headword, primaryLang);
  const byReading = new Map();
  for (const sense of senses) {
    const sourceLocalization = sense.localizationsByLang[primaryLang];
    const key = pinyinKey(sourceLocalization?.reading || sourceLocalization?.pronunciation || '');
    if (!key) continue;
    byReading.set(key, (byReading.get(key) || 0) + 1);
  }
  for (const [readingKey, expectedCount] of Object.entries(expectation.expectedReadings)) {
    expect(byReading.get(readingKey) === expectedCount, `${headword}.${readingKey}_sense_count`, {
      actual: byReading.get(readingKey) || 0,
      expected: expectedCount,
      readings: Object.fromEntries(byReading)
    });
  }
  const enTerms = senses.map((sense) => sense.localizationsByLang.en?.term).filter(Boolean);
  for (const term of expectation.expectedEnglishTerms) {
    expect(enTerms.includes(term), `${headword}.has_en_term.${term}`, { enTerms });
  }
}

function checkSecretDisambiguation() {
  const zh = loadSenses('秘密', 'zh');
  const ja = loadSenses('秘密', 'ja');
  expect(zh.length >= 2, '秘密.zh_senses', zh);
  expect(ja.length >= 2, '秘密.ja_senses', ja);
  expect(
    zh.some((sense) => sense.localizationsByLang.en?.term === 'secret'),
    '秘密.zh_secret_sense',
    zh
  );
  expect(
    ja.some((sense) => sense.localizationsByLang.en?.term === 'mystery'),
    '秘密.ja_mystery_sense',
    ja
  );
}

function loadSenses(headword, primaryLang) {
  const rows = db
    .prepare(
      `
      SELECT
        ps.id,
        ps.sense_order,
        ps.part_of_speech,
        ps.gloss_key,
        pl.lang,
        pl.term,
        pl.reading,
        pl.reading_system,
        pl.pronunciation,
        pl.pronunciation_system,
        pl.definition
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE pe.headword = ?
        AND pe.primary_lang = ?
        AND ps.status = 'accepted'
        AND pl.needs_review = 0
        AND NOT EXISTS (
          SELECT 1
          FROM product_sense_publication_blocks b
          WHERE b.product_sense_id = ps.id
        )
      ORDER BY ps.sense_order, ps.id, pl.lang
    `
    )
    .all(headword, primaryLang);

  const bySense = new Map();
  for (const row of rows) {
    if (!bySense.has(row.id)) {
      bySense.set(row.id, {
        id: row.id,
        sense_order: row.sense_order,
        part_of_speech: row.part_of_speech,
        gloss_key: row.gloss_key,
        localizations: [],
        localizationsByLang: {}
      });
    }
    const sense = bySense.get(row.id);
    const localization = {
      lang: row.lang,
      term: row.term,
      reading: row.reading,
      reading_system: row.reading_system,
      pronunciation: row.pronunciation,
      pronunciation_system: row.pronunciation_system,
      definition: row.definition
    };
    sense.localizations.push(localization);
    sense.localizationsByLang[row.lang] = localization;
  }
  return [...bySense.values()];
}

function expect(condition, code, details) {
  if (condition) return;
  failures.push({ code, details });
}

function pinyinKey(value) {
  return String(value || '')
    .trim()
    .split(/\s+/g)
    .map((syllable) => {
      let tone = '';
      const plain = syllable
        .normalize('NFD')
        .replace(/[\u0304\u0301\u030c\u0300]/gu, (mark) => {
          if (mark === '\u0304') tone ||= '1';
          if (mark === '\u0301') tone ||= '2';
          if (mark === '\u030c') tone ||= '3';
          if (mark === '\u0300') tone ||= '4';
          return '';
        })
        .normalize('NFC')
        .toLowerCase()
        .replace(/[^a-z0-9üv]/gu, '');
      if (/\d/u.test(plain)) return plain.replace('ü', 'v');
      return `${plain.replace('ü', 'v')}${tone}`;
    })
    .join(' ')
    .trim();
}

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
