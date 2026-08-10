import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SOURCE_DB = 'data/processed/linguago_v2_full.db';
const DEFAULT_OUT_DB = 'data/processed/linguago_v2_product_top5000_pilot.db';
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];
const RISKY_FREEDICT_SHORT_GLOSSES = new Set([
  'a',
  'an',
  'the',
  'of',
  'at',
  'by',
  'as',
  'if',
  'in',
  'on',
  'or',
  'to',
  'no',
  'it',
  'us',
  'he',
  'we',
  'my',
  'her',
  'his',
  'its'
]);

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args.db || DEFAULT_SOURCE_DB);
const outDbPath = path.resolve(args.out || DEFAULT_OUT_DB);
const maxRank = Number(args['max-rank'] || 5000);
const maxSensesPerSourceEntry = Number(args['max-senses-per-entry'] || 3);
const minGroupLinks = Number(args['min-group-links'] || 1);
const reset = args.reset !== 'false';

if (!fs.existsSync(sourceDbPath)) {
  throw new Error(`Source database not found: ${sourceDbPath}`);
}

fs.mkdirSync(path.dirname(outDbPath), { recursive: true });
if (reset && fs.existsSync(outDbPath)) fs.rmSync(outDbPath);

const sourceDb = new Database(sourceDbPath, { readonly: true });
const outDb = new Database(outDbPath);
outDb.pragma('foreign_keys = ON');
outDb.pragma('journal_mode = WAL');

createSchema(outDb);

const sourceRows = sourceDb
  .prepare(
    `
    SELECT
      e.id AS source_entry_id,
      e.word,
      e.normalized_key,
      e.source_lang,
      e.frequency_rank,
      s.id AS source_sense_id,
      s.sense_order,
      s.part_of_speech,
      s.domain,
      s.register_label,
      s.gloss_key,
      s.source,
      s.confidence,
      s.needs_review
    FROM entries e
    JOIN senses s ON s.entry_id = e.id
    WHERE e.frequency_rank IS NOT NULL
      AND e.frequency_rank <= @maxRank
      AND e.status <> 'deprecated'
      AND s.sense_order <= @maxSensesPerSourceEntry
    ORDER BY e.frequency_rank, e.id, s.sense_order
  `
  )
  .all({ maxRank, maxSensesPerSourceEntry });

const localizationsBySense = loadLocalizations(
  sourceDb,
  sourceRows.map((row) => row.source_sense_id)
);
const examplesBySense = loadExamples(
  sourceDb,
  sourceRows.map((row) => row.source_sense_id)
);
const topEnglishEntries = new Set(
  sourceDb
    .prepare(
      `
      SELECT normalized_key
      FROM entries
      WHERE source_lang = 'en'
        AND frequency_rank IS NOT NULL
        AND frequency_rank <= @maxRank
    `
    )
    .all({ maxRank })
    .map((row) => row.normalized_key)
);

const groups = new Map();
const stats = {
  source_db: path.relative(process.cwd(), sourceDbPath),
  out_db: path.relative(process.cwd(), outDbPath),
  max_rank: maxRank,
  max_senses_per_source_entry: maxSensesPerSourceEntry,
  source_senses_scanned: sourceRows.length,
  skipped_profile: 0,
  skipped_risky_freedict: 0,
  skipped_no_group_key: 0,
  grouped_source_senses: 0,
  product_entries: 0,
  product_senses: 0,
  product_localizations: 0,
  source_links: 0,
  example_links: 0
};

for (const row of sourceRows) {
  if (!matchesProductProfile(row)) {
    stats.skipped_profile++;
    continue;
  }
  if (isRiskyFreeDictRow(row)) {
    stats.skipped_risky_freedict++;
    continue;
  }
  const group = buildGroupKey(row, topEnglishEntries);
  if (!group) {
    stats.skipped_no_group_key++;
    continue;
  }
  if (!groups.has(group.key)) {
    groups.set(group.key, {
      ...group,
      rows: [],
      bestRank: row.frequency_rank,
      languages: new Set()
    });
  }
  const target = groups.get(group.key);
  target.rows.push(row);
  target.bestRank = Math.min(target.bestRank, row.frequency_rank);
  target.languages.add(row.source_lang);
  stats.grouped_source_senses++;
}

const insertProductEntry = outDb.prepare(`
  INSERT INTO product_entries
    (headword, normalized_key, primary_lang, frequency_rank, group_key, group_method, status, source_count, lang_count)
  VALUES
    (@headword, @normalized_key, @primary_lang, @frequency_rank, @group_key, @group_method, @status, @source_count, @lang_count)
`);
const insertProductSense = outDb.prepare(`
  INSERT INTO product_senses
    (product_entry_id, sense_order, part_of_speech, gloss_key, status, confidence)
  VALUES
    (@product_entry_id, @sense_order, @part_of_speech, @gloss_key, @status, @confidence)
`);
const insertLink = outDb.prepare(`
  INSERT INTO product_sense_source_links
    (product_sense_id, source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence)
  VALUES
    (@product_sense_id, @source_entry_id, @source_sense_id, @source_lang, @source_word, @source_frequency_rank, @match_method, @confidence)
`);
const insertLocalization = outDb.prepare(`
  INSERT OR IGNORE INTO product_localizations
    (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
  VALUES
    (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, @confidence, @needs_review)
`);
const insertExample = outDb.prepare(`
  INSERT OR IGNORE INTO product_examples
    (product_sense_id, source_example_id, example_order, source_lang, source_text, source, confidence, needs_review)
  VALUES
    (@product_sense_id, @source_example_id, @example_order, @source_lang, @source_text, @source, @confidence, @needs_review)
`);
const insertExampleLocalization = outDb.prepare(`
  INSERT OR IGNORE INTO product_example_localizations
    (product_example_id, lang, text, reading, source, confidence, needs_review)
  VALUES
    (@product_example_id, @lang, @text, @reading, @source, @confidence, @needs_review)
`);
const findExample = outDb.prepare(`
  SELECT id FROM product_examples WHERE product_sense_id = ? AND source_example_id = ?
`);

const writeGroups = outDb.transaction((orderedGroups) => {
  for (const group of orderedGroups) {
    if (group.rows.length < minGroupLinks) continue;
    const representative = chooseRepresentative(group.rows);
    const entryInfo = productEntryInfo(group, representative);
    const entryResult = insertProductEntry.run(entryInfo);
    const productEntryId = Number(entryResult.lastInsertRowid);
    stats.product_entries++;

    const productSenseResult = insertProductSense.run({
      product_entry_id: productEntryId,
      sense_order: 1,
      part_of_speech: representative.part_of_speech,
      gloss_key: group.displayGloss || representative.gloss_key,
      status: group.languages.size >= 2 ? 'draft_fused' : 'draft_single_source',
      confidence: group.languages.size >= 2 ? 0.82 : 0.62
    });
    const productSenseId = Number(productSenseResult.lastInsertRowid);
    stats.product_senses++;

    const sortedRows = [...group.rows].sort(compareEvidenceRows);
    for (const row of sortedRows) {
      insertLink.run({
        product_sense_id: productSenseId,
        source_entry_id: row.source_entry_id,
        source_sense_id: row.source_sense_id,
        source_lang: row.source_lang,
        source_word: row.word,
        source_frequency_rank: row.frequency_rank,
        match_method: group.method,
        confidence: group.languages.size >= 2 ? 0.82 : 0.62
      });
      stats.source_links++;
    }

    const bestLocalizations = chooseBestLocalizations(sortedRows);
    for (const lang of LANGS) {
      const localization = bestLocalizations.get(lang);
      if (!localization) continue;
      insertLocalization.run({
        product_sense_id: productSenseId,
        lang,
        term: localization.term,
        reading: localization.reading,
        reading_system: localization.reading_system,
        pronunciation: localization.pronunciation,
        pronunciation_system: localization.pronunciation_system,
        definition: localization.definition,
        source: localization.source,
        confidence: localization.confidence,
        needs_review: localization.needs_review
      });
      stats.product_localizations++;
    }

    for (const row of sortedRows.slice(0, 8)) {
      const examples = examplesBySense.get(row.source_sense_id) || [];
      for (const example of examples.slice(0, 2)) {
        insertExample.run({
          product_sense_id: productSenseId,
          source_example_id: example.id,
          example_order: example.example_order,
          source_lang: example.source_lang,
          source_text: example.source_text,
          source: example.source,
          confidence: example.confidence,
          needs_review: example.needs_review
        });
        const productExample = findExample.get(productSenseId, example.id);
        if (!productExample) continue;
        stats.example_links++;
        for (const localized of example.localizations) {
          insertExampleLocalization.run({
            product_example_id: productExample.id,
            lang: localized.lang,
            text: localized.text,
            reading: localized.reading,
            source: localized.source,
            confidence: localized.confidence,
            needs_review: localized.needs_review
          });
        }
      }
    }
  }
});

writeGroups([...groups.values()].sort(compareGroups));

const summary = {
  stats,
  compression: {
    grouped_source_senses_per_product_entry: round(stats.grouped_source_senses / Math.max(stats.product_entries, 1), 2),
    product_entries_per_scanned_source_sense: round(stats.product_entries / Math.max(stats.source_senses_scanned, 1), 4)
  },
  coverage: {
    by_lang_rows: all(
      outDb,
      `
      SELECT lang, COUNT(*) AS rows
      FROM product_localizations
      GROUP BY lang
      ORDER BY lang
    `
    ),
    localization_matrix: all(
      outDb,
      `
      SELECT localized_langs, COUNT(*) AS product_senses
      FROM (
        SELECT product_sense_id, COUNT(DISTINCT lang) AS localized_langs
        FROM product_localizations
        GROUP BY product_sense_id
      )
      GROUP BY localized_langs
      ORDER BY localized_langs
    `
    ),
    source_lang_matrix: all(
      outDb,
      `
      SELECT linked_source_langs, COUNT(*) AS product_senses
      FROM (
        SELECT product_sense_id, COUNT(DISTINCT source_lang) AS linked_source_langs
        FROM product_sense_source_links
        GROUP BY product_sense_id
      )
      GROUP BY linked_source_langs
      ORDER BY linked_source_langs
    `
    ),
    top_groups: all(
      outDb,
      `
      SELECT pe.id, pe.headword, pe.primary_lang, pe.frequency_rank, pe.group_method, pe.source_count, pe.lang_count,
             ps.gloss_key,
             (SELECT group_concat(DISTINCT source_lang) FROM product_sense_source_links WHERE product_sense_id = ps.id) AS source_langs,
             (SELECT group_concat(DISTINCT lang) FROM product_localizations WHERE product_sense_id = ps.id) AS localization_langs
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      ORDER BY pe.frequency_rank, pe.id
      LIMIT 20
    `
    )
  }
};

fs.writeFileSync(outDbPath.replace(/\.db$/u, '.summary.json'), JSON.stringify(summary, null, 2));

sourceDb.close();
outDb.close();

console.log(JSON.stringify(summary, null, 2));

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      headword TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      primary_lang TEXT NOT NULL CHECK (primary_lang IN ('zh', 'en', 'pt-BR', 'ja')),
      frequency_rank INTEGER,
      group_key TEXT NOT NULL UNIQUE,
      group_method TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft_single_source', 'draft_fused', 'ready_for_llm', 'accepted', 'needs_review')),
      source_count INTEGER NOT NULL DEFAULT 0,
      lang_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS product_senses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_entry_id INTEGER NOT NULL,
      sense_order INTEGER NOT NULL,
      part_of_speech TEXT,
      gloss_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft_single_source', 'draft_fused', 'ready_for_llm', 'accepted', 'needs_review')),
      confidence REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_entry_id) REFERENCES product_entries(id) ON DELETE CASCADE,
      UNIQUE (product_entry_id, sense_order)
    );

    CREATE TABLE IF NOT EXISTS product_sense_source_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_sense_id INTEGER NOT NULL,
      source_entry_id INTEGER NOT NULL,
      source_sense_id INTEGER NOT NULL,
      source_lang TEXT NOT NULL,
      source_word TEXT NOT NULL,
      source_frequency_rank INTEGER,
      match_method TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE,
      UNIQUE (product_sense_id, source_sense_id)
    );

    CREATE TABLE IF NOT EXISTS product_localizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_sense_id INTEGER NOT NULL,
      lang TEXT NOT NULL CHECK (lang IN ('zh', 'en', 'pt-BR', 'ja')),
      term TEXT NOT NULL,
      reading TEXT,
      reading_system TEXT,
      pronunciation TEXT,
      pronunciation_system TEXT,
      definition TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
      FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE,
      UNIQUE (product_sense_id, lang)
    );

    CREATE TABLE IF NOT EXISTS product_examples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_sense_id INTEGER NOT NULL,
      source_example_id INTEGER NOT NULL,
      example_order INTEGER NOT NULL,
      source_lang TEXT NOT NULL,
      source_text TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
      FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE,
      UNIQUE (product_sense_id, source_example_id)
    );

    CREATE TABLE IF NOT EXISTS product_example_localizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_example_id INTEGER NOT NULL,
      lang TEXT NOT NULL CHECK (lang IN ('zh', 'en', 'pt-BR', 'ja')),
      text TEXT NOT NULL,
      reading TEXT,
      source TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
      FOREIGN KEY (product_example_id) REFERENCES product_examples(id) ON DELETE CASCADE,
      UNIQUE (product_example_id, lang)
    );

    CREATE INDEX IF NOT EXISTS idx_product_entries_rank ON product_entries(frequency_rank, id);
    CREATE INDEX IF NOT EXISTS idx_product_entries_lookup ON product_entries(normalized_key, primary_lang);
    CREATE INDEX IF NOT EXISTS idx_product_links_source ON product_sense_source_links(source_sense_id);
    CREATE INDEX IF NOT EXISTS idx_product_localizations_lang_term ON product_localizations(lang, term);
  `);
}

function loadLocalizations(db, senseIds) {
  const output = new Map();
  if (!senseIds.length) return output;
  const stmt = db.prepare(`
    SELECT sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system,
           definition, source, confidence, needs_review
    FROM sense_localizations
    WHERE sense_id = ?
    ORDER BY needs_review, confidence DESC, id
  `);
  for (const senseId of senseIds) {
    output.set(senseId, stmt.all(senseId));
  }
  return output;
}

function loadExamples(db, senseIds) {
  const output = new Map();
  if (!senseIds.length) return output;
  const examplesStmt = db.prepare(`
    SELECT id, sense_id, example_order, source_lang, source_text, source, confidence, needs_review
    FROM examples
    WHERE sense_id = ?
    ORDER BY needs_review, example_order, id
    LIMIT 5
  `);
  const localizationStmt = db.prepare(`
    SELECT lang, text, reading, source, confidence, needs_review
    FROM example_localizations
    WHERE example_id = ?
    ORDER BY needs_review, lang
  `);
  for (const senseId of senseIds) {
    output.set(
      senseId,
      examplesStmt.all(senseId).map((example) => ({
        ...example,
        localizations: localizationStmt.all(example.id)
      }))
    );
  }
  return output;
}

function buildGroupKey(row, topEnglishEntries) {
  const pos = normalizePos(row.part_of_speech);
  const glossSignature = normalizeGlossSignature(row.gloss_key);
  if (row.source_lang === 'en') {
    return {
      key: `en:${pos}:${row.normalized_key}`,
      method: 'english_headword',
      displayGloss: row.gloss_key
    };
  }

  const directEnglish = directEnglishGloss(glossSignature);
  if (directEnglish && topEnglishEntries.has(directEnglish)) {
    return {
      key: `en:${pos}:${directEnglish}`,
      method: 'gloss_to_top_english_headword',
      displayGloss: row.gloss_key
    };
  }

  if (glossSignature.length >= 4) {
    return {
      key: `gloss:${pos}:${glossSignature}`,
      method: 'normalized_gloss',
      displayGloss: row.gloss_key
    };
  }

  return {
    key: `${row.source_lang}:${pos}:${row.normalized_key}`,
    method: 'source_headword_fallback',
    displayGloss: row.gloss_key
  };
}

function productEntryInfo(group, representative) {
  const headwordRow = chooseHeadwordRow(group.rows);
  return {
    headword: headwordRow.word,
    normalized_key: headwordRow.normalized_key,
    primary_lang: headwordRow.source_lang,
    frequency_rank: group.bestRank,
    group_key: group.key,
    group_method: group.method,
    status: group.languages.size >= 2 ? 'draft_fused' : 'draft_single_source',
    source_count: group.rows.length,
    lang_count: group.languages.size
  };
}

function chooseRepresentative(rows) {
  return [...rows].sort(compareEvidenceRows)[0];
}

function chooseHeadwordRow(rows) {
  const sorted = [...rows].sort((a, b) => {
    const languageDelta = headwordLangScore(a.source_lang) - headwordLangScore(b.source_lang);
    if (languageDelta) return languageDelta;
    return compareEvidenceRows(a, b);
  });
  return sorted[0];
}

function chooseBestLocalizations(rows) {
  const output = new Map();
  for (const row of rows) {
    const localizations = localizationsBySense.get(row.source_sense_id) || [];
    for (const localization of localizations) {
      const current = output.get(localization.lang);
      if (!current || compareLocalizations(localization, current) < 0) {
        output.set(localization.lang, localization);
      }
    }
  }
  return output;
}

function compareGroups(a, b) {
  if (a.bestRank !== b.bestRank) return a.bestRank - b.bestRank;
  if (b.languages.size !== a.languages.size) return b.languages.size - a.languages.size;
  if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
  return a.key.localeCompare(b.key);
}

function compareEvidenceRows(a, b) {
  if (a.needs_review !== b.needs_review) return a.needs_review - b.needs_review;
  if (Number(b.confidence) !== Number(a.confidence)) return Number(b.confidence) - Number(a.confidence);
  if (a.frequency_rank !== b.frequency_rank) return a.frequency_rank - b.frequency_rank;
  if (a.sense_order !== b.sense_order) return a.sense_order - b.sense_order;
  return a.source_sense_id - b.source_sense_id;
}

function compareLocalizations(a, b) {
  if (a.needs_review !== b.needs_review) return a.needs_review - b.needs_review;
  if (Number(b.confidence) !== Number(a.confidence)) return Number(b.confidence) - Number(a.confidence);
  const aScore = localizationCompleteness(a);
  const bScore = localizationCompleteness(b);
  if (bScore !== aScore) return bScore - aScore;
  return String(a.source).localeCompare(String(b.source));
}

function localizationCompleteness(row) {
  let score = 0;
  if (row.term) score++;
  if (row.definition) score++;
  if (row.reading) score++;
  if (row.pronunciation) score++;
  return score;
}

function matchesProductProfile(row) {
  const word = String(row.word || '').trim();
  if (!word || word.length > 32) return false;
  if (/^\d+$/u.test(word)) return false;
  if (/[_/@#&+=]/u.test(word)) return false;
  if (/^[A-Z0-9]{2,}$/u.test(word)) return false;
  if (/[()"'鈥溾€漖]/u.test(word)) return false;
  if (/^\p{P}+$/u.test(word)) return false;

  const gloss = String(row.gloss_key || '').toLowerCase();
  if (!gloss || gloss === 'missing gloss') return false;
  if (
    /\b(surname|family name|place name|old name|abbreviation|acronym|internet slang|classifier|radical|unicode|symbol|soft redirect)\b/u.test(
      gloss
    )
  ) {
    return false;
  }

  if (row.source_lang === 'en') return /^[A-Za-z][A-Za-z-]{1,31}$/u.test(word);
  if (row.source_lang === 'zh') return /^[\u3400-\u9fff]{1,8}$/u.test(word);
  if (row.source_lang === 'ja') return /^[\u3040-\u30ff\u3400-\u9fff]{1,12}$/u.test(word);
  if (row.source_lang === 'pt-BR') return /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ-]{1,31}$/u.test(word);
  return false;
}

function isRiskyFreeDictRow(row) {
  if (!String(row.source || '').startsWith('freedict-')) return false;
  const glossSignature = normalizeGlossSignature(row.gloss_key);
  if (!glossSignature) return true;
  if (RISKY_FREEDICT_SHORT_GLOSSES.has(glossSignature)) return true;
  if (row.source_lang === 'pt-BR' && row.frequency_rank <= 5000 && glossSignature.length <= 3) return true;
  return false;
}

function normalizePos(pos) {
  return (
    String(pos || 'unknown')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[^a-z]+/gu, ' ')
      .trim()
      .split(/\s+/u)
      .slice(0, 2)
      .join('_') || 'unknown'
  );
}

function normalizeGlossSignature(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/["'鈥溾€濃€樷€檂]/gu, '')
    .replace(/\b(to|a|an|the|one's|ones|someone|somebody|something)\b/gu, ' ')
    .replace(/[^a-z0-9\u3400-\u9fff\u3040-\u30ff]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .split(/\s+/u)
    .slice(0, 10)
    .join(' ');
}

function directEnglishGloss(signature) {
  const cleaned = String(signature || '').trim();
  if (/^[a-z][a-z-]{1,31}$/u.test(cleaned)) return cleaned;
  return null;
}

function headwordLangScore(lang) {
  if (lang === 'en') return 0;
  if (lang === 'zh') return 1;
  if (lang === 'ja') return 2;
  if (lang === 'pt-BR') return 3;
  return 9;
}

function all(db, sql) {
  return db.prepare(sql).all();
}

function round(value, digits) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      result[arg.slice(2)] = argv[++i] || 'true';
    }
  }
  return result;
}
