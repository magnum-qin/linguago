#!/usr/bin/env node

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!args.report || !args.out) {
  throw new Error("Usage: --report <manual-review.json> --out <annotated.json> [--db <product.db>]");
}

const dbPath = path.resolve(
  args.db || "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db"
);
const reportPath = path.resolve(args.report);
const outPath = path.resolve(args.out);
for (const filePath of [dbPath, reportPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma("query_only = ON");

const findLinked = db.prepare(`
  SELECT pe.id AS entry_id, pe.headword, pe.primary_lang, pe.status AS entry_status,
         ps.id AS sense_id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         ps.status AS sense_status, link.match_method
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE link.source_entry_id = ? AND link.source_sense_id = ?
  ORDER BY ps.status = 'accepted' DESC, pe.frequency_rank, ps.sense_order
`);
const findHeadword = db.prepare(`
  SELECT pe.id AS entry_id, pe.headword, pe.primary_lang, pe.status AS entry_status,
         ps.id AS sense_id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         ps.status AS sense_status
  FROM product_entries pe
  JOIN product_senses ps ON ps.product_entry_id = pe.id
  WHERE pe.normalized_key = ? AND pe.primary_lang = ?
  ORDER BY ps.status = 'accepted' DESC, pe.frequency_rank, ps.sense_order
  LIMIT 20
`);
const findLocalization = db.prepare(`
  SELECT pe.id AS entry_id, pe.headword, pe.primary_lang, pe.status AS entry_status,
         ps.id AS sense_id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         ps.status AS sense_status, pl.lang, pl.term
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pl.lang = ? AND lower(pl.term) = ?
  ORDER BY ps.status = 'accepted' DESC, pe.frequency_rank, ps.sense_order
  LIMIT 20
`);

const selected = (report.selected || []).map((row) => {
  const sourceSenseId = Number(row.first_sense_id ?? row.source_sense_id);
  const sourceEntryId = Number(row.source_entry_id);
  const normalizedWord = normalize(row.normalized_key || row.word);
  const linked = findLinked.all(sourceEntryId, sourceSenseId);
  const headwordMatches = findHeadword.all(normalizedWord, row.source_lang);
  const localizationMatches = findLocalization.all(row.source_lang, normalizedWord);
  return {
    ...row,
    existing_product: {
      classification: classify(linked, headwordMatches, localizationMatches),
      exact_source_sense_links: linked,
      same_headword_senses: headwordMatches,
      localization_term_senses: localizationMatches
    }
  };
});
db.close();

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  annotated_product_db: path.relative(process.cwd(), dbPath),
  selected_count: selected.length,
  selected,
  existing_product_summary: countBy(
    selected.map((row) => row.existing_product.classification)
  )
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  out: path.relative(process.cwd(), outPath),
  summary: output.existing_product_summary,
  rows: selected.map((row) => ({
    word: row.word,
    lang: row.source_lang,
    rank: row.frequency_rank,
    classification: row.existing_product.classification
  }))
}, null, 2));

function classify(linked, headwordMatches, localizationMatches) {
  if (linked.some((row) => row.sense_status === "accepted")) return "already_linked_accepted";
  if (linked.length) return "already_linked_nonaccepted";
  if (headwordMatches.some((row) => row.sense_status === "accepted")) return "same_headword_needs_sense_review";
  if (localizationMatches.some((row) => row.sense_status === "accepted")) return "existing_localization_needs_link_review";
  return "genuinely_missing";
}

function normalize(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("und").trim();
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) continue;
    result[argv[index].slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}
