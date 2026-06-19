import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_fused_only_pilot.db";
const DEFAULT_ENDPOINT = "http://100.99.99.99:11441";
const DEFAULT_MODEL = "qwen3.6:latest";
const PROMPT_VERSION = "dictionary-v2-product-fusion-review-v1";

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const endpoint = String(args.endpoint || process.env.OLLAMA_HOST || DEFAULT_ENDPOINT).replace(/\/$/u, "");
const model = args.model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
const limit = Number(args.limit || 20);
const minSourceCount = Number(args["min-source-count"] || 2);
const shardCount = Number(args["shard-count"] || 1);
const shardIndex = Number(args["shard-index"] || 0);
const timeoutMs = Number(args["timeout-ms"] || 180_000);
const prewarmTimeoutMs = Number(args["prewarm-timeout-ms"] || 180_000);
const dryRun = args["dry-run"] === "true";
const retryNeedsReview = args["retry-needs-review"] === "true";
const maxTokens = Number(args["max-tokens"] || 1200);
const candidateFilter = args["candidate-filter"] || "source-count";
const riskSourceCount = Number(args["risk-source-count"] || 6);
const maxShortGlossLength = Number(args["max-short-gloss-length"] || 3);
const selectOnly = args["select-only"] === "true";
const candidatesOutPath = path.resolve(
  args["candidates-out"] || dbPath.replace(/\.db$/u, ".fusion-review-candidates.json")
);

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error("--shard-count must be a positive integer");
if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
  throw new Error("--shard-index must be between 0 and shard-count - 1");
}
if (!["source-count", "high-risk", "short-gloss", "same-lang-mismatch"].includes(candidateFilter)) {
  throw new Error("--candidate-filter must be one of: source-count, high-risk, short-gloss, same-lang-mismatch");
}
if (!Number.isFinite(riskSourceCount) || riskSourceCount < 1) {
  throw new Error("--risk-source-count must be a positive number");
}
if (!Number.isFinite(maxShortGlossLength) || maxShortGlossLength < 1) {
  throw new Error("--max-short-gloss-length must be a positive number");
}

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");
ensureReviewSchema(db);

const candidateWhere = candidateFilterClause(candidateFilter);
const candidates = db
  .prepare(
    `
    SELECT
      pe.id AS product_entry_id,
      ps.id AS product_sense_id,
      pe.headword,
      pe.primary_lang,
      pe.frequency_rank,
      pe.group_method,
      pe.source_count,
      pe.lang_count,
      ps.part_of_speech,
      ps.gloss_key
    FROM product_entries pe
    JOIN product_senses ps ON ps.product_entry_id = pe.id
    WHERE ${candidateWhere}
      AND (pe.id % @shardCount) = @shardIndex
      AND (
        @retryNeedsReview = 1
        OR NOT EXISTS (
          SELECT 1 FROM product_fusion_reviews r
          WHERE r.product_sense_id = ps.id
            AND r.model = @model
            AND r.prompt_version = @promptVersion
            AND r.status IN ('accepted', 'needs_review')
        )
      )
    ORDER BY
      CASE WHEN pe.source_count >= @riskSourceCount THEN 0 ELSE 1 END,
      CASE WHEN length(trim(ps.gloss_key)) <= @maxShortGlossLength THEN 0 ELSE 1 END,
      pe.source_count DESC,
      pe.lang_count DESC,
      pe.frequency_rank ASC,
      pe.id ASC
    LIMIT @limit
  `
  )
  .all({
    minSourceCount,
    riskSourceCount,
    maxShortGlossLength,
    shardCount,
    shardIndex,
    retryNeedsReview: retryNeedsReview ? 1 : 0,
    model,
    promptVersion: PROMPT_VERSION,
    limit
  });

console.log(`DB: ${path.relative(process.cwd(), dbPath)}`);
console.log(`Endpoint: ${endpoint}`);
console.log(`Model: ${model}`);
console.log(`Candidates selected: ${candidates.length}`);
console.log(`Candidate filter: ${candidateFilter}`);
console.log(`Dry run: ${dryRun}`);
console.log(`Select only: ${selectOnly}`);
console.log(`Shard: ${shardIndex}/${shardCount}`);

if (selectOnly) {
  const selection = {
    ok: true,
    db: path.relative(process.cwd(), dbPath),
    prompt_version: PROMPT_VERSION,
    candidate_filter: candidateFilter,
    min_source_count: minSourceCount,
    risk_source_count: riskSourceCount,
    max_short_gloss_length: maxShortGlossLength,
    shard: {
      index: shardIndex,
      count: shardCount
    },
    selected: candidates.length,
    candidates: candidates.map((candidate) => {
      const input = buildReviewInput(candidate);
      return {
        product_entry_id: candidate.product_entry_id,
        product_sense_id: candidate.product_sense_id,
        headword: candidate.headword,
        primary_lang: candidate.primary_lang,
        frequency_rank: candidate.frequency_rank,
        group_method: candidate.group_method,
        source_count: candidate.source_count,
        lang_count: candidate.lang_count,
        part_of_speech: candidate.part_of_speech,
        gloss_key: candidate.gloss_key,
        source_links: input.source_links,
        current_localizations: input.current_localizations
      };
    })
  };
  fs.writeFileSync(candidatesOutPath, JSON.stringify(selection, null, 2));
  db.close();
  console.log(`Wrote candidate selection: ${path.relative(process.cwd(), candidatesOutPath)}`);
  console.log(JSON.stringify({ ok: true, selected: selection.selected, out: path.relative(process.cwd(), candidatesOutPath) }));
  process.exit(0);
}

const insertReview = db.prepare(`
  INSERT INTO product_fusion_reviews
    (product_entry_id, product_sense_id, model, prompt_version, status, decision, confidence, same_sense_score,
     rationale, suggested_groups_json, output_json, error, seconds)
  VALUES
    (@product_entry_id, @product_sense_id, @model, @prompt_version, @status, @decision, @confidence, @same_sense_score,
     @rationale, @suggested_groups_json, @output_json, @error, @seconds)
`);

if (candidates.length) {
  const prewarm = await prewarmModel();
  console.log(
    `[prewarm] ok=${prewarm.ok} seconds=${prewarm.seconds} load_seconds=${prewarm.load_seconds ?? "n/a"}${
      prewarm.error ? ` error=${prewarm.error}` : ""
    }`
  );
}

const stats = {
  selected: candidates.length,
  accepted: 0,
  needs_review: 0,
  failed: 0,
  keep: 0,
  split: 0,
  model_needs_review: 0,
  dry_run: dryRun
};

for (const candidate of candidates) {
  const input = buildReviewInput(candidate);
  const started = performance.now();
  try {
    const envelope = await callOllama(input);
    const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
    const content = envelope?.message?.content || envelope?.response || "";
    const output = parseJson(content);
    const validation = validateReview(output, input);
    const status = validation.errors.length ? "needs_review" : "accepted";
    if (!dryRun) {
      insertReview.run({
        product_entry_id: candidate.product_entry_id,
        product_sense_id: candidate.product_sense_id,
        model,
        prompt_version: PROMPT_VERSION,
        status,
        decision: normalizeDecision(output.decision),
        confidence: normalizedConfidence(output.confidence),
        same_sense_score: normalizedConfidence(output.same_sense_score),
        rationale: cleanNullable(output.rationale),
        suggested_groups_json: JSON.stringify(output.suggested_groups || []),
        output_json: JSON.stringify(output, null, 2),
        error: validation.errors.join("; ") || null,
        seconds
      });
    }

    stats[status]++;
    const decision = normalizeDecision(output.decision);
    if (decision === "keep") stats.keep++;
    else if (decision === "split") stats.split++;
    else stats.model_needs_review++;

    console.log(
      `[${status}] entry=${candidate.product_entry_id} sense=${candidate.product_sense_id} headword=${candidate.headword} decision=${decision} confidence=${normalizedConfidence(output.confidence)} seconds=${seconds}`
    );
    if (validation.errors.length) console.log(`  errors: ${validation.errors.join("; ")}`);
  } catch (error) {
    stats.failed++;
    const seconds = Number(((performance.now() - started) / 1000).toFixed(2));
    if (!dryRun) {
      insertReview.run({
        product_entry_id: candidate.product_entry_id,
        product_sense_id: candidate.product_sense_id,
        model,
        prompt_version: PROMPT_VERSION,
        status: "failed",
        decision: "needs_review",
        confidence: 0,
        same_sense_score: 0,
        rationale: null,
        suggested_groups_json: "[]",
        output_json: null,
        error: `${error.name || "Error"}: ${error.message || String(error)}`,
        seconds
      });
    }
    console.log(
      `[failed] entry=${candidate.product_entry_id} sense=${candidate.product_sense_id} headword=${candidate.headword} seconds=${seconds}: ${error.message || String(error)}`
    );
  }
}

const summary = {
  ok: true,
  db: path.relative(process.cwd(), dbPath),
  endpoint,
  model,
  prompt_version: PROMPT_VERSION,
  candidate_filter: candidateFilter,
  min_source_count: minSourceCount,
  risk_source_count: riskSourceCount,
  max_short_gloss_length: maxShortGlossLength,
  stats,
  shard: {
    index: shardIndex,
    count: shardCount
  },
  review_totals: db
    .prepare(
      `
      SELECT status, decision, COUNT(*) AS count, ROUND(AVG(confidence), 3) AS avg_confidence
      FROM product_fusion_reviews
      WHERE model = ? AND prompt_version = ?
      GROUP BY status, decision
      ORDER BY status, decision
    `
    )
    .all(model, PROMPT_VERSION),
  highest_confidence_split: db
    .prepare(
      `
      SELECT r.product_entry_id, pe.headword, pe.frequency_rank, r.confidence, r.same_sense_score, r.rationale
      FROM product_fusion_reviews r
      JOIN product_entries pe ON pe.id = r.product_entry_id
      WHERE r.model = ? AND r.prompt_version = ? AND r.decision = 'split'
      ORDER BY r.confidence DESC, pe.frequency_rank ASC
      LIMIT 10
    `
    )
    .all(model, PROMPT_VERSION)
};

fs.writeFileSync(dbPath.replace(/\.db$/u, ".fusion-review.summary.json"), JSON.stringify(summary, null, 2));
db.close();
console.log(JSON.stringify(summary, null, 2));

function ensureReviewSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS product_fusion_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_entry_id INTEGER NOT NULL,
      product_sense_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'needs_review', 'failed')),
      decision TEXT NOT NULL CHECK (decision IN ('keep', 'split', 'needs_review')),
      confidence REAL NOT NULL DEFAULT 0,
      same_sense_score REAL NOT NULL DEFAULT 0,
      rationale TEXT,
      suggested_groups_json TEXT NOT NULL DEFAULT '[]',
      output_json TEXT,
      error TEXT,
      seconds REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_entry_id) REFERENCES product_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (product_sense_id) REFERENCES product_senses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_product_fusion_reviews_sense_model
      ON product_fusion_reviews(product_sense_id, model, prompt_version, status);
    CREATE INDEX IF NOT EXISTS idx_product_fusion_reviews_decision
      ON product_fusion_reviews(model, prompt_version, decision, confidence);
  `);
}

function candidateFilterClause(filter) {
  if (filter === "same-lang-mismatch") {
    return `
      ps.status IN ('accepted', 'ready_for_llm')
      AND EXISTS (
        SELECT 1
        FROM product_sense_source_links mismatch_link
        WHERE mismatch_link.product_sense_id = ps.id
          AND mismatch_link.source_lang = pe.primary_lang
          AND mismatch_link.source_word <> pe.headword
      )
      AND (
        SELECT COUNT(*)
        FROM product_sense_source_links count_link
        WHERE count_link.product_sense_id = ps.id
      ) > 1
    `;
  }
  if (filter === "high-risk") {
    return "(pe.source_count >= @riskSourceCount OR length(trim(ps.gloss_key)) <= @maxShortGlossLength)";
  }
  if (filter === "short-gloss") {
    return "length(trim(ps.gloss_key)) <= @maxShortGlossLength";
  }
  return "pe.source_count >= @minSourceCount";
}

function buildReviewInput(candidate) {
  const links = db
    .prepare(
      `
      SELECT source_entry_id, source_sense_id, source_lang, source_word, source_frequency_rank, match_method, confidence
      FROM product_sense_source_links
      WHERE product_sense_id = ?
      ORDER BY source_frequency_rank, source_lang, source_sense_id
    `
    )
    .all(candidate.product_sense_id);

  const localizations = db
    .prepare(
      `
      SELECT lang, term, reading, pronunciation, definition, source, confidence, needs_review
      FROM product_localizations
      WHERE product_sense_id = ?
      ORDER BY lang
    `
    )
    .all(candidate.product_sense_id);

  return {
    task: "review_product_sense_fusion",
    requirements: {
      decide_whether_all_source_links_represent_one_dictionary_sense: true,
      keep_means_all_sources_can_remain_under_one_product_sense: true,
      split_means_two_or_more_meanings_are_mixed_and_should_be_separated: true,
      needs_review_means_insufficient_or_ambiguous_evidence: true,
      do_not_translate_or_create_new_localizations: true,
      output_json_only: true
    },
    product_entry: {
      id: candidate.product_entry_id,
      headword: candidate.headword,
      primary_lang: candidate.primary_lang,
      frequency_rank: candidate.frequency_rank,
      group_method: candidate.group_method,
      source_count: candidate.source_count,
      lang_count: candidate.lang_count
    },
    product_sense: {
      id: candidate.product_sense_id,
      part_of_speech: candidate.part_of_speech,
      gloss_key: candidate.gloss_key
    },
    source_links: links.map((link, index) => ({
      link_id: index + 1,
      ...link
    })),
    current_localizations: localizations,
    expected_output_schema: reviewSchema()
  };
}

async function prewarmModel() {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), prewarmTimeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "20m",
        prompt: "Return only OK.",
        options: { temperature: 0, num_predict: 2 }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    const envelope = JSON.parse(text);
    return {
      ok: true,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      load_seconds: envelope.load_duration ? Number((envelope.load_duration / 1_000_000_000).toFixed(2)) : null
    };
  } catch (error) {
    return {
      ok: false,
      seconds: Number(((performance.now() - started) / 1000).toFixed(2)),
      error: `${error.name || "Error"}: ${error.message || String(error)}`
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callOllama(input) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "20m",
        format: reviewSchema(),
        messages: [
          {
            role: "system",
            content: [
              "You are reviewing dictionary sense fusion quality.",
              "Decide whether the grouped source dictionary senses describe the same lexical sense.",
              "Return JSON only.",
              "Use decision='keep' only when all source links can safely remain in one product sense.",
              "Use decision='split' when different meanings, parts of speech, or unrelated uses are mixed.",
              "Use decision='needs_review' when the evidence is too broad, obsolete, contradictory, or ambiguous.",
              "Do not translate. Do not add new definitions. Only review the grouping.",
              "When suggesting split groups, use source_link_ids from the numbered source_links array, not database ids."
            ].join(" ")
          },
          {
            role: "user",
            content: `Review this product fusion candidate.\n\n${JSON.stringify(input, null, 2)}\n\nReturn JSON only.`
          }
        ],
        options: {
          temperature: 0,
          top_p: 0.8,
          num_ctx: 4096,
          num_predict: maxTokens
        }
      })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function reviewSchema() {
  return {
    type: "object",
    required: ["decision", "confidence", "same_sense_score", "rationale", "suggested_groups"],
    properties: {
      decision: { type: "string", enum: ["keep", "split", "needs_review"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      same_sense_score: { type: "number", minimum: 0, maximum: 1 },
      rationale: { type: "string", minLength: 1 },
      suggested_groups: {
        type: "array",
        items: {
          type: "object",
          required: ["label", "source_link_ids", "reason"],
          properties: {
            label: { type: "string", minLength: 1 },
            source_link_ids: { type: "array", items: { type: "number" } },
            reason: { type: "string", minLength: 1 }
          }
        }
      }
    }
  };
}

function validateReview(output, input) {
  const errors = [];
  if (!["keep", "split", "needs_review"].includes(output?.decision)) errors.push("invalid decision");
  if (!Number.isFinite(Number(output?.confidence))) errors.push("invalid confidence");
  if (!Number.isFinite(Number(output?.same_sense_score))) errors.push("invalid same_sense_score");
  if (!cleanNullable(output?.rationale)) errors.push("missing rationale");
  if (!Array.isArray(output?.suggested_groups)) errors.push("suggested_groups must be an array");
  if (output?.decision === "split" && (!Array.isArray(output?.suggested_groups) || output.suggested_groups.length < 2)) {
    errors.push("split decision requires at least two suggested groups");
  }
  const sourceLinkIds = new Set(input.source_links.map((link) => Number(link.link_id)));
  for (const group of output?.suggested_groups || []) {
    if (!cleanNullable(group.label)) errors.push("suggested group missing label");
    if (!cleanNullable(group.reason)) errors.push("suggested group missing reason");
    if (!Array.isArray(group.source_link_ids) || !group.source_link_ids.length) {
      errors.push("suggested group missing source_link_ids");
      continue;
    }
    for (const id of group.source_link_ids) {
      if (!sourceLinkIds.has(Number(id))) errors.push(`unknown source_link_id in suggested group: ${id}`);
    }
  }
  return { errors };
}

function parseJson(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) throw new Error("empty model content");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("content is not JSON");
  }
}

function normalizeDecision(value) {
  return ["keep", "split", "needs_review"].includes(value) ? value : "needs_review";
}

function normalizedConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function cleanNullable(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) i++;
  }
  return result;
}
