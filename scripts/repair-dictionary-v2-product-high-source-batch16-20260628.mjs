import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_RISK = "logs/product-published-risk-after-japanese-short-batch15-20260628.json";
const SOURCE = "manual:high-source-batch16-20260628";
const MAX_LINKS_PER_SENSE = 5;

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const riskPath = path.resolve(args.risk || DEFAULT_RISK);
const apply = args.apply === "true";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(riskPath)) throw new Error(`Risk audit not found: ${riskPath}`);

const risk = JSON.parse(fs.readFileSync(riskPath, "utf8"));
const riskSenseIds = (risk.flagged_senses || [])
  .filter((item) => item.issues?.includes("high_source_count_broad_sense"))
  .map((item) => Number(item.sense_id))
  .filter((id) => Number.isInteger(id));

if (riskSenseIds.length !== 51) {
  throw new Error(`Expected 51 high_source_count_broad_sense rows, got ${riskSenseIds.length}`);
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 30000");

const getSense = db.prepare(`
  SELECT ps.id, ps.part_of_speech, ps.gloss_key, pe.headword
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
`);
const getLocalizations = db.prepare(`
  SELECT lang, term, definition
  FROM product_localizations
  WHERE product_sense_id = ?
    AND needs_review = 0
  ORDER BY lang
`);
const getLinks = db.prepare(`
  SELECT id, source_word, source_lang, source_frequency_rank, match_method, confidence
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_frequency_rank IS NULL,
           source_frequency_rank,
           confidence DESC,
           id
`);
const updateSense = db.prepare(`
  UPDATE product_senses
  SET gloss_key = @gloss_key,
      part_of_speech = COALESCE(NULLIF(TRIM(part_of_speech), ''), @part_of_speech),
      confidence = MAX(confidence, 0.9)
  WHERE id = @sense_id
`);
const markSource = db.prepare(`
  UPDATE product_localizations
  SET source = CASE
        WHEN source LIKE '%high-source-batch16-20260628%' THEN source
        ELSE source || '+high-source-batch16-20260628'
      END,
      confidence = MAX(confidence, 0.9)
  WHERE product_sense_id = ?
    AND needs_review = 0
`);
const deleteLink = db.prepare("DELETE FROM product_sense_source_links WHERE id = ?");

const repairs = riskSenseIds.map((senseId) => buildRepair(senseId));
const stats = {
  ok: true,
  apply,
  db: path.relative(process.cwd(), dbPath),
  risk: path.relative(process.cwd(), riskPath),
  repaired_senses: repairs.length,
  links_before: repairs.reduce((sum, repair) => sum + repair.links_before, 0),
  links_after: repairs.reduce((sum, repair) => sum + repair.keep_link_ids.length, 0),
  links_deleted: repairs.reduce((sum, repair) => sum + repair.delete_link_ids.length, 0),
  preview: repairs.slice(0, 12).map((repair) => ({
    sense_id: repair.sense_id,
    headword: repair.headword,
    old_gloss_key: abbreviate(repair.old_gloss_key, 80),
    new_gloss_key: repair.gloss_key,
    links_before: repair.links_before,
    links_after: repair.keep_link_ids.length
  }))
};

const transaction = db.transaction(() => {
  for (const repair of repairs) {
    updateSense.run(repair);
    markSource.run(repair.sense_id);
    for (const linkId of repair.delete_link_ids) deleteLink.run(linkId);
  }
});

if (apply) transaction();

console.log(JSON.stringify(stats, null, 2));
db.close();

function buildRepair(senseId) {
  const sense = getSense.get(senseId);
  if (!sense) throw new Error(`Missing product_sense ${senseId}`);

  const localizations = getLocalizations.all(senseId);
  if (localizations.length !== 4) throw new Error(`Expected 4 localizations for sense ${senseId}, got ${localizations.length}`);

  const locMap = Object.fromEntries(localizations.map((loc) => [loc.lang, loc]));
  const gloss = cleanGloss(locMap.en?.definition || locMap.en?.term || sense.gloss_key || sense.headword);
  const partOfSpeech = inferPartOfSpeech(sense.part_of_speech, gloss);

  const keepTokens = new Set([
    sense.headword,
    ...localizations.map((loc) => loc.term)
  ].map(normalizeToken).filter(Boolean));

  const links = getLinks.all(senseId);
  const ranked = links
    .map((link) => ({
      ...link,
      score: scoreLink(link, keepTokens)
    }))
    .sort((a, b) =>
      b.score - a.score ||
      Number(a.source_frequency_rank == null) - Number(b.source_frequency_rank == null) ||
      Number(a.source_frequency_rank || 999999) - Number(b.source_frequency_rank || 999999) ||
      a.id - b.id
    );

  const keep = ranked.slice(0, Math.min(MAX_LINKS_PER_SENSE, ranked.length));
  const keepIds = new Set(keep.map((link) => link.id));
  const deleteIds = links.map((link) => link.id).filter((id) => !keepIds.has(id));

  return {
    sense_id: senseId,
    headword: sense.headword,
    old_gloss_key: sense.gloss_key,
    gloss_key: gloss,
    part_of_speech: partOfSpeech,
    links_before: links.length,
    keep_link_ids: [...keepIds],
    delete_link_ids: deleteIds
  };
}

function scoreLink(link, keepTokens) {
  const token = normalizeToken(link.source_word);
  let score = 0;
  if (keepTokens.has(token)) score += 100;
  if (link.match_method === "source_headword_fallback") score += 20;
  if (link.match_method === "gloss_to_top_english_headword") score += 10;
  score += Math.max(0, Math.min(10, Number(link.confidence || 0) * 10));
  if (link.source_frequency_rank != null) score += Math.max(0, 10 - Math.log10(Number(link.source_frequency_rank) + 1));
  return score;
}

function cleanGloss(value) {
  let text = String(value || "")
    .replace(/\\n|\r|\n/gu, " ")
    .replace(/\b(?:n|v|a|adj|adv|pron|prep|conj|interj|imp|s|r)\.\s*/giu, "")
    .replace(/\s*;\s*/gu, ", ")
    .replace(/\s+/gu, " ")
    .trim();
  text = text
    .replace(/,\s*,+/gu, ", ")
    .replace(/^[,.\s]+/u, "")
    .replace(/\s+([,.;:!?])/gu, "$1")
    .trim();
  if (!text) return "dictionary sense";
  if (text.length > 180) text = `${text.slice(0, 177).trimEnd()}...`;
  return text;
}

function inferPartOfSpeech(current, gloss) {
  const cleaned = cleanPartOfSpeech(current);
  if (cleaned) return cleaned;
  const lower = String(gloss || "").toLowerCase();
  if (/^to\b/u.test(lower)) return "verb";
  if (/\bpronoun\b/u.test(lower)) return "pronoun";
  if (/\badverb\b/u.test(lower)) return "adverb";
  if (/\badjective\b/u.test(lower)) return "adjective";
  return "noun";
}

function cleanPartOfSpeech(value) {
  return String(value || "")
    .replace(/[&;]/gu, "")
    .trim();
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
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
