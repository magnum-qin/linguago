import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args["out-dir"] || "outputs/d1-v2-product-native-export");
const manifestPath = path.join(outDir, "manifest.json");
const auditDbPath = path.join(outDir, "audit-import.db");
const auditPath = path.join(outDir, "audit.json");
const samplesPath = path.join(outDir, "audit-samples.json");

const sampleTerms = (args.samples || "hello,\u4f60\u597d,\u600e,\u5565,appearance")
  .split(",")
  .map((term) => term.trim())
  .filter(Boolean);

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Missing product D1 export manifest: ${manifestPath}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (fs.existsSync(auditDbPath)) fs.unlinkSync(auditDbPath);

const db = new Database(auditDbPath);
db.pragma("foreign_keys = ON");
db.function("invalid_pos", invalidPartOfSpeech);
db.function("source_script_mismatch", sourceScriptMismatch);

for (const relativeFile of [manifest.schema, ...(manifest.chunks || [])]) {
  const sqlPath = path.resolve(relativeFile);
  if (!fs.existsSync(sqlPath)) throw new Error(`Missing SQL file from manifest: ${sqlPath}`);
  db.exec(fs.readFileSync(sqlPath, "utf8"));
}

const audit = buildAudit(db, manifest);
const samples = sampleTerms.map((term) => lookupSample(db, term));

audit.sample_failures = samples.filter((sample) => !sample.ok).map((sample) => ({
  term: sample.term,
  reason: sample.reason
}));
audit.ok = isAuditOk(audit);

fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), "utf8");
fs.writeFileSync(samplesPath, JSON.stringify(samples, null, 2), "utf8");

console.log(JSON.stringify({ audit, samples }, null, 2));
db.close();

if (!audit.ok) {
  process.exitCode = 1;
}

function buildAudit(database, exportManifest) {
  const count = (table) => scalar(database, `SELECT COUNT(*) AS n FROM ${table}`);
  return {
    ok: false,
    out_dir: path.relative(process.cwd(), outDir),
    manifest_stats: exportManifest.stats || {},
    counts: {
      entries: count("v2_entries"),
      entry_forms: count("v2_entry_forms"),
      pronunciation_groups: count("v2_pronunciation_groups"),
      senses: count("v2_senses"),
      sense_localizations: count("v2_sense_localizations"),
      examples: count("v2_examples"),
      example_localizations: count("v2_example_localizations")
    },
    count_mismatches: compareCounts(exportManifest.stats || {}, {
      entries: count("v2_entries"),
      entry_forms: count("v2_entry_forms"),
      pronunciation_groups: count("v2_pronunciation_groups"),
      senses: count("v2_senses"),
      sense_localizations: count("v2_sense_localizations"),
      examples: count("v2_examples"),
      example_localizations: count("v2_example_localizations")
    }),
    bad_sense_localization_counts: scalar(
      database,
      `
        SELECT COUNT(*) AS n
        FROM (
          SELECT sense_id
          FROM v2_sense_localizations
          GROUP BY sense_id
          HAVING COUNT(DISTINCT lang) != 4
        )
      `
    ),
    duplicate_sense_orders: scalar(
      database,
      `
        SELECT COUNT(*) AS n
        FROM (
          SELECT entry_id, sense_order
          FROM v2_senses
          GROUP BY entry_id, sense_order
          HAVING COUNT(*) > 1
        )
      `
    ),
    empty_required: {
      empty_words: scalar(database, `SELECT COUNT(*) AS n FROM v2_entries WHERE COALESCE(word, '') = ''`),
      empty_entry_forms: scalar(database, `SELECT COUNT(*) AS n FROM v2_entry_forms WHERE COALESCE(form, '') = ''`),
      empty_localizations: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_sense_localizations WHERE COALESCE(term, '') = '' OR COALESCE(definition, '') = ''`
      ),
      empty_examples: scalar(database, `SELECT COUNT(*) AS n FROM v2_examples WHERE COALESCE(source_text, '') = ''`),
      empty_example_localizations: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_example_localizations WHERE COALESCE(text, '') = ''`
      )
    },
    orphans: {
      orphan_entry_forms: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_entry_forms f LEFT JOIN v2_entries e ON e.id=f.entry_id WHERE e.id IS NULL`
      ),
      orphan_pronunciation_groups: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_pronunciation_groups g LEFT JOIN v2_entries e ON e.id=g.entry_id WHERE e.id IS NULL`
      ),
      orphan_senses: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_senses s LEFT JOIN v2_entries e ON e.id=s.entry_id WHERE e.id IS NULL`
      ),
      orphan_sense_pronunciation_groups: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_senses s LEFT JOIN v2_pronunciation_groups g ON g.id=s.pronunciation_group_id WHERE s.pronunciation_group_id IS NOT NULL AND g.id IS NULL`
      ),
      orphan_localizations: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_sense_localizations l LEFT JOIN v2_senses s ON s.id=l.sense_id WHERE s.id IS NULL`
      ),
      orphan_examples: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_examples x LEFT JOIN v2_senses s ON s.id=x.sense_id WHERE s.id IS NULL`
      ),
      orphan_example_localizations: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_example_localizations xl LEFT JOIN v2_examples x ON x.id=xl.example_id WHERE x.id IS NULL`
      )
    },
    lookup_integrity: {
      non_source_reading_forms: scalar(
        database,
        `
          SELECT COUNT(*) AS n
          FROM v2_entry_forms f
          JOIN v2_entries e ON e.id=f.entry_id
          WHERE f.form_type IN ('reading', 'reading_key')
            AND f.lang <> e.source_lang
        `
      ),
      pronunciation_group_lang_mismatches: scalar(
        database,
        `
          SELECT COUNT(*) AS n
          FROM v2_pronunciation_groups g
          JOIN v2_entries e ON e.id=g.entry_id
          WHERE g.lang <> e.source_lang
        `
      ),
      non_source_reading_form_samples: database
        .prepare(
          `
            SELECT e.id AS entry_id, e.word, e.source_lang, f.lang AS form_lang, f.form, f.form_type, f.normalized_form
            FROM v2_entry_forms f
            JOIN v2_entries e ON e.id=f.entry_id
            WHERE f.form_type IN ('reading', 'reading_key')
              AND f.lang <> e.source_lang
            ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id, f.id
            LIMIT 20
          `
        )
        .all(),
      pronunciation_group_lang_mismatch_samples: database
        .prepare(
          `
            SELECT e.id AS entry_id, e.word, e.source_lang, g.lang AS group_lang, g.reading, g.reading_key
            FROM v2_pronunciation_groups g
            JOIN v2_entries e ON e.id=g.entry_id
            WHERE g.lang <> e.source_lang
            ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id, g.id
            LIMIT 20
          `
        )
        .all()
    },
    content_integrity: {
      invalid_part_of_speech: scalar(
        database,
        `
          SELECT COUNT(*) AS n
          FROM v2_senses
          WHERE invalid_pos(part_of_speech)
        `
      ),
      source_script_mismatches: scalar(
        database,
        `
          SELECT COUNT(*) AS n
          FROM v2_entries
          WHERE source_script_mismatch(word, source_lang)
        `
      ),
      invalid_part_of_speech_samples: database
        .prepare(
          `
            SELECT e.id AS entry_id, e.word, e.source_lang, s.id AS sense_id, s.sense_order, s.part_of_speech
            FROM v2_senses s
            JOIN v2_entries e ON e.id=s.entry_id
            WHERE invalid_pos(s.part_of_speech)
            ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id, s.sense_order
            LIMIT 20
          `
        )
        .all(),
      source_script_mismatch_samples: database
        .prepare(
          `
            SELECT id AS entry_id, word, source_lang, normalized_key
            FROM v2_entries
            WHERE source_script_mismatch(word, source_lang)
            ORDER BY frequency_rank IS NULL, frequency_rank, id
            LIMIT 20
          `
        )
        .all()
    },
    duplicate_zh_examples_by_en_reading: scalar(
      database,
      `
        SELECT COUNT(*) AS n
        FROM (
          SELECT x.sense_id, lower(trim(en.text)) AS en_text, lower(trim(zh.reading)) AS zh_reading, COUNT(*) AS c
          FROM v2_examples x
          JOIN v2_example_localizations zh ON zh.example_id=x.id AND zh.lang='zh'
          JOIN v2_example_localizations en ON en.example_id=x.id AND en.lang='en'
          WHERE x.source_lang='zh' AND COALESCE(zh.reading,'') <> ''
          GROUP BY x.sense_id, lower(trim(en.text)), lower(trim(zh.reading))
          HAVING c > 1
        )
      `
    ),
    warnings: {
      zh_terms_with_kana: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_sense_localizations WHERE lang='zh' AND (term GLOB '*[ぁ-んァ-ン]*' OR definition GLOB '*[ぁ-んァ-ン]*')`
      ),
      ja_terms_with_latin_only: scalar(
        database,
        `SELECT COUNT(*) AS n FROM v2_sense_localizations WHERE lang='ja' AND term GLOB '*[A-Za-z]*' AND term NOT GLOB '*[ぁ-んァ-ン一-龯]*'`
      ),
      zh_terms_with_kana_samples: database
        .prepare(
          `
            SELECT e.word, l.sense_id, l.term, l.definition
            FROM v2_sense_localizations l
            JOIN v2_senses s ON s.id=l.sense_id
            JOIN v2_entries e ON e.id=s.entry_id
            WHERE l.lang='zh' AND (l.term GLOB '*[ぁ-んァ-ン]*' OR l.definition GLOB '*[ぁ-んァ-ン]*')
            ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
            LIMIT 10
          `
        )
        .all(),
      ja_terms_with_latin_only_samples: database
        .prepare(
          `
            SELECT e.word, l.sense_id, l.term, l.definition
            FROM v2_sense_localizations l
            JOIN v2_senses s ON s.id=l.sense_id
            JOIN v2_entries e ON e.id=s.entry_id
            WHERE l.lang='ja' AND l.term GLOB '*[A-Za-z]*' AND l.term NOT GLOB '*[ぁ-んァ-ン一-龯]*'
            ORDER BY e.frequency_rank IS NULL, e.frequency_rank, e.id
            LIMIT 10
          `
        )
        .all()
    }
  };
}

function lookupSample(database, term) {
  const normalized = normalizeKey(term);
  const entry = database
    .prepare(
      `
        WITH candidates AS (
          SELECT e.id, e.word, e.source_lang, e.frequency_rank, 0 AS priority, e.frequency_rank AS rank
          FROM v2_entries e
          WHERE e.normalized_key = @normalized
          UNION ALL
          SELECT e.id, e.word, e.source_lang, e.frequency_rank,
            CASE WHEN f.form_type = 'headword' THEN 1 WHEN f.form_type = 'localized_term' THEN 2 ELSE 3 END AS priority,
            e.frequency_rank AS rank
          FROM v2_entry_forms f
          JOIN v2_entries e ON e.id = f.entry_id
          WHERE f.normalized_form = @normalized
        )
        SELECT *
        FROM candidates
        ORDER BY priority, CASE WHEN rank IS NULL THEN 999999 ELSE rank END, id
        LIMIT 1
      `
    )
    .get({ normalized });

  if (!entry) return { term, ok: false, reason: "no_match" };

  const senses = database
    .prepare(`
      SELECT s.id, s.sense_order, s.part_of_speech, s.gloss_key,
        g.lang AS pronunciation_group_lang,
        g.reading AS pronunciation_group_reading,
        g.reading_key AS pronunciation_group_reading_key,
        g.reading_system AS pronunciation_group_reading_system
      FROM v2_senses s
      LEFT JOIN v2_pronunciation_groups g ON g.id=s.pronunciation_group_id
      WHERE s.entry_id=?
      ORDER BY s.sense_order
    `)
    .all(entry.id)
    .map((sense) => ({
      ...sense,
      localizations: database
        .prepare(
          `SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition FROM v2_sense_localizations WHERE sense_id=? ORDER BY lang`
        )
        .all(sense.id),
      examples: database
        .prepare(
          `
            SELECT x.example_order, x.source_lang, x.source_text, xl.lang, xl.text
            FROM v2_examples x
            LEFT JOIN v2_example_localizations xl ON xl.example_id=x.id
            WHERE x.sense_id=?
            ORDER BY x.example_order, xl.lang
            LIMIT 8
          `
        )
        .all(sense.id)
    }));

  const badLocalizationCount = senses.filter((sense) => new Set(sense.localizations.map((row) => row.lang)).size !== 4).length;
  return {
    term,
    ok: badLocalizationCount === 0,
    reason: badLocalizationCount ? "sense_not_four_language_complete" : "",
    entry,
    senses: senses.slice(0, 3)
  };
}

function isAuditOk(audit) {
  return (
    audit.count_mismatches.length === 0 &&
    audit.bad_sense_localization_counts === 0 &&
    audit.duplicate_sense_orders === 0 &&
    Object.values(audit.empty_required).every((value) => value === 0) &&
    Object.values(audit.orphans).every((value) => value === 0) &&
    audit.lookup_integrity.non_source_reading_forms === 0 &&
    audit.lookup_integrity.pronunciation_group_lang_mismatches === 0 &&
    audit.content_integrity.invalid_part_of_speech === 0 &&
    audit.content_integrity.source_script_mismatches === 0 &&
    audit.duplicate_zh_examples_by_en_reading === 0 &&
    audit.sample_failures.length === 0
  );
}

function compareCounts(expected, actual) {
  return Object.entries(actual)
    .filter(([key, value]) => Number(expected[key] || 0) !== value)
    .map(([key, value]) => ({ key, expected: Number(expected[key] || 0), actual: value }));
}

function scalar(database, sql) {
  return database.prepare(sql).get().n;
}

function normalizeKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function invalidPartOfSpeech(value) {
  const text = normalizeKey(value);
  if (!text) return 0;
  if (/[&;]/.test(text)) return 1;
  if (["n", "v", "adj", "adv"].includes(text)) return 1;
  return 0;
}

function sourceScriptMismatch(word, sourceLang) {
  const text = String(word || "").trim();
  const lang = String(sourceLang || "").trim();
  if (!text || !lang) return 1;

  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHiragana = /\p{Script=Hiragana}/u.test(text);
  const hasKatakana = /\p{Script=Katakana}/u.test(text);
  const hasKana = hasHiragana || hasKatakana;

  if (lang === "zh") return hasLatin || hasKana || !hasHan ? 1 : 0;
  if (lang === "ja") return hasHan || hasKana ? 0 : 1;
  if (lang === "en" || lang === "pt-BR") return hasHan || hasKana ? 1 : 0;
  return 0;
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
