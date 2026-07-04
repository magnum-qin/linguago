import Database from "better-sqlite3";
import path from "node:path";

const LANGUAGE_CODES = new Set(["en", "zh", "ja", "pt-BR"]);
const DEFAULT_DB = "data/processed/linguago_v2_staging.db";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const limit = args.limit ? Number(args.limit) : 0;
const batchSize = args["batch-size"] ? Number(args["batch-size"]) : 5000;
const resetCanonical = args["reset-canonical"] !== "false";
const sourceNames = (args.sources || "")
  .split(",")
  .map((source) => source.trim())
  .filter(Boolean);
const sourceParams = Object.fromEntries(sourceNames.map((source, index) => [`source${index}`, source]));
const sourceFilterSql = sourceNames.length
  ? `AND ds.source_key IN (${sourceNames.map((_, index) => `@source${index}`).join(", ")})`
  : "";

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

if (resetCanonical) {
  db.exec(`
    DELETE FROM quality_issues;
    DELETE FROM llm_completion_jobs;
    DELETE FROM example_localizations;
    DELETE FROM examples;
    DELETE FROM sense_localizations;
    DELETE FROM sense_source_links;
    DELETE FROM senses;
    DELETE FROM entry_forms;
    DELETE FROM entries;
  `);
}

const statements = {
  sourceRows: db.prepare(`
    SELECT
      ds.source_key,
      se.id AS source_entry_id,
      se.source_entry_key,
      se.word,
      se.normalized_key,
      se.lang,
      se.raw_json AS entry_raw_json,
      ss.id AS source_sense_id,
      ss.source_sense_key,
      ss.sense_order,
      ss.part_of_speech,
      ss.domain,
      ss.register_label,
      ss.gloss,
      ss.raw_json AS sense_raw_json
    FROM source_entries se
    JOIN dictionary_sources ds ON ds.id = se.source_id
    JOIN source_senses ss ON ss.source_entry_id = se.id
    WHERE ss.id > @afterSenseId
      ${sourceFilterSql}
    ORDER BY ss.id
    LIMIT @batchSize
  `),
  insertEntry: db.prepare(`
    INSERT OR IGNORE INTO entries
      (word, normalized_key, source_lang, script_variant, status)
    VALUES
      (@word, @normalized_key, @source_lang, @script_variant, @status)
  `),
  getEntry: db.prepare(`
    SELECT id FROM entries WHERE normalized_key = ? AND source_lang = ?
  `),
  insertEntryForm: db.prepare(`
    INSERT OR IGNORE INTO entry_forms
      (entry_id, lang, form, form_type, normalized_form, source, confidence)
    VALUES
      (@entry_id, @lang, @form, @form_type, @normalized_form, @source, @confidence)
  `),
  insertSense: db.prepare(`
    INSERT OR IGNORE INTO senses
      (entry_id, sense_order, part_of_speech, domain, register_label, gloss_key, source, confidence, needs_review)
    VALUES
      (@entry_id, @sense_order, @part_of_speech, @domain, @register_label, @gloss_key, @source, @confidence, @needs_review)
  `),
  getSense: db.prepare(`
    SELECT id FROM senses WHERE entry_id = ? AND sense_order = ?
  `),
  insertSenseSourceLink: db.prepare(`
    INSERT OR IGNORE INTO sense_source_links
      (sense_id, source_sense_id, match_method, confidence)
    VALUES
      (@sense_id, @source_sense_id, @match_method, @confidence)
  `),
  insertLocalization: db.prepare(`
    INSERT OR IGNORE INTO sense_localizations
      (sense_id, lang, term, normalized_term, reading, reading_system, pronunciation, pronunciation_system, definition, usage_note, source, confidence, needs_review)
    VALUES
      (@sense_id, @lang, @term, @normalized_term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @usage_note, @source, @confidence, @needs_review)
  `),
  insertExample: db.prepare(`
    INSERT OR IGNORE INTO examples
      (sense_id, example_order, source_lang, source_text, source_reading, difficulty, register_label, source, confidence, needs_review)
    VALUES
      (@sense_id, @example_order, @source_lang, @source_text, @source_reading, @difficulty, @register_label, @source, @confidence, @needs_review)
  `),
  getExample: db.prepare(`
    SELECT id FROM examples WHERE sense_id = ? AND example_order = ?
  `),
  insertExampleLocalization: db.prepare(`
    INSERT OR IGNORE INTO example_localizations
      (example_id, lang, text, reading, source, confidence, needs_review)
    VALUES
      (@example_id, @lang, @text, @reading, @source, @confidence, @needs_review)
  `),
  insertQualityIssue: db.prepare(`
    INSERT INTO quality_issues (entity_type, entity_id, issue_code, severity, message)
    VALUES (@entity_type, @entity_id, @issue_code, @severity, @message)
  `)
};

const stats = {
  source_senses_seen: 0,
  entries: 0,
  senses: 0,
  localizations: 0,
  examples: 0,
  example_localizations: 0,
  quality_issues: 0
};

const nextSenseOrderByEntry = new Map();
if (!resetCanonical) {
  for (const row of db.prepare(`SELECT entry_id, MAX(sense_order) + 1 AS next_order FROM senses GROUP BY entry_id`).all()) {
    nextSenseOrderByEntry.set(row.entry_id, row.next_order || 1);
  }
}

const buildRows = db.transaction((rows) => {
  for (const row of rows) {
    stats.source_senses_seen++;
    const entry = toCanonicalEntry(row);
    const entryInsert = statements.insertEntry.run(entry);
    stats.entries += entryInsert.changes;
    const entryId = statements.getEntry.get(entry.normalized_key, entry.source_lang).id;

    statements.insertEntryForm.run({
      entry_id: entryId,
      lang: entry.source_lang,
      form: entry.word,
      form_type: "lemma",
      normalized_form: entry.normalized_key,
      source: row.source_key,
      confidence: 1
    });

    const canonicalSenseOrder = nextSenseOrderByEntry.get(entryId) || 1;
    nextSenseOrderByEntry.set(entryId, canonicalSenseOrder + 1);

    const sense = toCanonicalSense(row, entryId, canonicalSenseOrder);
    const senseInsert = statements.insertSense.run(sense);
    stats.senses += senseInsert.changes;
    const senseId = statements.getSense.get(entryId, sense.sense_order).id;

    statements.insertSenseSourceLink.run({
      sense_id: senseId,
      source_sense_id: row.source_sense_id,
      match_method: "import",
      confidence: 1
    });

    const localizations = toSenseLocalizations(row, senseId);
    for (const localization of localizations) {
      const localizationInsert = statements.insertLocalization.run(localization);
      stats.localizations += localizationInsert.changes;
    }
    const localization = localizations[0] || null;

    for (const [index, example] of extractExamples(row).entries()) {
      const exampleInsert = statements.insertExample.run({
        sense_id: senseId,
        example_order: index + 1,
        source_lang: example.source_lang,
        source_text: example.source_text,
        source_reading: example.source_reading,
        difficulty: null,
        register_label: row.register_label,
        source: row.source_key,
        confidence: example.confidence,
        needs_review: example.needs_review
      });
      stats.examples += exampleInsert.changes;
      const exampleId = statements.getExample.get(senseId, index + 1).id;

      for (const localized of example.localizations) {
        const exampleLocalizationInsert = statements.insertExampleLocalization.run({
          example_id: exampleId,
          lang: localized.lang,
          text: localized.text,
          reading: localized.reading,
          source: row.source_key,
          confidence: localized.confidence,
          needs_review: localized.needs_review
        });
        stats.example_localizations += exampleLocalizationInsert.changes;
      }
    }

    addInitialQualityIssues({
      row,
      entryId,
      senseId,
      localization
    });
  }
});

let afterSenseId = 0;
while (!limit || stats.source_senses_seen < limit) {
  const remaining = limit ? limit - stats.source_senses_seen : batchSize;
  const rows = statements.sourceRows.all({
    afterSenseId,
    batchSize: Math.min(batchSize, remaining),
    ...sourceParams
  });
  if (!rows.length) break;
  buildRows(rows);
  afterSenseId = rows[rows.length - 1].source_sense_id;
}

const counts = {
  entries: countTable("entries"),
  senses: countTable("senses"),
  sense_localizations: countTable("sense_localizations"),
  examples: countTable("examples"),
  example_localizations: countTable("example_localizations"),
  quality_issues: countTable("quality_issues")
};

db.close();
console.log(JSON.stringify({ ok: true, db: path.relative(process.cwd(), dbPath), stats, counts }, null, 2));

function toCanonicalEntry(row) {
  return {
    word: row.word,
    normalized_key: row.normalized_key,
    source_lang: normalizeLang(row.lang),
    script_variant: detectScriptVariant(row.word, row.lang),
    status: "needs_review"
  };
}

function toCanonicalSense(row, entryId, senseOrder) {
  return {
    entry_id: entryId,
    sense_order: senseOrder,
    part_of_speech: cleanNullable(row.part_of_speech),
    domain: cleanNullable(row.domain),
    register_label: cleanNullable(row.register_label),
    gloss_key: cleanText(row.gloss) || "missing gloss",
    source: row.source_key,
    confidence: defaultConfidence(row.source_key),
    needs_review: row.source_key === "ecdict" ? 1 : 0
  };
}

function toSenseLocalizations(row, senseId) {
  const entryRaw = parseJson(row.entry_raw_json);
  const senseRaw = parseJson(row.sense_raw_json);
  const lang = normalizeLang(row.lang);
  const omwLocalizations = toOwmSenseLocalizations(row, senseId, senseRaw);
  if (omwLocalizations.length) return omwLocalizations;

  const translatedLocalization = toTranslatedSenseLocalization(row, senseId, senseRaw);
  if (translatedLocalization) {
    const sourceLocalization = toSourceTranslationEvidenceLocalization(row, senseId, entryRaw, senseRaw, lang);
    return sourceLocalization && sourceLocalization.lang !== translatedLocalization.lang
      ? [sourceLocalization, translatedLocalization]
      : [translatedLocalization];
  }

  const definition = cleanText(row.gloss);
  if (!definition || !definitionMatchesLang(definition, lang)) {
    return [];
  }
  const readingInfo = extractReading(row.source_key, entryRaw, senseRaw, lang);
  return [
    {
      sense_id: senseId,
      lang,
      term: extractTerm(row, entryRaw, senseRaw),
      normalized_term: normalizeKey(extractTerm(row, entryRaw, senseRaw)),
      reading: readingInfo.reading,
      reading_system: readingInfo.reading_system,
      pronunciation: readingInfo.pronunciation,
      pronunciation_system: readingInfo.pronunciation_system,
      definition,
      usage_note: null,
      source: row.source_key,
      confidence: defaultConfidence(row.source_key),
      needs_review: row.source_key === "ecdict" ? 1 : 0
    }
  ];
}

function toSourceTranslationEvidenceLocalization(row, senseId, entryRaw, senseRaw, lang) {
  if (!row.source_key.startsWith("wikdict-")) return null;
  const translations = asArray(senseRaw.translations).map(cleanText).filter(Boolean);
  const definition = translations.join("; ");
  if (!definition) return null;
  const readingInfo = extractReading(row.source_key, entryRaw, senseRaw, lang);
  const term = extractTerm(row, entryRaw, senseRaw);
  return {
    sense_id: senseId,
    lang,
    term,
    normalized_term: normalizeKey(term),
    reading: readingInfo.reading,
    reading_system: readingInfo.reading_system,
    pronunciation: readingInfo.pronunciation,
    pronunciation_system: readingInfo.pronunciation_system,
    definition,
    usage_note: null,
    source: row.source_key,
    confidence: defaultConfidence(row.source_key),
    needs_review: 0
  };
}

function toOwmSenseLocalizations(row, senseId, senseRaw) {
  if (row.source_key !== "omw-30") return [];
  const rawLocalizations = senseRaw.localizations || {};
  const localizations = [];
  for (const lang of LANGUAGE_CODES) {
    const terms = asArray(rawLocalizations[lang]).map(cleanText).filter(Boolean);
    if (!terms.length) continue;
    const term = terms.slice(0, 4).join("; ");
    localizations.push({
      sense_id: senseId,
      lang,
      term,
      normalized_term: normalizeKey(terms[0]),
      reading: null,
      reading_system: null,
      pronunciation: null,
      pronunciation_system: null,
      definition: terms.slice(0, 6).join("; "),
      usage_note: senseRaw.synset ? `OMW synset ${senseRaw.synset}` : null,
      source: row.source_key,
      confidence: defaultConfidence(row.source_key),
      needs_review: 0
    });
  }
  return localizations;
}

function toTranslatedSenseLocalization(row, senseId, senseRaw) {
  if (!row.source_key.startsWith("freedict-") && !row.source_key.startsWith("wikdict-")) return null;
  const targetLang = normalizeLang(senseRaw.target_lang);
  const translations = asArray(senseRaw.translations).map(cleanText).filter(Boolean);
  const term = firstText(translations);
  if (!term) return null;

  return {
    sense_id: senseId,
    lang: targetLang,
    term,
    normalized_term: normalizeKey(term),
    reading: null,
    reading_system: null,
    pronunciation: null,
    pronunciation_system: null,
    definition: translations.join("; "),
    usage_note: null,
    source: row.source_key,
    confidence: defaultConfidence(row.source_key),
    needs_review: 0
  };
}

function extractTerm(row, entryRaw, senseRaw) {
  if (row.source_key === "ecdict") return cleanText(row.word);
  if (row.source_key === "cc-cedict") return cleanText(entryRaw.simplified || row.word);
  if (row.source_key === "jmdict") {
    return cleanText(firstText(asArray(entryRaw.k_ele).map((item) => item?.keb)) || firstText(asArray(entryRaw.r_ele).map((item) => item?.reb)) || row.word);
  }
  if (row.source_key === "kaikki-zh") {
    return cleanText(senseRaw.word || entryRaw.word || row.word);
  }
  return cleanText(row.word);
}

function extractReading(sourceKey, entryRaw, senseRaw, lang) {
  if (sourceKey === "ecdict") {
    const phonetic = cleanNullable(entryRaw.phonetic);
    return {
      reading: null,
      reading_system: null,
      pronunciation: phonetic,
      pronunciation_system: phonetic ? "ecdict-phonetic" : null
    };
  }

  if (sourceKey === "cc-cedict") {
    const pinyin = cleanNullable(senseRaw.pinyin);
    return {
      reading: pinyin,
      reading_system: pinyin ? "pinyin" : null,
      pronunciation: null,
      pronunciation_system: null
    };
  }

  if (sourceKey === "jmdict") {
    const reading = cleanNullable(firstText(asArray(entryRaw.r_ele).map((item) => item?.reb)));
    return {
      reading,
      reading_system: reading ? "kana" : null,
      pronunciation: null,
      pronunciation_system: null
    };
  }

  if (sourceKey === "kaikki-zh") {
    const pinyin = firstTaggedPronunciation(entryRaw.sounds, "Pinyin");
    return {
      reading: pinyin,
      reading_system: pinyin ? "pinyin" : null,
      pronunciation: null,
      pronunciation_system: null
    };
  }

  return {
    reading: null,
    reading_system: null,
    pronunciation: null,
    pronunciation_system: null
  };
}

function extractExamples(row) {
  const senseRaw = parseJson(row.sense_raw_json);
  const rawExamples = asArray(senseRaw.examples).slice(0, 3);
  const lang = normalizeLang(row.lang);
  return rawExamples
    .map((example) => {
      const sourceText = cleanText(example.text || example.source_text || example.jpn || "");
      if (!sourceText) return null;
      const translation = cleanText(example.translation || example.english || example.en || "");
      const localizations = [
        {
          lang,
          text: sourceText,
          reading: cleanNullable(example.roman),
          confidence: defaultConfidence(row.source_key),
          needs_review: 0
        }
      ];
      if (translation && lang !== "en") {
        localizations.push({
          lang: "en",
          text: translation,
          reading: null,
          confidence: defaultConfidence(row.source_key),
          needs_review: 0
        });
      }
      return {
        source_lang: lang,
        source_text: sourceText,
        source_reading: cleanNullable(example.roman),
        confidence: defaultConfidence(row.source_key),
        needs_review: 0,
        localizations
      };
    })
    .filter(Boolean);
}

function addInitialQualityIssues({ row, senseId, localization }) {
  for (const lang of LANGUAGE_CODES) {
    if (localization && lang === localization.lang) continue;
    statements.insertQualityIssue.run({
      entity_type: "sense",
      entity_id: senseId,
      issue_code: `missing_${lang}_localization`,
      severity: "info",
      message: localization
        ? `Imported ${row.source_key} sense only has ${localization.lang}; ${lang} must be aligned or generated later.`
        : `Imported ${row.source_key} sense has no trusted ${lang} localization yet; it must be aligned or generated later.`
    });
    stats.quality_issues++;
  }

  if (!localization) {
    statements.insertQualityIssue.run({
      entity_type: "sense",
      entity_id: senseId,
      issue_code: "source_definition_not_localized",
      severity: "warn",
      message: `Imported ${row.source_key} ${row.lang} gloss is not written in ${row.lang}; skipped source localization.`
    });
    stats.quality_issues++;
    return;
  }

  if (!localization.reading && (localization.lang === "zh" || localization.lang === "ja")) {
    statements.insertQualityIssue.run({
      entity_type: "sense_localization",
      entity_id: senseId,
      issue_code: "missing_reading",
      severity: "warn",
      message: `${localization.lang} localization has no reading.`
    });
    stats.quality_issues++;
  }

  if (!localization.pronunciation && (localization.lang === "en" || localization.lang === "pt-BR")) {
    statements.insertQualityIssue.run({
      entity_type: "sense_localization",
      entity_id: senseId,
      issue_code: "missing_pronunciation",
      severity: "info",
      message: `${localization.lang} localization has no pronunciation.`
    });
    stats.quality_issues++;
  }
}

function definitionMatchesLang(definition, lang) {
  if (lang === "en") return containsLatin(definition);
  if (lang === "zh") return containsCjk(definition);
  if (lang === "ja") return containsJapanese(definition);
  if (lang === "pt-BR") return containsLatin(definition);
  return false;
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(String(value || ""));
}

function containsLatin(value) {
  return /[A-Za-zÀ-ÖØ-öø-ÿ]/u.test(String(value || ""));
}

function detectScriptVariant(word, lang) {
  if (lang !== "zh") return null;
  if (/[\u4e00-\u9fff]/u.test(word)) return "unknown";
  return null;
}

function defaultConfidence(sourceKey) {
  if (sourceKey === "cc-cedict" || sourceKey === "jmdict") return 0.95;
  if (sourceKey === "kaikki-zh") return 0.85;
  if (sourceKey === "ecdict") return 0.75;
  if (sourceKey === "omw-30") return 0.72;
  if (sourceKey.startsWith("wikdict-")) return 0.62;
  return 0.5;
}

function firstTaggedPronunciation(sounds, tag) {
  for (const sound of asArray(sounds)) {
    const tags = asArray(sound.tags).map(String);
    if (tags.includes(tag) && sound.zh_pron) return cleanText(sound.zh_pron);
  }
  return null;
}

function countTable(table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function normalizeLang(lang) {
  if (lang === "pt") return "pt-BR";
  if (!LANGUAGE_CODES.has(lang)) throw new Error(`Unsupported language: ${lang}`);
  return lang;
}

function normalizeKey(value) {
  return cleanText(value).normalize("NFKC").toLocaleLowerCase();
}

function cleanText(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function cleanNullable(value) {
  const text = cleanText(value);
  return text || null;
}

function parseJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function firstText(values) {
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (text) return text;
  }
  return null;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      result[arg.slice(2)] = argv[++i] || "true";
    }
  }
  return result;
}
