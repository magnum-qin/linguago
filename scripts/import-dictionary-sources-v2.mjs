import Database from 'better-sqlite3';
import csvParser from 'csv-parser';
import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';

const LANGUAGE_CODES = new Set(['en', 'zh', 'ja', 'pt-BR']);
const DEFAULT_DB = 'data/processed/linguago_v2_staging.db';
const WIKDICT_PAIRS = [
  ['en', 'zh'],
  ['zh', 'en'],
  ['en', 'ja'],
  ['ja', 'en'],
  ['en', 'pt'],
  ['pt', 'en'],
  ['zh', 'ja'],
  ['ja', 'zh'],
  ['zh', 'pt'],
  ['pt', 'zh'],
  ['ja', 'pt'],
  ['pt', 'ja']
];
const WIKDICT_SOURCE_KEYS = WIKDICT_PAIRS.map(([from, to]) => `wikdict-${from}-${to}`);
const DEFAULT_SOURCES = ['ecdict', 'kaikki-zh', 'cedict', 'jmdict', 'freedict-eng-por', 'freedict-por-eng'];
const KAIKKI_SOURCES = {
  'kaikki-zh': {
    sourceName: 'Kaikki English Wiktionary Chinese entries',
    sourceUrl: 'https://kaikki.org/dictionary/Chinese/',
    file: 'data/raw/kaikki_Chinese.jsonl',
    lang: 'zh'
  },
  'kaikki-ja': {
    sourceName: 'Kaikki English Wiktionary Japanese entries',
    sourceUrl: 'https://kaikki.org/dictionary/Japanese/',
    file: 'data/raw/kaikki_Japanese.jsonl',
    lang: 'ja'
  },
  'kaikki-pt': {
    sourceName: 'Kaikki English Wiktionary Portuguese entries',
    sourceUrl: 'https://kaikki.org/dictionary/Portuguese/',
    file: 'data/raw/kaikki_Portuguese.jsonl',
    lang: 'pt-BR'
  }
};

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const sourceNames = (args.sources || DEFAULT_SOURCES.join(','))
  .split(',')
  .map((source) => source.trim())
  .filter(Boolean);
const limit = args.limit ? Number(args.limit) : 0;

if (!fs.existsSync(dbPath)) {
  throw new Error(`Database not found. Run scripts/init-dictionary-v2.mjs first: ${dbPath}`);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const statements = {
  upsertSource: db.prepare(`
    INSERT INTO dictionary_sources (source_key, source_name, source_url, license, metadata_json)
    VALUES (@source_key, @source_name, @source_url, @license, @metadata_json)
    ON CONFLICT(source_key) DO UPDATE SET
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      license = excluded.license,
      metadata_json = excluded.metadata_json
  `),
  getSource: db.prepare('SELECT id FROM dictionary_sources WHERE source_key = ?'),
  insertEntry: db.prepare(`
    INSERT OR IGNORE INTO source_entries
      (source_id, source_entry_key, word, normalized_key, lang, raw_json)
    VALUES
      (@source_id, @source_entry_key, @word, @normalized_key, @lang, @raw_json)
  `),
  getEntry: db.prepare(`
    SELECT id FROM source_entries
    WHERE source_id = ? AND source_entry_key = ?
  `),
  insertSense: db.prepare(`
    INSERT OR IGNORE INTO source_senses
      (source_entry_id, source_sense_key, sense_order, part_of_speech, domain, register_label, gloss, raw_json)
    VALUES
      (@source_entry_id, @source_sense_key, @sense_order, @part_of_speech, @domain, @register_label, @gloss, @raw_json)
  `)
};

const importers = {
  ecdict: importEcDict,
  cedict: importCcCedict,
  jmdict: importJmDict,
  'omw-30': importOpenMultilingualWordnet,
  'freedict-eng-por': (options) =>
    importFreeDict({
      ...options,
      sourceKey: 'freedict-eng-por',
      sourceName: 'FreeDict English-Portuguese',
      sourceUrl: 'https://github.com/freedict/fd-dictionaries/tree/master/eng-por',
      file: 'data/raw/freedict-eng-por.tei',
      sourceLang: 'en',
      targetLang: 'pt-BR'
    }),
  'freedict-por-eng': (options) =>
    importFreeDict({
      ...options,
      sourceKey: 'freedict-por-eng',
      sourceName: 'FreeDict Portuguese-English',
      sourceUrl: 'https://github.com/freedict/fd-dictionaries/tree/master/por-eng',
      file: 'data/raw/freedict-por-eng.tei',
      sourceLang: 'pt-BR',
      targetLang: 'en'
    })
};

for (const [sourceKey, config] of Object.entries(KAIKKI_SOURCES)) {
  importers[sourceKey] = (options) => importKaikkiLanguage({ ...options, sourceKey, ...config });
}

for (const [from, to] of WIKDICT_PAIRS) {
  const sourceKey = `wikdict-${from}-${to}`;
  importers[sourceKey] = (options) =>
    importWikDict({
      ...options,
      sourceKey,
      sourceName: `WikDict ${from}-${to}`,
      sourceUrl: `https://download.wikdict.com/dictionaries/sqlite/2/${from}-${to}.sqlite3`,
      file: `data/raw/wikdict/${from}-${to}.sqlite3`,
      sourceLang: normalizeSourceLang(from),
      targetLang: normalizeSourceLang(to)
    });
}

const summary = [];
for (const sourceName of sourceNames) {
  const importer = importers[sourceName];
  if (!importer) {
    throw new Error(`Unknown source "${sourceName}". Valid sources: ${Object.keys(importers).join(', ')}`);
  }
  const started = performance.now();
  const result = await importer({ limit });
  summary.push({
    source: sourceName,
    ...result,
    ms: Math.round(performance.now() - started)
  });
}

db.close();
console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), summary }, null, 2));

async function importEcDict({ limit }) {
  const sourceId = ensureSource({
    source_key: 'ecdict',
    source_name: 'ECDICT',
    source_url: 'https://github.com/skywind3000/ECDICT',
    license: 'MIT',
    metadata_json: JSON.stringify({
      file: 'data/raw/ecdict.csv',
      license_url: 'https://github.com/skywind3000/ECDICT/blob/master/LICENSE'
    })
  });
  const file = path.resolve('data/raw/ecdict.csv');
  if (!fs.existsSync(file)) return { skipped: true, reason: 'missing data/raw/ecdict.csv' };

  let entries = 0;
  let senses = 0;
  const insertBatch = db.transaction((rows) => {
    for (const row of rows) {
      const word = cleanText(row.word);
      if (!word) continue;
      const sourceEntryKey = word;
      const raw = compactJson(row);
      insertSourceEntry({
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: normalizeKey(word),
        lang: 'en',
        raw_json: raw
      });
      const entryId = getSourceEntryId(sourceId, sourceEntryKey);
      const glosses = splitEcDictDefinitions(row.definition, row.translation);
      glosses.forEach((gloss, index) => {
        insertSourceSense({
          source_entry_id: entryId,
          source_sense_key: `${sourceEntryKey}:${index + 1}`,
          sense_order: index + 1,
          part_of_speech: cleanText(row.pos),
          gloss,
          raw_json: compactJson({
            definition: row.definition || '',
            translation: row.translation || '',
            phonetic: row.phonetic || '',
            pos: row.pos || ''
          })
        });
        senses++;
      });
      entries++;
    }
  });

  let batch = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(file)
      .pipe(csvParser())
      .on('data', (row) => {
        if (limit && entries + batch.length >= limit) return;
        batch.push(row);
        if (batch.length >= 500) {
          insertBatch(batch);
          batch = [];
        }
      })
      .on('error', reject)
      .on('end', () => {
        if (batch.length) insertBatch(batch);
        resolve();
      });
  });

  return { entries, senses };
}

async function importKaikkiLanguage({ limit, sourceKey, sourceName, sourceUrl, file: relativeFile, lang }) {
  const sourceId = ensureSource({
    source_key: sourceKey,
    source_name: sourceName,
    source_url: sourceUrl,
    license: 'CC BY-SA 4.0 and GFDL',
    metadata_json: JSON.stringify({ file: relativeFile, edition: 'enwiktionary', format: 'kaikki-postprocessed-jsonl' })
  });
  const file = path.resolve(relativeFile);
  if (!fs.existsSync(file)) return { skipped: true, reason: `missing ${relativeFile}` };

  let entries = 0;
  let senses = 0;
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const insertOne = (item) => {
    const word = cleanText(item.word);
    if (!word) return;
    const validSenses = (Array.isArray(item.senses) ? item.senses : [])
      .map((sense, index) => ({ sense, index, gloss: firstNonEmpty(sense.glosses || sense.raw_glosses || []) }))
      .filter((row) => row.gloss);
    if (validSenses.length === 0) return;
    const sourceEntryKey = item.id || `${word}:${item.pos || 'unknown'}:${entries + 1}`;
    insertSourceEntry({
      source_id: sourceId,
      source_entry_key: sourceEntryKey,
      word,
      normalized_key: normalizeKey(word),
      lang,
      raw_json: compactJson(item)
    });
    const entryId = getSourceEntryId(sourceId, sourceEntryKey);
    validSenses.forEach(({ sense, index, gloss }, senseOrder) => {
      insertSourceSense({
        source_entry_id: entryId,
        source_sense_key: sense.id || `${sourceEntryKey}:${index + 1}`,
        sense_order: senseOrder + 1,
        part_of_speech: cleanText(sense.pos || item.pos),
        domain: firstNonEmpty([...(sense.topics || []), ...(sense.categories || []).map((c) => c.name)]),
        register_label: firstNonEmpty([...(sense.tags || []), ...(sense.raw_tags || [])]),
        gloss,
        raw_json: compactJson(sense)
      });
      senses++;
    });
    entries++;
  };
  const insertBatch = db.transaction((items) => {
    for (const item of items) insertOne(item);
  });

  let batch = [];
  for await (const line of rl) {
    if (limit && entries >= limit) break;
    if (!line.trim()) continue;
    try {
      batch.push(JSON.parse(line));
      const batchTarget = limit ? Math.min(500, Math.max(1, limit - entries)) : 500;
      if (batch.length >= batchTarget) {
        insertBatch(batch);
        batch = [];
      }
    } catch {
      // Keep malformed source rows out of staging; raw source is still available on disk.
    }
  }
  if (batch.length && (!limit || entries < limit)) insertBatch(batch);

  rl.close();
  stream.destroy();
  return { entries, senses };
}

async function importCcCedict({ limit }) {
  const legacy = db.prepare(`
    SELECT e.id FROM source_entries e
    JOIN dictionary_sources s ON s.id = e.source_id
    WHERE s.source_key = 'cc-cedict'
      AND e.source_entry_key NOT LIKE 'cedict-v2:%'
    LIMIT 1
  `).get();
  if (legacy) {
    throw new Error('Legacy CC-CEDICT identities omit readings; import into a fresh staging DB, not over existing source links');
  }
  const sourceId = ensureSource({
    source_key: 'cc-cedict',
    source_name: 'CC-CEDICT',
    source_url: 'https://cc-cedict.org/wiki/',
    license: 'CC BY-SA 4.0',
    metadata_json: JSON.stringify({ file: 'data/raw/CC-CEDICT.txt.gz' })
  });
  const file = path.resolve('data/raw/CC-CEDICT.txt.gz');
  if (!fs.existsSync(file)) return { skipped: true, reason: 'missing data/raw/CC-CEDICT.txt.gz' };

  let entries = 0;
  let senses = 0;
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity
  });
  const insertOne = db.transaction((parsed) => {
    // Homographs with different readings must not collide under INSERT OR IGNORE.
    const sourceEntryKey = `cedict-v2:${JSON.stringify([
      parsed.traditional, parsed.simplified, parsed.pinyin.trim().replace(/\s+/gu, ' ')
    ])}`;
    insertSourceEntry({
      source_id: sourceId,
      source_entry_key: sourceEntryKey,
      word: parsed.simplified,
      normalized_key: normalizeKey(parsed.simplified),
      lang: 'zh',
      raw_json: compactJson(parsed)
    });
    const entryId = getSourceEntryId(sourceId, sourceEntryKey);
    parsed.definitions.forEach((definition, index) => {
      insertSourceSense({
        source_entry_id: entryId,
        source_sense_key: `${sourceEntryKey}:${index + 1}`,
        sense_order: index + 1,
        part_of_speech: null,
        gloss: definition,
        raw_json: compactJson({ definition, pinyin: parsed.pinyin })
      });
      senses++;
    });
    entries++;
  });

  for await (const line of rl) {
    if (limit && entries >= limit) break;
    const parsed = parseCedictLine(line);
    if (parsed) insertOne(parsed);
  }
  rl.close();
  return { entries, senses };
}

async function importJmDict({ limit }) {
  const sourceId = ensureSource({
    source_key: 'jmdict',
    source_name: 'JMdict English',
    source_url: 'https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project',
    license: 'CC BY-SA 4.0',
    metadata_json: JSON.stringify({ file: 'data/raw/JMdict_e.gz' })
  });
  const file = path.resolve('data/raw/JMdict_e.gz');
  if (!fs.existsSync(file)) return { skipped: true, reason: 'missing data/raw/JMdict_e.gz' };

  const xml = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: true
  });
  const parsed = parser.parse(xml);
  const sourceEntries = asArray(parsed?.JMdict?.entry);
  let entries = 0;
  let senses = 0;
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      if (limit && entries >= limit) break;
      const word = cleanText(
        firstText(asArray(item.k_ele).map((k) => k.keb)) || firstText(asArray(item.r_ele).map((r) => r.reb))
      );
      if (!word) continue;
      const sourceEntryKey = String(item.ent_seq || word);
      insertSourceEntry({
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: normalizeKey(word),
        lang: 'ja',
        raw_json: compactJson(item)
      });
      const entryId = getSourceEntryId(sourceId, sourceEntryKey);
      asArray(item.sense).forEach((sense, index) => {
        insertSourceSense({
          source_entry_id: entryId,
          source_sense_key: `${sourceEntryKey}:${index + 1}`,
          sense_order: index + 1,
          part_of_speech: firstText(asArray(sense.pos)),
          gloss: firstText(asArray(sense.gloss).map((gloss) => (typeof gloss === 'string' ? gloss : gloss?.['#text']))),
          raw_json: compactJson(sense)
        });
        senses++;
      });
      entries++;
    }
  });
  insertMany(sourceEntries);
  return { entries, senses };
}

async function importFreeDict({ limit, sourceKey, sourceName, sourceUrl, file, sourceLang, targetLang }) {
  const sourceId = ensureSource({
    source_key: sourceKey,
    source_name: sourceName,
    source_url: sourceUrl,
    license: 'FreeDict project license; verify dictionary metadata before redistribution',
    metadata_json: JSON.stringify({ file, target_lang: targetLang })
  });
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) return { skipped: true, reason: `missing ${file}` };

  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    processEntities: false,
    trimValues: true
  });
  const parsed = parser.parse(xml);
  const entriesRaw = collectTeiNodes(parsed, 'entry').filter((entry) => firstText(collectTeiText(entry, 'orth')));

  let entries = 0;
  let senses = 0;
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      if (limit && entries >= limit) break;
      const word = firstText(collectTeiText(item, 'orth'));
      if (!word) continue;

      const sourceEntryKey = getXmlId(item) || `${sourceKey}:${entries + 1}:${word}`;
      insertSourceEntry({
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: normalizeKey(word),
        lang: sourceLang,
        raw_json: compactJson(pruneFreeDictEntry(item))
      });
      const entryId = getSourceEntryId(sourceId, sourceEntryKey);

      const parsedSenses = extractFreeDictSenses(item, targetLang);
      parsedSenses.forEach((sense, index) => {
        insertSourceSense({
          source_entry_id: entryId,
          source_sense_key: `${sourceEntryKey}:${index + 1}`,
          sense_order: index + 1,
          part_of_speech: sense.part_of_speech,
          gloss: sense.gloss,
          raw_json: compactJson(sense.raw)
        });
        senses++;
      });
      entries++;
    }
  });

  insertMany(entriesRaw);
  return { entries, senses, target_lang: targetLang };
}

async function importWikDict({ limit, sourceKey, sourceName, sourceUrl, file, sourceLang, targetLang }) {
  const sourceId = ensureSource({
    source_key: sourceKey,
    source_name: sourceName,
    source_url: sourceUrl,
    license: 'Wiktionary-derived; see WikDict upstream metadata',
    metadata_json: compactJson({
      type: 'wikdict-sqlite',
      file,
      source_lang: sourceLang,
      target_lang: targetLang,
      role: 'translation-evidence'
    })
  });

  const sourcePath = path.resolve(file);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing WikDict sqlite file for ${sourceKey}: ${sourcePath}`);
  }

  const sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const rows = sourceDb
    .prepare(
      `
        SELECT
          rowid,
          lexentry,
          sense_num,
          sense,
          written_rep,
          trans_list,
          score,
          is_good,
          importance
        FROM translation
        WHERE COALESCE(written_rep, '') <> ''
          AND COALESCE(trans_list, '') <> ''
        ORDER BY written_rep, rowid
        ${limit ? 'LIMIT @limit' : ''}
      `
    )
    .all(limit ? { limit } : {});

  const senseOrderByEntry = new Map();
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insertSourceEntry(item.entry);
      const sourceEntryId = getSourceEntryId(sourceId, item.entry.source_entry_key);
      insertSourceSense({
        source_entry_id: sourceEntryId,
        source_sense_key: item.sense.source_sense_key,
        sense_order: item.sense.sense_order,
        part_of_speech: item.sense.part_of_speech,
        gloss: item.sense.gloss,
        raw_json: item.sense.raw_json
      });
    }
  });

  const items = [];
  let skipped = 0;
  for (const row of rows) {
    const word = cleanWikDictText(row.written_rep);
    const translations = splitWikDictTranslations(row.trans_list)
      .map(cleanWikDictText)
      .filter((translation) => isUsefulWikDictText(translation, targetLang))
      .slice(0, 12);

    if (!isUsefulWikDictText(word, sourceLang) || !translations.length) {
      skipped++;
      continue;
    }

    const sourceEntryKey = normalizeKey(word);
    const senseOrder = (senseOrderByEntry.get(sourceEntryKey) || 0) + 1;
    senseOrderByEntry.set(sourceEntryKey, senseOrder);
    const translationGloss = translations.join('; ');
    const raw = {
      target_lang: targetLang,
      translations,
      wikdict: {
        rowid: row.rowid,
        lexentry: row.lexentry,
        sense_num: row.sense_num,
        sense: cleanWikDictText(row.sense),
        score: row.score,
        is_good: row.is_good,
        importance: row.importance
      }
    };

    items.push({
      entry: {
        source_id: sourceId,
        source_entry_key: sourceEntryKey,
        word,
        normalized_key: sourceEntryKey,
        lang: sourceLang,
        raw_json: compactJson({
          word,
          target_lang: targetLang,
          source_file: path.basename(file)
        })
      },
      sense: {
        source_sense_key: `${sourceEntryKey}:${senseOrder}:${hashText(translationGloss)}`,
        sense_order: senseOrder,
        part_of_speech: null,
        gloss: translationGloss,
        raw_json: compactJson(raw)
      }
    });
  }

  insertMany(items);
  sourceDb.close();
  return {
    entries: new Set(items.map((item) => item.entry.source_entry_key)).size,
    senses: items.length,
    skipped,
    target_lang: targetLang
  };
}

async function importOpenMultilingualWordnet({ limit }) {
  const sourceKey = 'omw-30';
  const sourceId = ensureSource({
    source_key: sourceKey,
    source_name: 'Open Multilingual Wordnet 1.x / PWN 3.0 aligned',
    source_url: 'https://github.com/omwn/omw-data',
    license: 'mixed open WordNet licenses; see OMW source metadata',
    metadata_json: compactJson({
      type: 'omw-tab',
      role: 'concept-aligned-multilingual-evidence',
      files: {
        en: 'data/raw/omw/wn-data-eng.tab',
        zh: 'data/raw/omw/wn-data-cmn.tab',
        ja: 'data/raw/omw/wn-data-jpn.tab',
        'pt-BR': 'data/raw/omw/wn-data-por.tab'
      }
    })
  });

  const files = [
    { lang: 'en', file: 'data/raw/omw/wn-data-eng.tab' },
    { lang: 'zh', file: 'data/raw/omw/wn-data-cmn.tab' },
    { lang: 'ja', file: 'data/raw/omw/wn-data-jpn.tab' },
    { lang: 'pt-BR', file: 'data/raw/omw/wn-data-por.tab' }
  ];
  const synsets = new Map();
  let skipped = 0;

  for (const { lang, file } of files) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) throw new Error(`Missing OMW tab file: ${filePath}`);
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
    for (const line of lines) {
      if (!line || line.startsWith('#')) continue;
      const parts = line.split('\t');
      if (parts.length < 3) {
        skipped++;
        continue;
      }
      const synset = cleanText(parts[0]);
      const valueType = cleanText(parts[1]);
      const lemma = cleanOwmLemma(parts.slice(2).join('\t'), lang);
      if (!synset || !valueType.endsWith('lemma') || !isUsefulWikDictText(lemma, lang)) {
        skipped++;
        continue;
      }
      const bucket = synsets.get(synset) || { synset, pos: synset.split('-').pop(), localizations: new Map() };
      const terms = bucket.localizations.get(lang) || [];
      if (!terms.includes(lemma) && terms.length < 8) terms.push(lemma);
      bucket.localizations.set(lang, terms);
      synsets.set(synset, bucket);
    }
  }

  const sourceSenseOrder = new Map();
  const items = [];
  for (const concept of synsets.values()) {
    const langs = [...concept.localizations.keys()];
    if (langs.length < 2) continue;
    const localizations = Object.fromEntries(
      [...concept.localizations.entries()].map(([lang, terms]) => [lang, terms])
    );
    for (const [lang, terms] of concept.localizations.entries()) {
      for (const term of terms.slice(0, 4)) {
        const entryKey = `${lang}:${normalizeKey(term)}`;
        const senseOrder = (sourceSenseOrder.get(entryKey) || 0) + 1;
        sourceSenseOrder.set(entryKey, senseOrder);
        const gloss = buildOwmGloss(localizations, lang);
        items.push({
          entry: {
            source_id: sourceId,
            source_entry_key: entryKey,
            word: term,
            normalized_key: normalizeKey(term),
            lang,
            raw_json: compactJson({
              term,
              lang,
              synset_counted_source: 'omw'
            })
          },
          sense: {
            source_sense_key: `${entryKey}:${concept.synset}`,
            sense_order: senseOrder,
            part_of_speech: omwPartOfSpeech(concept.pos),
            gloss,
            raw_json: compactJson({
              synset: concept.synset,
              localizations,
              concept_langs: Object.keys(localizations)
            })
          }
        });
        if (limit && items.length >= limit) break;
      }
      if (limit && items.length >= limit) break;
    }
    if (limit && items.length >= limit) break;
  }

  const insertMany = db.transaction((batch) => {
    for (const item of batch) {
      insertSourceEntry(item.entry);
      const sourceEntryId = getSourceEntryId(sourceId, item.entry.source_entry_key);
      insertSourceSense({
        source_entry_id: sourceEntryId,
        source_sense_key: item.sense.source_sense_key,
        sense_order: item.sense.sense_order,
        part_of_speech: item.sense.part_of_speech,
        gloss: item.sense.gloss,
        raw_json: item.sense.raw_json
      });
    }
  });

  insertMany(items);
  return {
    entries: new Set(items.map((item) => item.entry.source_entry_key)).size,
    senses: items.length,
    concepts: synsets.size,
    skipped
  };
}

function ensureSource(source) {
  statements.upsertSource.run(source);
  return statements.getSource.get(source.source_key).id;
}

function insertSourceEntry(entry) {
  if (!LANGUAGE_CODES.has(entry.lang)) throw new Error(`Invalid source entry lang: ${entry.lang}`);
  statements.insertEntry.run(entry);
}

function getSourceEntryId(sourceId, sourceEntryKey) {
  return statements.getEntry.get(sourceId, sourceEntryKey).id;
}

function insertSourceSense(sense) {
  statements.insertSense.run({
    part_of_speech: null,
    domain: null,
    register_label: null,
    ...sense,
    gloss: cleanText(sense.gloss) || '',
    raw_json: sense.raw_json || '{}'
  });
}

function splitEcDictDefinitions(definition, translation) {
  const source = cleanText(definition) || cleanText(translation) || '';
  if (!source) return ['missing definition'];
  return source.split(/\n+/u).map(cleanText).filter(Boolean).slice(0, 12);
}

function parseCedictLine(line) {
  if (!line || line.startsWith('#')) return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/u);
  if (!match) return null;
  const definitions = match[4].split('/').map(cleanText).filter(Boolean);
  if (!definitions.length) return null;
  return {
    traditional: match[1],
    simplified: match[2],
    pinyin: match[3],
    definitions
  };
}

function normalizeKey(value) {
  return cleanText(value).normalize('NFKC').toLocaleLowerCase();
}

function normalizeSourceLang(lang) {
  if (lang === 'pt') return 'pt-BR';
  if (!LANGUAGE_CODES.has(lang)) throw new Error(`Unsupported source lang: ${lang}`);
  return lang;
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function cleanWikDictText(value) {
  return cleanText(value)
    .replace(/^['"]+|['"]+$/gu, '')
    .replace(/^\(([^)]+)\)$/u, '$1')
    .trim();
}

function splitWikDictTranslations(value) {
  return cleanText(value)
    .split(/[;,]\s*|\s*\|\s*/u)
    .map(cleanWikDictText)
    .filter(Boolean);
}

function isUsefulWikDictText(value, lang) {
  const text = cleanWikDictText(value);
  if (!text) return false;
  if (/^[-'’]/u.test(text)) return false;
  if (/&[#A-Za-z0-9]+;/u.test(text)) return false;
  if (/[<>]/u.test(text)) return false;
  if (/^[\p{P}\p{S}\s]+$/u.test(text)) return false;
  if ((lang === 'en' || lang === 'pt-BR') && !/[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(text)) return false;
  if (lang === 'zh' && !/[\u3400-\u9fff]/u.test(text)) return false;
  if (lang === 'ja' && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) return false;
  return true;
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildOwmGloss(localizations, sourceLang) {
  return Object.entries(localizations)
    .filter(([lang]) => lang !== sourceLang)
    .map(([lang, terms]) => `${lang}: ${asArray(terms).slice(0, 4).join('; ')}`)
    .join(' | ');
}

function cleanOwmLemma(value, lang) {
  const text = cleanText(value).replace(/_/gu, ' ');
  if (lang === 'zh' || lang === 'ja') return text.replace(/\+/gu, '');
  return text.replace(/\+/gu, ' ');
}

function omwPartOfSpeech(pos) {
  if (pos === 'n') return 'noun';
  if (pos === 'v') return 'verb';
  if (pos === 'a' || pos === 's') return 'adjective';
  if (pos === 'r') return 'adverb';
  return null;
}

function compactJson(value) {
  return JSON.stringify(value ?? {});
}

function firstNonEmpty(values) {
  return firstText(values);
}

function firstText(values) {
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function extractFreeDictSenses(entry, targetLang) {
  const senseNodes = collectDirectTeiNodes(entry, 'sense');
  const sourceNodes = senseNodes.length ? senseNodes : [entry];
  const senses = sourceNodes
    .map((sense) => {
      const definitions = collectTeiText(sense, 'def');
      const translations = extractFreeDictTranslations(sense);
      const gloss = firstText([...translations, ...definitions]);
      return {
        part_of_speech: firstText(collectTeiText(sense, 'pos')) || firstText(collectTeiText(entry, 'pos')),
        gloss,
        raw: {
          target_lang: targetLang,
          translations,
          definitions,
          xml_id: getXmlId(sense)
        }
      };
    })
    .filter((sense) => sense.gloss);

  return senses.length
    ? senses
    : [
        {
          part_of_speech: firstText(collectTeiText(entry, 'pos')),
          gloss: firstText(extractFreeDictTranslations(entry)) || 'missing definition',
          raw: {
            target_lang: targetLang,
            translations: extractFreeDictTranslations(entry),
            definitions: collectTeiText(entry, 'def'),
            xml_id: getXmlId(entry)
          }
        }
      ];
}

function extractFreeDictTranslations(node) {
  const translations = [];
  for (const cit of collectTeiNodes(node, 'cit')) {
    const type = String(cit?.['@_type'] || cit?.type || '').toLocaleLowerCase();
    if (type && !['trans', 'translation'].includes(type)) continue;
    translations.push(...collectTeiText(cit, 'quote'));
    translations.push(...collectTeiText(cit, 'q'));
  }
  translations.push(...collectTeiText(node, 'trans'));
  return uniqueStrings(translations);
}

function collectTeiNodes(node, tagName) {
  const results = [];
  visitTei(node, (key, value) => {
    if (localName(key) === tagName) {
      for (const item of asArray(value)) {
        if (item && typeof item === 'object') results.push(item);
      }
    }
  });
  return results;
}

function collectDirectTeiNodes(node, tagName) {
  const results = [];
  if (!node || typeof node !== 'object') return results;
  for (const [key, value] of Object.entries(node)) {
    if (localName(key) !== tagName) continue;
    for (const item of asArray(value)) {
      if (item && typeof item === 'object') results.push(item);
    }
  }
  return results;
}

function collectTeiText(node, tagName) {
  const results = [];
  visitTei(node, (key, value) => {
    if (localName(key) !== tagName) return;
    for (const item of asArray(value)) {
      const text = textContent(item);
      if (text) results.push(text);
    }
  });
  return uniqueStrings(results);
}

function visitTei(node, visitor) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    visitor(key, value);
    for (const item of asArray(value)) {
      if (item && typeof item === 'object') visitTei(item, visitor);
    }
  }
}

function textContent(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return cleanText(value);
  if (Array.isArray(value)) return cleanText(value.map(textContent).filter(Boolean).join('; '));
  if (typeof value !== 'object') return '';
  if (value['#text']) return cleanText(value['#text']);
  return cleanText(
    Object.entries(value)
      .filter(([key]) => !key.startsWith('@_'))
      .map(([, child]) => textContent(child))
      .filter(Boolean)
      .join('; ')
  );
}

function getXmlId(node) {
  return cleanText(node?.['@_xml:id'] || node?.['@_id'] || node?.['@_n']);
}

function localName(key) {
  return String(key || '').replace(/^.*:/u, '');
}

function uniqueStrings(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function pruneFreeDictEntry(entry) {
  return {
    xml_id: getXmlId(entry),
    orth: collectTeiText(entry, 'orth').slice(0, 6),
    pos: firstText(collectTeiText(entry, 'pos')),
    translations: extractFreeDictTranslations(entry).slice(0, 12)
  };
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      result[arg.slice(2)] = argv[++i];
    }
  }
  return result;
}
