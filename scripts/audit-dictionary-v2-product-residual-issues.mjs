import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const sampleLimit = Number(args.samples || 12);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });
db.pragma("busy_timeout = 30000");
const hasPublicationBlocks = Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'product_sense_publication_blocks'").get()
);

const jobs = db
  .prepare(
    `
    SELECT
      j.id,
      j.target_type,
      j.target_id,
      j.lang,
      j.status,
      j.prompt_version,
      j.error,
      j.input_json,
      j.output_json,
      pe.headword,
      pe.primary_lang,
      pe.frequency_rank,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status AS sense_status,
      ${hasPublicationBlocks ? "b.block_code" : "NULL AS block_code"}
    FROM product_llm_completion_jobs j
    JOIN product_senses ps ON ps.id = j.target_id
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    ${hasPublicationBlocks ? "LEFT JOIN product_sense_publication_blocks b ON b.product_sense_id = ps.id" : ""}
    WHERE j.status IN ('failed', 'needs_review')
      AND j.target_type = 'product_sense_localization'
      AND ps.status IN ('needs_review', 'ready_for_llm')
      AND j.id = (
        SELECT MAX(j2.id)
        FROM product_llm_completion_jobs j2
        WHERE j2.target_type = j.target_type
          AND j2.target_id = j.target_id
          AND j2.lang = j.lang
      )
    ORDER BY j.status, j.lang, j.id
  `
  )
  .all();

const senseRows = db
  .prepare(
    `
    SELECT
      ps.id,
      pe.headword,
      pe.primary_lang,
      pe.frequency_rank,
      ps.sense_order,
      ps.part_of_speech,
      ps.gloss_key,
      ps.status,
      ${hasPublicationBlocks ? "b.block_code" : "NULL AS block_code"},
      (
        SELECT COUNT(DISTINCT pl.lang)
        FROM product_localizations pl
        WHERE pl.product_sense_id = ps.id
          AND pl.needs_review = 0
      ) AS clean_langs
    FROM product_senses ps
    JOIN product_entries pe ON pe.id = ps.product_entry_id
    ${hasPublicationBlocks ? "LEFT JOIN product_sense_publication_blocks b ON b.product_sense_id = ps.id" : ""}
    WHERE ps.status IN ('needs_review', 'ready_for_llm')
    ORDER BY pe.frequency_rank IS NULL, pe.frequency_rank, pe.headword, ps.sense_order
  `
  )
  .all();

const jobBuckets = new Map();
const blockedJobBuckets = new Map();
for (const row of jobs) {
  const parsed = parseJobOutput(row.output_json);
  if (row.block_code) {
    pushBucket(blockedJobBuckets, "blocked_publication_job", buildJobSample(row, parsed));
    continue;
  }

  const bucket = classifyJob(row, parsed);
  pushBucket(jobBuckets, bucket, buildJobSample(row, parsed));
}

const senseBuckets = new Map();
for (const row of senseRows) {
  const bucket = classifySense(row);
  pushBucket(senseBuckets, bucket, {
    sense_id: row.id,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    sense_order: row.sense_order,
    part_of_speech: row.part_of_speech,
    status: row.status,
    clean_langs: row.clean_langs,
    gloss_key: abbreviate(row.gloss_key, 220)
  });
}

const result = {
  db: path.relative(process.cwd(), dbPath),
  job_issues: summarizeBuckets(jobBuckets, sampleLimit),
  blocked_publication_jobs: summarizeBuckets(blockedJobBuckets, sampleLimit),
  sense_issues: summarizeBuckets(senseBuckets, sampleLimit),
  recommended_next_steps: buildRecommendedNextSteps(jobBuckets, senseBuckets)
};

console.log(JSON.stringify(result, null, 2));
db.close();

function classifyJob(row, parsed) {
  if (row.status === "failed") {
    if (/content is not JSON|SyntaxError|Bad escaped character/i.test(row.error || "")) {
      return "json_parse_failed";
    }
    return "failed_other";
  }

  const term = parsed.localization?.term || "";
  const definition = parsed.localization?.definition || "";
  const error = row.error || "";

  if (/alternative form|variant of|only used in|classifier|CL:/i.test(term)) {
    return "source_leak_term_cross_reference";
  }
  if (containsCjk(term) && !["zh", "ja"].includes(row.lang)) {
    return "source_leak_term_cjk";
  }
  if (row.lang === "zh" && containsKana(term)) {
    return "wrong_script_term_zh_has_kana";
  }
  if (row.lang === "ja" && /^[A-Za-z][A-Za-z -]*$/.test(term)) {
    return "wrong_script_term_ja_has_latin";
  }
  if (/pronunciation looks unrelated/i.test(error)) {
    return "pronunciation_validation";
  }
  if (/definition language looks suspicious/i.test(error)) {
    if (containsCjk(definition) && ["en", "pt-BR"].includes(row.lang)) return "wrong_script_definition_cjk";
    return "definition_language_suspicious";
  }
  if (/term language looks suspicious/i.test(error)) return "term_language_suspicious";
  if (/reading/i.test(error)) return "reading_validation";
  return "needs_review_other";
}

function buildJobSample(row, parsed) {
  return {
    job_id: row.id,
    target_id: row.target_id,
    lang: row.lang,
    status: row.status,
    prompt_version: row.prompt_version,
    error: row.error,
    headword: row.headword,
    primary_lang: row.primary_lang,
    frequency_rank: row.frequency_rank,
    sense_order: row.sense_order,
    part_of_speech: row.part_of_speech,
    gloss_key: abbreviate(row.gloss_key, 180),
    output_term: abbreviate(parsed.localization?.term, 120),
    output_definition: abbreviate(parsed.localization?.definition, 180)
  };
}

function classifySense(row) {
  if (row.block_code) return "blocked_publication";
  const gloss = row.gloss_key || "";
  if (/alternative form|variant of|only used in/i.test(gloss)) return "variant_or_cross_reference_only";
  if (row.clean_langs >= 3) return "mostly_complete_needs_one_slot";
  if (row.frequency_rank != null && row.frequency_rank <= 5000) return "high_frequency_incomplete";
  return "incomplete_or_low_confidence";
}

function parseJobOutput(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return { localization: parsed.sense_localization || null };
  } catch {
    return { localization: null };
  }
}

function pushBucket(map, bucket, sample) {
  const item = map.get(bucket) || { count: 0, samples: [] };
  item.count++;
  item.samples.push(sample);
  map.set(bucket, item);
}

function summarizeBuckets(map, sampleLimit) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
      .map(([bucket, value]) => [
        bucket,
        {
          count: value.count,
          samples: value.samples.slice(0, sampleLimit)
        }
      ])
  );
}

function buildRecommendedNextSteps(jobBuckets, senseBuckets) {
  const hasActionableJobs = jobBuckets.size > 0;
  const hasActionableSenses = [...senseBuckets.keys()].some((key) => key !== "blocked_publication");
  if (!hasActionableJobs && !hasActionableSenses) {
    return [
      "no actionable residual jobs remain under the current audit policy",
      "keep blocked_publication senses excluded from D1 export unless better source data is added",
      "run release preflight and deploy only if export inputs changed"
    ];
  }

  return [
    "rule-repair source_leak_term when a reliable target term can be extracted from existing clean localizations",
    "create a stricter retry prompt for json_parse_failed jobs only",
    "mark variant_or_cross_reference_only senses as non-publishable when they have no stable lexical equivalent",
    "rerun regression and D1 export after residual issue count is stable"
  ];
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ""));
}

function containsKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value || ""));
}

function abbreviate(value, maxLength) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
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
