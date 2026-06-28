import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_TRIAGE = "logs/product-broad-risk-triage-batch13-20260628.json";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const triagePath = path.resolve(args.triage || DEFAULT_TRIAGE);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(triagePath)) throw new Error(`Triage report not found: ${triagePath}`);

const triage = JSON.parse(fs.readFileSync(triagePath, "utf8"));
const repairs = (triage.rows || [])
  .filter((row) => row.triage?.recommendation === "likely_keep")
  .map((row) => {
    const gloss = buildGloss(row);
    return {
      sense_id: Number(row.sense_id),
      headword: row.headword,
      old_gloss_key: row.gloss_key,
      new_gloss_key: gloss
    };
  });

if (!repairs.length) throw new Error("No likely_keep rows found");

const db = new Database(dbPath);
db.pragma("busy_timeout = 30000");

const updateSense = db.prepare(`
  UPDATE product_senses
  SET gloss_key = ?,
      confidence = MAX(confidence, 0.9)
  WHERE id = ?
`);

const verifySense = db.prepare("SELECT id FROM product_senses WHERE id = ?");

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    if (!verifySense.get(repair.sense_id)) throw new Error(`Missing product_sense ${repair.sense_id}`);
    const result = updateSense.run(repair.new_gloss_key, repair.sense_id);
    if (result.changes !== 1) throw new Error(`Failed to update product_sense ${repair.sense_id}`);
  }
});

if (apply) transaction();

const preview = repairs.slice(0, 20).map((repair) => ({
  sense_id: repair.sense_id,
  headword: repair.headword,
  old_gloss_key: abbreviate(repair.old_gloss_key, 120),
  new_gloss_key: repair.new_gloss_key
}));

console.log(
  JSON.stringify(
    {
      ok: true,
      apply,
      db: path.relative(process.cwd(), dbPath),
      triage: path.relative(process.cwd(), triagePath),
      repaired_count: repairs.length,
      preview
    },
    null,
    2
  )
);

db.close();

function buildGloss(row) {
  const en = row.localizations?.en || {};
  const candidates = [
    en.definition,
    en.term,
    row.gloss_key,
    row.headword
  ];

  for (const candidate of candidates) {
    const cleaned = cleanGloss(candidate);
    if (cleaned) return cleaned;
  }
  return cleanGloss(row.headword) || `dictionary sense for ${row.sense_id}`;
}

function cleanGloss(value) {
  let text = String(value || "")
    .replace(/\\n|\r|\n/gu, " ")
    .replace(/\b(?:n|v|a|adj|adv|pron|prep|conj|interj|imp|s|r)\.\s*/giu, "")
    .replace(/\s*;\s*/gu, ", ")
    .replace(/\s*--\s*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  text = text
    .replace(/,\s*,+/gu, ", ")
    .replace(/^[,.\s]+/u, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();

  if (!text) return "";
  if (text.length > 180) text = `${text.slice(0, 177).trimEnd()}...`;
  return text;
}

function abbreviate(value, maxLength) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = "true";
    }
  }
  return parsed;
}
