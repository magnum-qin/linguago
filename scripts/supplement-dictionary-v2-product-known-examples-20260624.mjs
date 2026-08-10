import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const apply = args.apply === 'true' || args.apply === true;
const source = 'manual:known-examples-20260624';

const examples = [
  {
    sourceExampleId: -960001,
    headword: 'of',
    primaryLang: 'en',
    senseHint: 'belonging to',
    sourceLang: 'en',
    sourceText: 'The color of the sky changed.',
    localizations: {
      en: { text: 'The color of the sky changed.' },
      zh: { text: '天空的颜色变了。', reading: 'Tiankong de yanse bian le.' },
      ja: { text: '空の色が変わった。', reading: 'Sora no iro ga kawatta.' },
      'pt-BR': { text: 'A cor do céu mudou.' }
    }
  },
  {
    sourceExampleId: -960002,
    headword: 'would',
    primaryLang: 'en',
    senseHint: 'conditional',
    sourceLang: 'en',
    sourceText: 'I would help if I could.',
    localizations: {
      en: { text: 'I would help if I could.' },
      zh: { text: '如果可以，我会帮忙。', reading: 'Ruguo keyi, wo hui bangmang.' },
      ja: { text: 'できるなら手伝うでしょう。', reading: 'Dekiru nara tetsudau deshou.' },
      'pt-BR': { text: 'Eu ajudaria se pudesse.' }
    }
  },
  {
    sourceExampleId: -960003,
    headword: 'は',
    primaryLang: 'ja',
    senseHint: 'topic',
    sourceLang: 'ja',
    sourceText: '私は学生です。',
    localizations: {
      ja: { text: '私は学生です。', reading: 'Watashi wa gakusei desu.' },
      en: { text: 'I am a student.' },
      zh: { text: '我是学生。', reading: 'Wo shi xuesheng.' },
      'pt-BR': { text: 'Eu sou estudante.' }
    }
  },
  {
    sourceExampleId: -960004,
    headword: 'に',
    primaryLang: 'ja',
    senseHint: 'direction',
    sourceLang: 'ja',
    sourceText: '学校に行きます。',
    localizations: {
      ja: { text: '学校に行きます。', reading: 'Gakkou ni ikimasu.' },
      en: { text: 'I go to school.' },
      zh: { text: '我去学校。', reading: 'Wo qu xuexiao.' },
      'pt-BR': { text: 'Vou para a escola.' }
    }
  },
  {
    sourceExampleId: -960005,
    headword: 'ううん',
    primaryLang: 'ja',
    senseHint: 'no',
    sourceLang: 'ja',
    sourceText: 'ううん、今日は行かない。',
    localizations: {
      ja: { text: 'ううん、今日は行かない。', reading: 'Uun, kyou wa ikanai.' },
      en: { text: 'No, I am not going today.' },
      zh: { text: '不，今天我不去。', reading: 'Bu, jintian wo bu qu.' },
      'pt-BR': { text: 'Não, eu não vou hoje.' }
    }
  },
  {
    sourceExampleId: -960006,
    headword: 'frighten',
    primaryLang: 'en',
    senseHint: 'fear',
    sourceLang: 'en',
    sourceText: 'The sudden noise frightened the child.',
    localizations: {
      en: { text: 'The sudden noise frightened the child.' },
      zh: { text: '突然的声音吓到了孩子。', reading: 'Turan de shengyin xia dao le haizi.' },
      ja: { text: '突然の音が子どもを怖がらせた。', reading: 'Totsuzen no oto ga kodomo o kowagaraseta.' },
      'pt-BR': { text: 'O barulho repentino assustou a criança.' }
    }
  }
];

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const findSense = db.prepare(`
  SELECT s.id, s.sense_order, s.gloss_key, l.definition
  FROM product_entries e
  JOIN product_senses s ON s.product_entry_id = e.id
  LEFT JOIN product_localizations l
    ON l.product_sense_id = s.id
   AND l.lang = e.primary_lang
  WHERE e.headword = ?
    AND e.primary_lang = ?
    AND e.status = 'accepted'
    AND s.status = 'accepted'
  ORDER BY
    CASE
      WHEN lower(COALESCE(s.gloss_key, '')) LIKE '%' || lower(?) || '%' THEN 0
      WHEN lower(COALESCE(l.definition, '')) LIKE '%' || lower(?) || '%' THEN 1
      ELSE 2
    END,
    s.sense_order,
    s.id
  LIMIT 1
`);

const countExamples = db.prepare(`
  SELECT COUNT(*) AS count
  FROM product_examples
  WHERE product_sense_id = ?
    AND needs_review = 0
`);

const maxOrder = db.prepare(`
  SELECT COALESCE(MAX(example_order), 0) AS max_order
  FROM product_examples
  WHERE product_sense_id = ?
`);

const insertExample = db.prepare(`
  INSERT OR IGNORE INTO product_examples (
    product_sense_id,
    source_example_id,
    example_order,
    source_lang,
    source_text,
    source,
    confidence,
    needs_review
  )
  VALUES (?, ?, ?, ?, ?, ?, 0.95, 0)
`);

const getExampleId = db.prepare(`
  SELECT id
  FROM product_examples
  WHERE product_sense_id = ?
    AND source_example_id = ?
`);

const insertLocalization = db.prepare(`
  INSERT OR REPLACE INTO product_example_localizations (
    product_example_id,
    lang,
    text,
    reading,
    source,
    confidence,
    needs_review
  )
  VALUES (?, ?, ?, ?, ?, 0.95, 0)
`);

const stats = {
  db: dbPath,
  apply,
  candidates: examples.length,
  inserted_examples: 0,
  inserted_localizations: 0,
  skipped_existing_examples: 0,
  skipped_missing_sense: 0,
  targets: []
};

const tx = db.transaction(() => {
  for (const item of examples) {
    const sense = findSense.get(item.headword, item.primaryLang, item.senseHint, item.senseHint);
    if (!sense) {
      stats.skipped_missing_sense++;
      stats.targets.push({ headword: item.headword, primary_lang: item.primaryLang, status: 'missing_sense' });
      continue;
    }

    const existingCount = countExamples.get(sense.id).count;
    if (existingCount > 0) {
      stats.skipped_existing_examples++;
      stats.targets.push({
        headword: item.headword,
        primary_lang: item.primaryLang,
        sense_id: sense.id,
        sense_order: sense.sense_order,
        status: 'has_existing_examples',
        existing_examples: existingCount
      });
      continue;
    }

    const nextOrder = maxOrder.get(sense.id).max_order + 1;
    if (apply) {
      const result = insertExample.run(
        sense.id,
        item.sourceExampleId,
        nextOrder,
        item.sourceLang,
        item.sourceText,
        source
      );
      stats.inserted_examples += result.changes;
      const example = getExampleId.get(sense.id, item.sourceExampleId);
      if (!example) throw new Error(`Failed to resolve inserted example for ${item.headword}`);
      for (const [lang, localization] of Object.entries(item.localizations)) {
        stats.inserted_localizations += insertLocalization.run(
          example.id,
          lang,
          localization.text,
          localization.reading || null,
          source
        ).changes;
      }
    }

    stats.targets.push({
      headword: item.headword,
      primary_lang: item.primaryLang,
      sense_id: sense.id,
      sense_order: sense.sense_order,
      status: apply ? 'inserted' : 'would_insert',
      source_text: item.sourceText
    });
  }
});

tx();
console.log(JSON.stringify(stats, null, 2));
db.close();

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
