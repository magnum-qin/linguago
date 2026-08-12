import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath("report");
const historyPath = requiredPath("history");
const freshPath = requiredPath("fresh");
const productDbPath = requiredPath("product-db");
const ptPronunciationDbPath = requiredPath("pt-pronunciation-db");
const outPath = path.resolve(
  args.out || "logs/product-source-gap-evidence-upgrade-revalidation.json"
);
const limit = boundedInteger(args.limit, 20, 1);
const offset = boundedInteger(args.offset, 0, 0);
const KNOWN_SEMANTIC_RESIDUALS = new Set([
  "pt-BR|dobragem|dubbing",
  "pt-BR|excreção|excretion"
]);

const report = readJson(reportPath);
const history = readJson(historyPath);
const fresh = readJson(freshPath);
const rows = Array.isArray(report.selected) ? report.selected : [];
const historyRows = Array.isArray(history.selected) ? history.selected : [];
const freshRows = Array.isArray(fresh.selected) ? fresh.selected : [];
const historyByEntry = new Map(historyRows.map((row) => [String(row.source_entry_id), row]));
const freshEntries = new Set(freshRows.map((row) => String(row.source_entry_id)));
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
productDb.pragma("query_only = ON");
const findLinkedProductSense = productDb.prepare(`
  SELECT ps.id, ps.status
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  WHERE link.source_sense_id = ?
    AND ps.status IN ('accepted', 'draft_single_source')
  LIMIT 1
`);
const ptPronunciationDb = new Database(ptPronunciationDbPath, {
  readonly: true,
  fileMustExist: true
});
ptPronunciationDb.pragma("query_only = ON");
const findBrazilianPortuguesePronunciation = ptPronunciationDb.prepare(`
  SELECT 1
  FROM portuguese_pronunciations
  WHERE normalized_key = ?
    AND region IN ('Brazil', 'São-Paulo', 'Rio-de-Janeiro', 'Caipira',
                   'Southern-Brazil', 'Northeast-Brazil')
  LIMIT 1
`);

const eligible = rows
  .filter(hasSingleHintPerLanguage)
  .filter((row) => !findLinkedProductSense.get(Number(row.first_sense_id)))
  .filter(hasRequiredBrazilianPortugueseEvidence)
  .filter((row) => !KNOWN_SEMANTIC_RESIDUALS.has(semanticResidualKey(row)))
  .map((row) => {
    const historyRow = historyByEntry.get(String(row.source_entry_id));
    const wasInFreshSnapshot = freshEntries.has(String(row.source_entry_id));
    const evidence = new Set(historyRow?.evidence || []);
    if (evidence.has("review_reject")) return null;
    const isFresh = wasInFreshSnapshot && !historyRow;
    const qidLock = row.reverse_evidence_prefilter?.wikidata_hint_lock;
    if (!isFresh && !qidLock?.locked) return null;
    return {
      ...row,
      evidence_upgrade_revalidation: {
        cohort: isFresh ? "fresh" : "unique_wikidata_qid_revalidation",
        reason: isFresh
          ? "not_present_in_historical_attempt_index"
          : "new_unique_wikidata_qid_after_nonquality_historical_attempt",
        wikidata_concept_id: qidLock?.concept_id || null,
        historical_evidence: historyRow?.evidence || [],
        historical_attempts: historyRow?.attempts || 0,
        historical_files: historyRow?.files || []
      }
    };
  })
  .filter(Boolean)
  .sort(compareRows);

const selected = eligible.slice(offset, offset + limit);
const summary = {
  input_rows: rows.length,
  current_product_unlinked_rows: rows.filter(
    (row) => !findLinkedProductSense.get(Number(row.first_sense_id))
  ).length,
  locale_or_semantic_residual_rows: rows.filter(
    (row) =>
      !hasRequiredBrazilianPortugueseEvidence(row) ||
      KNOWN_SEMANTIC_RESIDUALS.has(semanticResidualKey(row))
  ).length,
  eligible_rows: eligible.length,
  selected_rows: selected.length,
  offset,
  selected_fresh: selected.filter(
    (row) => row.evidence_upgrade_revalidation.cohort === "fresh"
  ).length,
  selected_revalidation: selected.filter(
    (row) => row.evidence_upgrade_revalidation.cohort !== "fresh"
  ).length,
  excluded_review_rejects: rows.filter((row) =>
    (historyByEntry.get(String(row.source_entry_id))?.evidence || []).includes("review_reject")
  ).length,
  stale_fresh_snapshot_rows: rows.filter((row) => {
    const entryId = String(row.source_entry_id);
    return freshEntries.has(entryId) && historyByEntry.has(entryId);
  }).length,
  require_single_hint_per_language: true,
  revalidation_requires_unique_wikidata_qid: true
};
const output = {
  ok: selected.length === limit,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  history_report: relative(historyPath),
  fresh_report: relative(freshPath),
  product_db: relative(productDbPath),
  pt_pronunciation_db: relative(ptPronunciationDbPath),
  policy: {
    fresh_candidates_first: true,
    historical_review_rejects_excluded: true,
    historical_revalidation_requires_unique_wikidata_qid: true,
    current_product_links_excluded: true,
    pt_br_source_requires_brazilian_pronunciation: true,
    confirmed_source_anchor_residuals_excluded: true,
    historical_generation_or_transport_failures_may_be_revalidated: true,
    offset,
    publication_evidence: false
  },
  summary,
  selected_count: selected.length,
  selected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
productDb.close();
ptPronunciationDb.close();
console.log(JSON.stringify({ ok: output.ok, out: relative(outPath), summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function hasSingleHintPerLanguage(row) {
  const hints = row.generation_hints || {};
  return ["en", "pt-BR", "zh", "ja"].every(
    (lang) => Array.isArray(hints[lang]?.terms) && hints[lang].terms.length === 1
  );
}

function hasRequiredBrazilianPortugueseEvidence(row) {
  if (row.source_lang !== "pt-BR") return true;
  return Boolean(
    findBrazilianPortuguesePronunciation.get(normalize(row.word))
  );
}

function semanticResidualKey(row) {
  return [row.source_lang, normalize(row.word), englishAnchor(row)].join("|");
}

function englishAnchor(row) {
  const hinted = row.generation_hints?.en?.terms?.[0];
  if (hinted) return normalize(hinted);
  return normalize(String(row.gloss_key || "").replace(/^en:\s*/iu, "").split(";")[0]);
}

function normalize(value) {
  return String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR");
}

function compareRows(left, right) {
  const leftFresh = left.evidence_upgrade_revalidation.cohort === "fresh";
  const rightFresh = right.evidence_upgrade_revalidation.cohort === "fresh";
  if (leftFresh !== rightFresh) return leftFresh ? -1 : 1;
  const attemptDifference =
    left.evidence_upgrade_revalidation.historical_attempts -
    right.evidence_upgrade_revalidation.historical_attempts;
  if (attemptDifference) return attemptDifference;
  return Number(left.frequency_rank || Number.MAX_SAFE_INTEGER) -
    Number(right.frequency_rank || Number.MAX_SAFE_INTEGER);
}

function requiredPath(name) {
  if (!args[name]) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(args[name]);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function boundedInteger(value, fallback, minimum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    result[key] = value && !value.startsWith("--") ? argv[++index] : "true";
  }
  return result;
}
