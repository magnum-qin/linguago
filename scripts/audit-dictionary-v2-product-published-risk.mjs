import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const DEFAULT_OUT = "data/processed/product-published-risk-audit.json";
const LANGS = ["en", "pt-BR", "zh", "ja"];

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const sampleLimit = boundedLimit(args.samples || 20, 1, 100);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
db.pragma("busy_timeout = 30000");

const rows = db
  .prepare(
    `
    SELECT
      pe.id AS entry_id,
      pe.headword,
      pe.primary_lang,
      pe.frequency_rank,
      pe.group_method,
      pe.source_count AS entry_source_count,
      pe.lang_count,
      ps.id AS sense_id,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.confidence,
      (
        SELECT COUNT(*)
        FROM product_sense_source_links l
        WHERE l.product_sense_id = ps.id
      ) AS sense_source_count,
      (
        SELECT group_concat(DISTINCT l.source_lang)
        FROM product_sense_source_links l
        WHERE l.product_sense_id = ps.id
      ) AS source_langs,
      (
        SELECT group_concat(DISTINCT l.source_word)
        FROM product_sense_source_links l
        WHERE l.product_sense_id = ps.id
      ) AS source_words
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    WHERE ps.status = 'accepted'
      AND (
        pe.source_count >= 6
        OR length(trim(ps.gloss_key)) <= 3
        OR ps.gloss_key LIKE '%\\n%'
        OR ps.gloss_key LIKE '%;%;%'
      )
    ORDER BY pe.frequency_rank IS NULL,
             pe.frequency_rank,
             pe.source_count DESC,
             ps.sense_order,
             ps.id
  `
  )
  .all();

const localizationStmt = db.prepare(`
  SELECT lang, term, reading, pronunciation, definition, source, confidence
  FROM product_localizations
  WHERE product_sense_id = ?
  ORDER BY lang
`);

const sourceLinkStmt = db.prepare(`
  SELECT source_lang, source_word, source_frequency_rank, match_method, confidence
  FROM product_sense_source_links
  WHERE product_sense_id = ?
  ORDER BY source_frequency_rank IS NULL, source_frequency_rank, source_lang, source_word, id
  LIMIT 12
`);

const buckets = new Map();
const allFlagged = [];

for (const row of rows) {
  const localizations = localizationStmt.all(row.sense_id);
  const localizationMap = Object.fromEntries(localizations.map((item) => [item.lang, item]));
  const issues = classifyRisk(row, localizationMap);
  if (!issues.length) continue;

  const sample = {
    entry_id: row.entry_id,
    sense_id: row.sense_id,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    sense_order: row.sense_order,
    part_of_speech: cleanPartOfSpeech(row.part_of_speech),
    gloss_key: abbreviate(row.gloss_key, 260),
    entry_source_count: row.entry_source_count,
    sense_source_count: row.sense_source_count,
    source_langs: splitCsv(row.source_langs),
    source_words: splitCsv(row.source_words).slice(0, 16),
    localizations: compactLocalizations(localizationMap),
    source_links: sourceLinkStmt.all(row.sense_id)
  };

  allFlagged.push({ ...sample, issues });
  for (const issue of issues) pushBucket(buckets, issue, sample);
}

const summary = {
  accepted_senses: db.prepare("SELECT COUNT(*) AS n FROM product_senses WHERE status = 'accepted'").get().n,
  candidate_rows_scanned: rows.length,
  flagged_senses: allFlagged.length,
  buckets: Object.fromEntries([...buckets.entries()].map(([key, value]) => [key, value.count]))
};

const result = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  generated_at: new Date().toISOString(),
  summary,
  issue_buckets: summarizeBuckets(buckets, sampleLimit),
  recommended_next_steps: recommend(summary)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      summary,
      recommended_next_steps: result.recommended_next_steps
    },
    null,
    2
  )
);

db.close();

function classifyRisk(row, localizations) {
  const issues = [];
  const gloss = String(row.gloss_key || "");
  const normalizedGloss = gloss.toLowerCase();
  const shortGloss = gloss.trim().length <= 3;
  const multiplePosMarkers = countMatches(gloss, /(?:^|\\n|\n)[a-z. &,-]{0,18}\b(?:n|v|a|adv|adj|pron|prep|conj|int|r|s)\./giu);
  const semicolonParts = gloss.split(";").map((part) => part.trim()).filter(Boolean).length;
  const distinctSourceWords = splitCsv(
    row.source_words ||
      ""
  ).length;

  if (multiplePosMarkers >= 3 || semicolonParts >= 5) {
    issues.push("broad_multi_definition_gloss");
  }

  if (row.primary_lang === "en" && localizations.en?.term && isEnglishTermConflict(row.headword, localizations.en.term)) {
    issues.push("primary_english_term_conflict");
  }

  if (shortGloss && !isLikelyAcceptableShortFunctionSense(row, localizations)) {
    issues.push("short_gloss_needs_review");
  }

  if (row.entry_source_count >= 6 && row.sense_source_count >= 6 && (multiplePosMarkers >= 3 || semicolonParts >= 4 || distinctSourceWords >= 6)) {
    issues.push("high_source_count_broad_sense");
  }

  if (row.primary_lang === "en" && localizations.zh?.term === "吗" && !/question|interrog|whether|particle/u.test(normalizedGloss)) {
    issues.push("suspicious_zh_question_particle");
  }

  if (row.primary_lang === "ja" && shortGloss && localizations.en?.term && localizations.en.term.length <= 2) {
    issues.push("short_japanese_particle_or_kana_sense");
  }

  return [...new Set(issues)];
}

function isEnglishTermConflict(headword, term) {
  const normalizedHeadword = normalizeEnglishTerm(headword);
  const normalizedTerm = normalizeEnglishTerm(term);
  if (!normalizedHeadword || !normalizedTerm) return false;
  if (normalizedHeadword === normalizedTerm) return false;
  if (normalizedTerm.includes(normalizedHeadword) || normalizedHeadword.includes(normalizedTerm)) return false;
  const allowedParaphrases = new Set([
    "be able to",
    "to be",
    "to do",
    "to go",
    "to have",
    "to make",
    "to say",
    "to see",
    "to take"
  ]);
  return !allowedParaphrases.has(normalizedTerm);
}

function normalizeEnglishTerm(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^to\s+/u, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function isLikelyAcceptableShortFunctionSense(row, localizations) {
  const pos = cleanPartOfSpeech(row.part_of_speech).toLowerCase();
  const gloss = String(row.gloss_key || "").trim();
  const headword = String(row.headword || "");
  if (["i", "we", "be", "do", "or", "by"].includes(gloss.toLowerCase())) return true;
  if (/prt|aux|pn|pron|conj|prep|int/.test(pos)) return true;
  if (row.primary_lang === "ja" && [...headword].length <= 2) return true;
  const localizedTerms = LANGS.map((lang) => localizations[lang]?.term).filter(Boolean);
  return localizedTerms.length === 4 && new Set(localizedTerms.map((term) => term.toLowerCase())).size >= 3;
}

function compactLocalizations(localizations) {
  return Object.fromEntries(
    LANGS.map((lang) => {
      const item = localizations[lang];
      return [
        lang,
        item
          ? {
              term: item.term,
              reading: item.reading,
              pronunciation: item.pronunciation,
              definition: abbreviate(item.definition, 180),
              source: item.source
            }
          : null
      ];
    })
  );
}

function pushBucket(map, bucket, sample) {
  const value = map.get(bucket) || { count: 0, samples: [] };
  value.count++;
  value.samples.push(sample);
  map.set(bucket, value);
}

function summarizeBuckets(map, limit) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([bucket, value]) => [
        bucket,
        {
          count: value.count,
          samples: value.samples.slice(0, limit)
        }
      ])
  );
}

function recommend(summary) {
  if (!summary.flagged_senses) return ["no published high-risk senses were flagged by deterministic checks"];
  return [
    "review broad_multi_definition_gloss first; these are likely over-merged senses that need splitting",
    "use deterministic rules for obvious function-word short glosses and reserve LLM review for broad multi-definition glosses",
    "after review, create split plans instead of editing localizations when one product sense contains multiple meanings"
  ];
}

function cleanPartOfSpeech(value) {
  return String(value || "").replace(/^&|;$/gu, "");
}

function countMatches(value, regex) {
  return [...String(value || "").matchAll(regex)].length;
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function abbreviate(value, maxLength) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function boundedLimit(value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(parsed, max));
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
