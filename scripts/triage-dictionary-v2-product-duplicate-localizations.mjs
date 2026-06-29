import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_OUT = "logs/product-duplicate-localization-triage.json";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const sampleLimit = Number.parseInt(args.samples || "80", 10);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const duplicateGroups = db
  .prepare(
    `
      SELECT pe.id AS entry_id,
             pe.headword,
             pe.primary_lang,
             pe.frequency_rank,
             pl.lang AS duplicate_lang,
             lower(trim(pl.term)) AS duplicate_term,
             lower(trim(pl.definition)) AS duplicate_definition,
             COUNT(*) AS duplicate_count,
             group_concat(ps.id, ',') AS sense_ids
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.status = 'accepted'
        AND COALESCE(pl.needs_review, 0) = 0
        AND COALESCE(trim(pl.term), '') <> ''
        AND COALESCE(trim(pl.definition), '') <> ''
      GROUP BY pe.id, pl.lang, duplicate_term, duplicate_definition
      HAVING COUNT(*) > 1
      ORDER BY pe.frequency_rank IS NULL,
               pe.frequency_rank,
               pe.id,
               pl.lang,
               duplicate_term,
               duplicate_definition
    `
  )
  .all();

const senseStmt = db.prepare(`
  SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.gloss_key, ps.status,
         pe.headword, pe.primary_lang, pe.frequency_rank
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id = ?
`);

const localizationsStmt = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source
  FROM product_localizations
  WHERE product_sense_id = ?
    AND COALESCE(needs_review, 0) = 0
  ORDER BY lang
`);

const sourceLinksStmt = db.prepare(`
  SELECT source_lang, source_word, source_sense_id, match_method, source_frequency_rank
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_lang, lower(source_word), source_sense_id, id
`);

const publicationBlockStmt = db.prepare(`
  SELECT block_code, rationale, recommendation
  FROM product_sense_publication_blocks
  WHERE product_sense_id = ?
  ORDER BY id
`);

const groups = duplicateGroups.map(buildGroup);
const pairReviews = groups.flatMap((group) => group.pair_reviews);
const summary = {
  duplicate_groups: groups.length,
  affected_entries: new Set(groups.map((group) => group.entry_id)).size,
  affected_senses: new Set(groups.flatMap((group) => group.senses.map((sense) => sense.id))).size,
  pair_reviews: pairReviews.length,
  recommendations: countBy(pairReviews.map((pair) => pair.recommendation)),
  duplicate_langs: countBy(groups.map((group) => group.duplicate_lang)),
  safe_auto_merge_pairs: pairReviews.filter((pair) => pair.recommendation === "safe_auto_merge").length,
  needs_llm_review_pairs: pairReviews.filter((pair) => pair.recommendation === "llm_semantic_review").length,
  manual_review_pairs: pairReviews.filter((pair) => pair.recommendation === "manual_review").length,
  likely_keep_pairs: pairReviews.filter((pair) => pair.recommendation === "likely_keep").length
};

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary,
  priority_samples: pairReviews.slice(0, Number.isFinite(sampleLimit) ? sampleLimit : 80),
  groups
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary
    },
    null,
    2
  )
);

function buildGroup(row) {
  const senseIds = unique(row.sense_ids.split(",").map((id) => Number.parseInt(id, 10))).sort((a, b) => a - b);
  const senses = senseIds.map(loadSense);
  const pairReviews = [];
  for (let i = 0; i < senses.length; i++) {
    for (let j = i + 1; j < senses.length; j++) {
      pairReviews.push(classifyPair(row, senses[i], senses[j]));
    }
  }
  return {
    entry_id: row.entry_id,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    duplicate_lang: row.duplicate_lang,
    duplicate_term: row.duplicate_term,
    duplicate_definition: row.duplicate_definition,
    duplicate_count: row.duplicate_count,
    senses,
    pair_reviews: pairReviews
  };
}

function loadSense(id) {
  const sense = senseStmt.get(id);
  if (!sense) throw new Error(`Missing product_sense ${id}`);
  const localizations = localizationsStmt.all(id);
  const localizationsByLang = Object.fromEntries(localizations.map((row) => [row.lang, row]));
  const sourceLinks = sourceLinksStmt.all(id);
  const publicationBlocks = publicationBlockStmt.all(id);
  return {
    ...sense,
    localizations,
    localizations_by_lang: localizationsByLang,
    source_links: sourceLinks,
    publication_blocks: publicationBlocks
  };
}

function classifyPair(group, left, right) {
  const metrics = compareSenses(left, right);
  const reasons = [];
  let recommendation = "manual_review";

  if (metrics.term_definition_matches === LANGS.length) {
    recommendation = "safe_auto_merge";
    reasons.push("all four language terms and definitions match exactly");
  } else if (metrics.term_matches === LANGS.length && metrics.definition_matches >= 3 && metrics.source_overlap > 0) {
    recommendation = "llm_semantic_review";
    reasons.push("all four terms match, most definitions match, and source evidence overlaps");
  } else if (metrics.term_definition_matches >= 3 && metrics.source_overlap > 0) {
    recommendation = "llm_semantic_review";
    reasons.push("three language term-definition pairs match and source evidence overlaps");
  } else if (metrics.term_definition_matches <= 1 && metrics.other_lang_term_differences >= 2) {
    recommendation = "likely_keep";
    reasons.push("only the duplicate language matches while other localized terms diverge");
  } else if (metrics.source_overlap === 0 && metrics.other_lang_definition_differences >= 2) {
    recommendation = "likely_keep";
    reasons.push("no source overlap and multiple other-language definitions diverge");
  } else if (metrics.duplicate_lang_reading_differs) {
    recommendation = "likely_keep";
    reasons.push("duplicate-language reading or pronunciation differs");
  } else {
    reasons.push("ambiguous partial duplicate; inspect before merge");
  }

  return {
    pair_key: `${left.id}:${right.id}`,
    entry_id: group.entry_id,
    headword: group.headword,
    primary_lang: group.primary_lang,
    frequency_rank: group.frequency_rank,
    duplicate_lang: group.duplicate_lang,
    duplicate_term: group.duplicate_term,
    duplicate_definition: group.duplicate_definition,
    left_sense_id: left.id,
    right_sense_id: right.id,
    recommendation,
    reasons,
    metrics,
    senses: [summarizeSense(left), summarizeSense(right)]
  };
}

function compareSenses(left, right) {
  let termMatches = 0;
  let definitionMatches = 0;
  let termDefinitionMatches = 0;
  let otherLangTermDifferences = 0;
  let otherLangDefinitionDifferences = 0;
  const perLang = {};

  for (const lang of LANGS) {
    const a = left.localizations_by_lang[lang];
    const b = right.localizations_by_lang[lang];
    const sameTerm = norm(a?.term) === norm(b?.term) && norm(a?.term) !== "";
    const sameDefinition = norm(a?.definition) === norm(b?.definition) && norm(a?.definition) !== "";
    if (sameTerm) termMatches++;
    if (sameDefinition) definitionMatches++;
    if (sameTerm && sameDefinition) termDefinitionMatches++;
    if (!sameTerm) otherLangTermDifferences++;
    if (!sameDefinition) otherLangDefinitionDifferences++;
    perLang[lang] = {
      same_term: sameTerm,
      same_definition: sameDefinition,
      left_term: a?.term || "",
      right_term: b?.term || "",
      left_definition: a?.definition || "",
      right_definition: b?.definition || ""
    };
  }

  const duplicateLang = Object.keys(perLang).find((lang) => perLang[lang].same_term && perLang[lang].same_definition);
  const duplicateLangReadingDiffers = duplicateLang
    ? readingSignature(left.localizations_by_lang[duplicateLang]) !== readingSignature(right.localizations_by_lang[duplicateLang])
    : false;

  return {
    term_matches: termMatches,
    definition_matches: definitionMatches,
    term_definition_matches: termDefinitionMatches,
    other_lang_term_differences: otherLangTermDifferences,
    other_lang_definition_differences: otherLangDefinitionDifferences,
    source_overlap: sourceOverlap(left, right),
    same_part_of_speech: norm(left.part_of_speech) === norm(right.part_of_speech),
    duplicate_lang_reading_differs: duplicateLangReadingDiffers,
    per_lang: perLang
  };
}

function sourceOverlap(left, right) {
  const leftKeys = new Set(left.source_links.map(sourceKey));
  return right.source_links.filter((row) => leftKeys.has(sourceKey(row))).length;
}

function sourceKey(row) {
  return [norm(row.source_lang), norm(row.source_word), norm(row.source_sense_id)].join("\t");
}

function readingSignature(row) {
  if (!row) return "";
  return [norm(row.reading), norm(row.reading_system), norm(row.pronunciation), norm(row.pronunciation_system)].join("\t");
}

function summarizeSense(sense) {
  return {
    id: sense.id,
    sense_order: sense.sense_order,
    part_of_speech: sense.part_of_speech,
    gloss_key: sense.gloss_key,
    publication_blocks: sense.publication_blocks,
    localizations: Object.fromEntries(
      LANGS.map((lang) => {
        const row = sense.localizations_by_lang[lang] || {};
        return [
          lang,
          {
            term: row.term || "",
            reading: row.reading || "",
            pronunciation: row.pronunciation || "",
            definition: row.definition || ""
          }
        ];
      })
    ),
    source_links: sense.source_links
  };
}

function norm(value) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
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
