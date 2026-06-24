import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_OUT = "logs/product-semantic-duplicate-review-20260624.json";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const markdownPath = args.markdown ? path.resolve(args.markdown) : outPath.replace(/\.json$/u, ".md");
const sampleLimit = Number.parseInt(args.samples || "80", 10);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const duplicateRows = db
  .prepare(
    `
      SELECT pe.id AS entry_id,
             pe.headword,
             pe.primary_lang,
             pe.frequency_rank,
             pl.lang,
             lower(trim(pl.term)) AS term_key,
             lower(trim(pl.definition)) AS definition_key,
             COUNT(*) AS duplicate_count,
             group_concat(ps.id, ',') AS sense_ids
      FROM product_entries pe
      JOIN product_senses ps ON ps.product_entry_id = pe.id
      JOIN product_localizations pl ON pl.product_sense_id = ps.id
      WHERE ps.status = 'accepted'
        AND COALESCE(pl.needs_review, 0) = 0
        AND COALESCE(trim(pl.term), '') <> ''
        AND COALESCE(trim(pl.definition), '') <> ''
      GROUP BY pe.id, pl.lang, term_key, definition_key
      HAVING COUNT(*) > 1
      ORDER BY pe.frequency_rank IS NULL,
               pe.frequency_rank,
               pe.id,
               pl.lang,
               term_key,
               definition_key
    `
  )
  .all();

const senseById = db.prepare(`
  SELECT id, product_entry_id, sense_order, part_of_speech, gloss_key, status
  FROM product_senses
  WHERE id = ?
`);
const localizationsBySense = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source
  FROM product_localizations
  WHERE product_sense_id = ?
    AND COALESCE(needs_review, 0) = 0
  ORDER BY lang
`);
const sourceLinksBySense = db.prepare(`
  SELECT source_lang, source_word, source_sense_id, match_method, source_frequency_rank
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_lang, lower(source_word), source_sense_id, id
`);

const groups = duplicateRows.map((row) => {
  const senseIds = unique(row.sense_ids.split(",").map((id) => Number.parseInt(id, 10))).sort((a, b) => a - b);
  const senses = senseIds.map((id) => describeSense(id));
  const pairFeatures = compareSenses(senses);
  const mojibakeHits = senses.flatMap((sense) => collectMojibakeHits(sense));
  const review = classifyReview({ row, senses, pairFeatures, mojibakeHits });
  return {
    pair_key: senseIds.join(":"),
    entry_id: row.entry_id,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    duplicate_lang: row.lang,
    duplicate_term: row.term_key,
    duplicate_definition: row.definition_key,
    duplicate_count: row.duplicate_count,
    review,
    pair_features: pairFeatures,
    mojibake_hits: mojibakeHits.slice(0, 12),
    senses: senses.map(summarizeSense)
  };
});

const byRecommendation = countBy(groups.map((group) => group.review.recommendation));
const byReason = countBy(groups.map((group) => group.review.primary_reason));
const reviewOrder = {
  encoding_repair_first: 0,
  llm_semantic_review: 1,
  manual_keep_or_merge_review: 2,
  likely_keep_separate: 3
};
groups.sort((a, b) => {
  const priorityDiff = (reviewOrder[a.review.recommendation] ?? 9) - (reviewOrder[b.review.recommendation] ?? 9);
  if (priorityDiff) return priorityDiff;
  const rankA = a.frequency_rank ?? Number.MAX_SAFE_INTEGER;
  const rankB = b.frequency_rank ?? Number.MAX_SAFE_INTEGER;
  if (rankA !== rankB) return rankA - rankB;
  return a.entry_id - b.entry_id;
});
const pairReview = summarizePairs(groups);

const report = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary: {
    duplicate_groups: groups.length,
    unique_sense_pairs: pairReview.pairs.length,
    affected_entries: new Set(groups.map((group) => group.entry_id)).size,
    affected_senses: new Set(groups.flatMap((group) => group.senses.map((sense) => sense.id))).size,
    by_recommendation: byRecommendation,
    by_reason: byReason,
    unique_pairs_by_recommendation: countBy(pairReview.pairs.map((pair) => pair.recommendation))
  },
  pair_review: pairReview.pairs,
  samples: groups.slice(0, Number.isFinite(sampleLimit) ? sampleLimit : 80),
  groups
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(markdownPath, renderMarkdown(report, sampleLimit), "utf8");
db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      markdown: path.relative(process.cwd(), markdownPath),
      summary: report.summary
    },
    null,
    2
  )
);

function describeSense(id) {
  const sense = senseById.get(id);
  if (!sense) throw new Error(`Missing product_sense ${id}`);
  const localizations = localizationsBySense.all(id);
  const sourceLinks = sourceLinksBySense.all(id);
  return {
    ...sense,
    localizations,
    source_links: sourceLinks,
    terms_by_lang: Object.fromEntries(localizations.map((row) => [row.lang, norm(row.term)])),
    definitions_by_lang: Object.fromEntries(localizations.map((row) => [row.lang, norm(row.definition)]))
  };
}

function compareSenses(senses) {
  const features = {
    shared_source_links: countSourceOverlaps(senses),
    same_pos: unique(senses.map((sense) => norm(sense.part_of_speech))).length === 1,
    same_gloss_key: unique(senses.map((sense) => norm(sense.gloss_key))).length === 1,
    matching_terms_by_lang: {},
    matching_definitions_by_lang: {}
  };
  for (const lang of LANGS) {
    const terms = senses.map((sense) => sense.terms_by_lang[lang]).filter(Boolean);
    const definitions = senses.map((sense) => sense.definitions_by_lang[lang]).filter(Boolean);
    features.matching_terms_by_lang[lang] = terms.length === senses.length && unique(terms).length === 1;
    features.matching_definitions_by_lang[lang] = definitions.length === senses.length && unique(definitions).length === 1;
  }
  features.matching_term_langs = Object.entries(features.matching_terms_by_lang)
    .filter(([, matches]) => matches)
    .map(([lang]) => lang);
  features.matching_definition_langs = Object.entries(features.matching_definitions_by_lang)
    .filter(([, matches]) => matches)
    .map(([lang]) => lang);
  return features;
}

function classifyReview({ row, senses, pairFeatures, mojibakeHits }) {
  if (mojibakeHits.length >= 2 || mojibakeHits.some((hit) => hit.score >= 3)) {
    return {
      recommendation: "encoding_repair_first",
      primary_reason: "mojibake_detected",
      note: "Fix encoded/corrupted localization text before deciding whether these senses are semantically duplicate."
    };
  }
  if (pairFeatures.shared_source_links > 0 || pairFeatures.matching_definition_langs.length >= 2) {
    return {
      recommendation: "llm_semantic_review",
      primary_reason: pairFeatures.shared_source_links > 0 ? "source_overlap" : "multiple_matching_definitions",
      note: "Likely duplicate enough for model-assisted keep/merge review, but not safe for deterministic merge."
    };
  }
  if (pairFeatures.matching_term_langs.length >= 2 || row.duplicate_count > 2) {
    return {
      recommendation: "manual_keep_or_merge_review",
      primary_reason: pairFeatures.matching_term_langs.length >= 2 ? "multiple_matching_terms" : "multi_sense_duplicate_group",
      note: "Terms overlap but definitions or source evidence differ; review in context."
    };
  }
  return {
    recommendation: "likely_keep_separate",
    primary_reason: "single_language_overlap_only",
    note: "Only one localization row overlaps; this is often a legitimate polysemy or translation collision."
  };
}

function summarizeSense(sense) {
  return {
    id: sense.id,
    sense_order: sense.sense_order,
    part_of_speech: sense.part_of_speech,
    gloss_key: sense.gloss_key,
    localizations: Object.fromEntries(
      LANGS.map((lang) => {
        const row = sense.localizations.find((loc) => loc.lang === lang);
        return [
          lang,
          row
            ? {
                term: row.term,
                reading: row.reading,
                pronunciation: row.pronunciation,
                definition: row.definition,
                source: row.source
              }
            : null
        ];
      })
    ),
    source_links: sense.source_links
  };
}

function countSourceOverlaps(senses) {
  const seen = new Map();
  let overlaps = 0;
  for (const sense of senses) {
    for (const link of sense.source_links) {
      const key = [link.source_lang, norm(link.source_word), link.source_sense_id].join("\t");
      if (!key.trim()) continue;
      if (seen.has(key) && seen.get(key) !== sense.id) overlaps++;
      else seen.set(key, sense.id);
    }
  }
  return overlaps;
}

function collectMojibakeHits(sense) {
  const hits = [];
  for (const loc of sense.localizations) {
    for (const field of ["term", "reading", "pronunciation", "definition"]) {
      const value = loc[field];
      const score = mojibakeScore(value);
      if (score > 0) hits.push({ sense_id: sense.id, lang: loc.lang, field, score, value: String(value).slice(0, 120) });
    }
  }
  return hits;
}

function mojibakeScore(value) {
  const text = String(value || "");
  if (!text) return 0;
  let score = 0;
  if (/[�锟]/u.test(text)) score += 4;
  if (/[銇銈銉]/u.test(text)) score += 3;
  if (/[鑹鑰鍏涓锛紝]/u.test(text)) score += 2;
  if (/[猫贸蓻蕘蕩藞]/u.test(text)) score += 1;
  if (/[A-Za-z][蓻蕘蕩藞]/u.test(text)) score += 2;
  return score;
}

function renderMarkdown(report, sampleLimit) {
  const lines = [
    "# Product Semantic Duplicate Review",
    "",
    `Generated: ${report.generated_at}`,
    "",
    "## Summary",
    "",
    `- Duplicate groups: ${report.summary.duplicate_groups}`,
    `- Unique sense pairs: ${report.summary.unique_sense_pairs}`,
    `- Affected entries: ${report.summary.affected_entries}`,
    `- Affected senses: ${report.summary.affected_senses}`,
    `- By recommendation: ${JSON.stringify(report.summary.by_recommendation)}`,
    `- Unique pairs by recommendation: ${JSON.stringify(report.summary.unique_pairs_by_recommendation)}`,
    `- By reason: ${JSON.stringify(report.summary.by_reason)}`,
    "",
    "## Unique Sense Pairs",
    "",
    "| Entry | Rank | Recommendation | Reasons | Duplicate Langs | Senses | Headword |",
    "| --- | ---: | --- | --- | --- | --- | --- |"
  ];
  for (const pair of report.pair_review.slice(0, Number.isFinite(sampleLimit) ? sampleLimit : 80)) {
    lines.push(
      `| ${pair.entry_id} | ${pair.frequency_rank ?? ""} | ${pair.recommendation} | ${pair.reasons.join(", ")} | ${pair.duplicate_langs.join(", ")} | ${pair.sense_ids.join(", ")} | ${escapeCell(pair.headword)} |`
    );
  }
  lines.push(
    "",
    "## Review Queue",
    "",
    "| Entry | Rank | Lang | Recommendation | Reason | Senses | Headword |",
    "| --- | ---: | --- | --- | --- | --- | --- |"
  );
  for (const group of report.groups.slice(0, Number.isFinite(sampleLimit) ? sampleLimit : 80)) {
    lines.push(
      `| ${group.entry_id} | ${group.frequency_rank ?? ""} | ${group.duplicate_lang} | ${group.review.recommendation} | ${group.review.primary_reason} | ${group.senses.map((sense) => `${sense.id}#${sense.sense_order}`).join(", ")} | ${escapeCell(group.headword)} |`
    );
  }
  lines.push("", "## First Samples", "");
  for (const group of report.groups.slice(0, Math.min(20, sampleLimit))) {
    lines.push(`### ${group.headword} (${group.entry_id}) - ${group.review.recommendation}`);
    lines.push("");
    lines.push(`Duplicate ${group.duplicate_lang}: ${group.duplicate_term}`);
    lines.push("");
    for (const sense of group.senses) {
      const en = sense.localizations.en;
      const zh = sense.localizations.zh;
      const ja = sense.localizations.ja;
      lines.push(`- sense ${sense.id} order ${sense.sense_order}: ${sense.gloss_key || ""}`);
      lines.push(`  - en: ${en?.term || ""} | ${en?.definition || ""}`);
      lines.push(`  - zh: ${zh?.term || ""} | ${zh?.definition || ""}`);
      lines.push(`  - ja: ${ja?.term || ""} | ${ja?.definition || ""}`);
    }
    if (group.mojibake_hits.length) {
      lines.push(`- mojibake hits: ${group.mojibake_hits.map((hit) => `${hit.lang}.${hit.field}`).join(", ")}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function summarizePairs(groups) {
  const byPair = new Map();
  for (const group of groups) {
    const existing = byPair.get(group.pair_key);
    if (!existing) {
      byPair.set(group.pair_key, {
        pair_key: group.pair_key,
        entry_id: group.entry_id,
        headword: group.headword,
        primary_lang: group.primary_lang,
        frequency_rank: group.frequency_rank,
        sense_ids: group.senses.map((sense) => sense.id),
        sense_orders: group.senses.map((sense) => sense.sense_order),
        duplicate_langs: [group.duplicate_lang],
        recommendation: group.review.recommendation,
        reasons: [group.review.primary_reason],
        duplicate_groups: 1
      });
      continue;
    }
    existing.duplicate_langs = unique([...existing.duplicate_langs, group.duplicate_lang]);
    existing.reasons = unique([...existing.reasons, group.review.primary_reason]);
    existing.duplicate_groups++;
    if (recommendationPriority(group.review.recommendation) < recommendationPriority(existing.recommendation)) {
      existing.recommendation = group.review.recommendation;
    }
  }
  const pairs = [...byPair.values()];
  pairs.sort((a, b) => {
    const priorityDiff = recommendationPriority(a.recommendation) - recommendationPriority(b.recommendation);
    if (priorityDiff) return priorityDiff;
    const rankA = a.frequency_rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.frequency_rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.entry_id - b.entry_id;
  });
  return { pairs };
}

function recommendationPriority(value) {
  const order = {
    encoding_repair_first: 0,
    llm_semantic_review: 1,
    manual_keep_or_merge_review: 2,
    likely_keep_separate: 3
  };
  return order[value] ?? 9;
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

function escapeCell(value) {
  return String(value ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, " ");
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
