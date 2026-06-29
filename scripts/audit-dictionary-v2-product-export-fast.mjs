import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args["out-dir"] || "outputs/d1-v2-product-native-export");
const manifestPath = path.join(outDir, "manifest.json");
const auditDbPath = path.join(outDir, "audit-fast-import.db");
const samplesPath = path.join(outDir, "audit-fast-samples.json");
const auditPath = path.join(outDir, "audit-fast.json");
const sampleTerms = String(args.samples || "hello,你好,中,杆,inside,秘密,何時,国際,ビジター")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const file = `${auditDbPath}${suffix}`;
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const db = new Database(auditDbPath);
db.pragma("journal_mode = MEMORY");
db.pragma("synchronous = OFF");
db.pragma("foreign_keys = OFF");
db.pragma("temp_store = MEMORY");

const schemaSql = fs
  .readFileSync(path.resolve(manifest.schema), "utf8")
  .split(/\r?\n/)
  .filter((line) => !/^CREATE\s+INDEX\b/i.test(line.trim()))
  .join("\n");
db.exec(schemaSql);

const started = Date.now();
db.exec("BEGIN");
try {
  for (const relativeFile of manifest.chunks || []) {
    const file = path.resolve(relativeFile);
    if (!fs.existsSync(file)) throw new Error(`Missing chunk: ${file}`);
    db.exec(fs.readFileSync(file, "utf8"));
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

const counts = Object.fromEntries(
  [
    ["entries", "v2_entries"],
    ["entry_forms", "v2_entry_forms"],
    ["pronunciation_groups", "v2_pronunciation_groups"],
    ["senses", "v2_senses"],
    ["sense_localizations", "v2_sense_localizations"],
    ["examples", "v2_examples"],
    ["example_localizations", "v2_example_localizations"]
  ].map(([key, table]) => [key, scalar(`SELECT COUNT(*) AS n FROM ${table}`)])
);

const audit = {
  ok: false,
  out_dir: path.relative(process.cwd(), outDir),
  import_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  manifest_stats: manifest.stats,
  counts,
  count_mismatches: compareCounts(manifest.stats || {}, counts),
  bad_sense_localization_counts: scalar(`
    SELECT COUNT(*) AS n
    FROM (
      SELECT sense_id
      FROM v2_sense_localizations
      GROUP BY sense_id
      HAVING COUNT(DISTINCT lang) != 4
    )
  `),
  duplicate_sense_orders: scalar(`
    SELECT COUNT(*) AS n
    FROM (
      SELECT entry_id, sense_order
      FROM v2_senses
      GROUP BY entry_id, sense_order
      HAVING COUNT(*) > 1
    )
  `),
  empty_required: {
    entries: scalar(`SELECT COUNT(*) AS n FROM v2_entries WHERE COALESCE(word, '') = ''`),
    localizations: scalar(`SELECT COUNT(*) AS n FROM v2_sense_localizations WHERE COALESCE(term, '') = '' OR COALESCE(definition, '') = ''`),
    examples: scalar(`SELECT COUNT(*) AS n FROM v2_examples WHERE COALESCE(source_text, '') = ''`),
    example_localizations: scalar(`SELECT COUNT(*) AS n FROM v2_example_localizations WHERE COALESCE(text, '') = ''`)
  },
  orphans: {
    senses: scalar(`SELECT COUNT(*) AS n FROM v2_senses s LEFT JOIN v2_entries e ON e.id=s.entry_id WHERE e.id IS NULL`),
    localizations: scalar(`SELECT COUNT(*) AS n FROM v2_sense_localizations l LEFT JOIN v2_senses s ON s.id=l.sense_id WHERE s.id IS NULL`),
    examples: scalar(`SELECT COUNT(*) AS n FROM v2_examples x LEFT JOIN v2_senses s ON s.id=x.sense_id WHERE s.id IS NULL`),
    example_localizations: scalar(`SELECT COUNT(*) AS n FROM v2_example_localizations xl LEFT JOIN v2_examples x ON x.id=xl.example_id WHERE x.id IS NULL`)
  }
};

const samples = sampleTerms.map((term) => lookupSample(term));
audit.sample_failures = samples.filter((sample) => !sample.ok).map((sample) => ({ term: sample.term, reason: sample.reason }));
audit.ok =
  audit.count_mismatches.length === 0 &&
  audit.bad_sense_localization_counts === 0 &&
  audit.duplicate_sense_orders === 0 &&
  Object.values(audit.empty_required).every((value) => value === 0) &&
  Object.values(audit.orphans).every((value) => value === 0) &&
  audit.sample_failures.length === 0;

fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2), "utf8");
fs.writeFileSync(samplesPath, JSON.stringify(samples, null, 2), "utf8");
console.log(JSON.stringify({ audit, samples }, null, 2));
db.close();
if (!audit.ok) process.exitCode = 1;

function lookupSample(term) {
  const normalized = normalizeKey(term);
  const entry = db
    .prepare(
      `
      WITH candidates AS (
        SELECT e.id, e.word, e.source_lang, e.frequency_rank, 0 AS priority
        FROM v2_entries e
        WHERE e.normalized_key = @normalized
        UNION ALL
        SELECT e.id, e.word, e.source_lang, e.frequency_rank,
          CASE WHEN f.form_type = 'headword' THEN 1 WHEN f.form_type = 'localized_term' THEN 2 ELSE 3 END AS priority
        FROM v2_entry_forms f
        JOIN v2_entries e ON e.id = f.entry_id
        WHERE f.normalized_form = @normalized
      )
      SELECT *
      FROM candidates
      ORDER BY priority, CASE WHEN frequency_rank IS NULL THEN 999999 ELSE frequency_rank END, id
      LIMIT 1
    `
    )
    .get({ normalized });
  if (!entry) return { term, ok: false, reason: "no_match" };

  const senses = db
    .prepare(`SELECT id, sense_order, part_of_speech, gloss_key FROM v2_senses WHERE entry_id=? ORDER BY sense_order LIMIT 3`)
    .all(entry.id)
    .map((sense) => ({
      ...sense,
      localizations: db
        .prepare(
          `SELECT lang, term, reading, pronunciation, substr(definition, 1, 160) AS definition FROM v2_sense_localizations WHERE sense_id=? ORDER BY lang`
        )
        .all(sense.id)
    }));
  const badLocalizationCount = senses.filter((sense) => new Set(sense.localizations.map((row) => row.lang)).size !== 4).length;
  return { term, ok: badLocalizationCount === 0, reason: badLocalizationCount ? "sense_not_four_language_complete" : "", entry, senses };
}

function compareCounts(expected, actual) {
  return Object.entries(actual)
    .filter(([key, value]) => Number(expected[key] || 0) !== value)
    .map(([key, value]) => ({ key, expected: Number(expected[key] || 0), actual: value }));
}

function scalar(sql) {
  return db.prepare(sql).get().n;
}

function normalizeKey(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index++;
    }
  }
  return parsed;
}
