import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const now = new Date().toISOString();
const source = 'manual-polyphone-supplement-20260619';

const supplements = [
  {
    headword: '中',
    normalized_key: '中',
    primary_lang: 'zh',
    frequency_rank: 781,
    group_key: 'manual:zh:中:zhong4',
    senses: [
      {
        part_of_speech: 'verb',
        gloss_key: 'hit; strike a target',
        confidence: 0.98,
        localizations: {
          zh: {
            term: '中',
            reading: 'zhòng',
            reading_system: 'pinyin',
            definition: '击中；命中目标。'
          },
          en: {
            term: 'hit; strike',
            pronunciation: '/hɪt/',
            pronunciation_system: 'IPA',
            definition: 'To reach or strike a target accurately.'
          },
          'pt-BR': {
            term: 'acertar',
            pronunciation: '/a.seʁˈtaʁ/',
            pronunciation_system: 'IPA',
            definition: 'Atingir corretamente um alvo.'
          },
          ja: {
            term: '当たる; 命中する',
            reading: 'あたる; めいちゅうする',
            reading_system: 'kana',
            definition: '目標に当たる。'
          }
        },
        example: {
          source_lang: 'zh',
          source_text: '他一箭中了靶心。',
          localizations: {
            zh: { text: '他一箭中了靶心。', reading: 'Tā yī jiàn zhòng le bǎxīn.' },
            en: { text: 'He hit the bullseye with one arrow.' },
            'pt-BR': { text: 'Ele acertou o centro do alvo com uma flecha.' },
            ja: { text: '彼は一本の矢で的の中心に当てた。', reading: 'かれはいっぽんのやでまとのちゅうしんにあてた。' }
          }
        }
      },
      {
        part_of_speech: 'verb',
        gloss_key: 'win; be selected',
        confidence: 0.98,
        localizations: {
          zh: {
            term: '中',
            reading: 'zhòng',
            reading_system: 'pinyin',
            definition: '被选中；中奖；考中。'
          },
          en: {
            term: 'win; be selected',
            pronunciation: '/wɪn/',
            pronunciation_system: 'IPA',
            definition: 'To be chosen, pass an exam, or win a prize.'
          },
          'pt-BR': {
            term: 'ganhar; ser selecionado',
            pronunciation: '/ɡaˈɲaʁ/; /seʁ se.le.si.oˈna.du/',
            pronunciation_system: 'IPA',
            definition: 'Ser escolhido, aprovado ou ganhar um prêmio.'
          },
          ja: {
            term: '当選する; 合格する',
            reading: 'とうせんする; ごうかくする',
            reading_system: 'kana',
            definition: '選ばれる、または試験に受かる。'
          }
        },
        example: {
          source_lang: 'zh',
          source_text: '她中了彩票。',
          localizations: {
            zh: { text: '她中了彩票。', reading: 'Tā zhòng le cǎipiào.' },
            en: { text: 'She won the lottery.' },
            'pt-BR': { text: 'Ela ganhou na loteria.' },
            ja: { text: '彼女は宝くじに当たった。', reading: 'かのじょはたからくじにあたった。' }
          }
        }
      }
    ]
  }
];

const statements = {
  getEntry: db.prepare('SELECT id FROM product_entries WHERE group_key = ?'),
  insertEntry: db.prepare(`
    INSERT INTO product_entries
      (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count, created_at)
    VALUES
      (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, 'manual_polyphone', 'accepted', 0, 4, @created_at)
  `),
  getSense: db.prepare('SELECT id FROM product_senses WHERE product_entry_id = ? AND gloss_key = ?'),
  nextSenseOrder: db.prepare(
    'SELECT COALESCE(MAX(sense_order), 0) + 1 AS next_order FROM product_senses WHERE product_entry_id = ?'
  ),
  insertSense: db.prepare(`
    INSERT INTO product_senses
      (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence, created_at)
    VALUES
      (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, 'accepted', @confidence, @created_at)
  `),
  upsertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, @confidence, 0)
    ON CONFLICT(product_sense_id, lang) DO UPDATE SET
      term = excluded.term,
      reading = excluded.reading,
      reading_system = excluded.reading_system,
      pronunciation = excluded.pronunciation,
      pronunciation_system = excluded.pronunciation_system,
      definition = excluded.definition,
      source = excluded.source,
      confidence = excluded.confidence,
      needs_review = 0
  `),
  getExample: db.prepare('SELECT id FROM product_examples WHERE product_sense_id = ? AND source = ?'),
  insertExample: db.prepare(`
    INSERT INTO product_examples
      (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @source_example_id, 1, @source_lang, @source_text, @source, @confidence, 0)
  `),
  upsertExampleLocalization: db.prepare(`
    INSERT INTO product_example_localizations
      (product_example_id, lang, text, reading, source, confidence, needs_review)
    VALUES
      (@product_example_id, @lang, @text, @reading, @source, @confidence, 0)
    ON CONFLICT(product_example_id, lang) DO UPDATE SET
      text = excluded.text,
      reading = excluded.reading,
      source = excluded.source,
      confidence = excluded.confidence,
      needs_review = 0
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  entries_inserted: 0,
  entries_reused: 0,
  senses_inserted: 0,
  senses_reused: 0,
  localizations_upserted: 0,
  examples_inserted: 0,
  examples_reused: 0,
  example_localizations_upserted: 0
};

db.transaction(() => {
  for (const entry of supplements) {
    let entryId = statements.getEntry.get(entry.group_key)?.id;
    if (entryId) {
      stats.entries_reused++;
    } else {
      const result = statements.insertEntry.run({ ...entry, created_at: now });
      entryId = Number(result.lastInsertRowid);
      stats.entries_inserted++;
    }

    for (const sense of entry.senses) {
      let senseId = statements.getSense.get(entryId, sense.gloss_key)?.id;
      if (senseId) {
        stats.senses_reused++;
      } else {
        const senseOrder = statements.nextSenseOrder.get(entryId).next_order;
        const result = statements.insertSense.run({
          product_entry_id: entryId,
          sense_order: senseOrder,
          part_of_speech: sense.part_of_speech,
          gloss_key: sense.gloss_key,
          confidence: sense.confidence,
          created_at: now
        });
        senseId = Number(result.lastInsertRowid);
        stats.senses_inserted++;
      }

      for (const [lang, localization] of Object.entries(sense.localizations)) {
        statements.upsertLocalization.run({
          product_sense_id: senseId,
          lang,
          term: localization.term,
          reading: localization.reading || null,
          reading_system: localization.reading_system || null,
          pronunciation: localization.pronunciation || null,
          pronunciation_system: localization.pronunciation_system || null,
          definition: localization.definition,
          source,
          confidence: sense.confidence
        });
        stats.localizations_upserted++;
      }

      const exampleSource = `${source}:${entry.primary_lang}:${entry.headword}:${sense.gloss_key}`;
      let exampleId = statements.getExample.get(senseId, exampleSource)?.id;
      if (exampleId) {
        stats.examples_reused++;
      } else {
        const result = statements.insertExample.run({
          product_sense_id: senseId,
          source_example_id: -senseId,
          source_lang: sense.example.source_lang,
          source_text: sense.example.source_text,
          source: exampleSource,
          confidence: sense.confidence
        });
        exampleId = Number(result.lastInsertRowid);
        stats.examples_inserted++;
      }

      for (const [lang, localization] of Object.entries(sense.example.localizations)) {
        statements.upsertExampleLocalization.run({
          product_example_id: exampleId,
          lang,
          text: localization.text,
          reading: localization.reading || null,
          source,
          confidence: sense.confidence
        });
        stats.example_localizations_upserted++;
      }
    }
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
