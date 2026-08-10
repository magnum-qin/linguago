import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const inputDir = path.resolve(args["input-dir"] || ".tmp/muse");
const outPath = path.resolve(args.out || ".tmp/muse/muse-research-evidence.db");
const baseDbPath = args["base-db"] ? path.resolve(args["base-db"]) : null;
const pairConfigs = [
  { file: "zh-en.txt", lang: "zh", direction: "target_to_en" },
  { file: "en-zh.txt", lang: "zh", direction: "en_to_target" },
  { file: "pt-en.txt", lang: "pt-BR", direction: "target_to_en" },
  { file: "en-pt.txt", lang: "pt-BR", direction: "en_to_target" }
];

for (const config of pairConfigs) {
  const filePath = path.join(inputDir, config.file);
  if (!fs.existsSync(filePath)) throw new Error(`Missing MUSE dictionary: ${filePath}`);
}
if (baseDbPath && !fs.existsSync(baseDbPath)) throw new Error(`Missing base evidence DB: ${baseDbPath}`);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  const candidate = `${outPath}${suffix}`;
  if (fs.existsSync(candidate)) fs.rmSync(candidate);
}

const db = new Database(outPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.exec(`
  CREATE TABLE evidence_sources (
    source_key TEXT PRIMARY KEY,
    source_family TEXT NOT NULL,
    lang TEXT NOT NULL,
    lexicon_spec TEXT NOT NULL,
    license TEXT NOT NULL,
    metadata_json TEXT NOT NULL
  );
  CREATE TABLE lexical_evidence (
    id INTEGER PRIMARY KEY,
    source_key TEXT NOT NULL REFERENCES evidence_sources(source_key),
    source_family TEXT NOT NULL,
    lang TEXT NOT NULL,
    term TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    english_gloss TEXT NOT NULL,
    english_normalized_key TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
  );
  CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
  CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
`);

let baseRows = 0;
if (baseDbPath) {
  db.prepare("ATTACH DATABASE ? AS base_evidence").run(baseDbPath);
  db.exec(`
    INSERT INTO evidence_sources
    SELECT * FROM base_evidence.evidence_sources;
    INSERT INTO lexical_evidence
      (source_key, source_family, lang, term, normalized_key,
       english_gloss, english_normalized_key, concept_id)
    SELECT source_key, source_family, lang, term, normalized_key,
           english_gloss, english_normalized_key, concept_id
    FROM base_evidence.lexical_evidence;
  `);
  baseRows = db.prepare("SELECT COUNT(*) AS count FROM lexical_evidence").get().count;
  db.exec("DETACH DATABASE base_evidence");
}

const insertSource = db.prepare(`
  INSERT INTO evidence_sources
    (source_key, source_family, lang, lexicon_spec, license, metadata_json)
  VALUES (?, 'muse', ?, ?, 'CC BY-NC 4.0', ?)
`);
const insertEvidence = db.prepare(`
  INSERT OR IGNORE INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id)
  VALUES (?, 'muse', ?, ?, ?, ?, ?, ?)
`);

const counts = {};
const importPair = db.transaction((config) => {
  const sourceKey = `muse-${config.file.replace(/\.txt$/i, "")}`;
  insertSource.run(
    sourceKey,
    config.lang,
    `facebookresearch/MUSE:${config.file}`,
    JSON.stringify({
      usage: "internal_research_only",
      production_publishable: false,
      reason: "MUSE is licensed CC BY-NC 4.0"
    })
  );
  const text = fs.readFileSync(path.join(inputDir, config.file), "utf8");
  let inserted = 0;
  let lineNumber = 0;
  for (const line of text.split(/\r?\n/)) {
    lineNumber += 1;
    if (!line.trim()) continue;
    const columns = line.trim().split(/\s+/);
    if (columns.length !== 2) continue;
    const [left, right] = columns;
    const term = config.direction === "target_to_en" ? left : right;
    const englishGloss = config.direction === "target_to_en" ? right : left;
    if (!term || !englishGloss || hasArtifact(term) || hasArtifact(englishGloss)) continue;
    const result = insertEvidence.run(
      sourceKey,
      config.lang,
      term,
      normalize(term),
      englishGloss,
      normalize(englishGloss),
      `${sourceKey}:${lineNumber}`
    );
    inserted += result.changes;
  }
  counts[sourceKey] = inserted;
});

for (const config of pairConfigs) importPair(config);
db.pragma("wal_checkpoint(TRUNCATE)");
const integrity = db.pragma("integrity_check", { simple: true });
const rows = db.prepare("SELECT COUNT(*) AS count FROM lexical_evidence").get().count;
db.pragma("journal_mode = DELETE");
db.close();

console.log(JSON.stringify({
  ok: integrity === "ok",
  integrity,
  rows,
  base_rows: baseRows,
  sources: counts,
  out: path.relative(process.cwd(), outPath)
}, null, 2));

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();
}

function hasArtifact(value) {
  return /[\uFFFD]|&(?:#\d+|#x[0-9a-f]+|[a-z]+);|<[^>]+>/iu.test(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith("--") ? argv[++index] : "true";
  }
  return parsed;
}
