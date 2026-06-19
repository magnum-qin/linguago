import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_DB = "data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db";
const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const dryRun = args["dry-run"] !== "false";

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 10000");

const fixes = new Map([
  [40, { term: "拨音", reading: "bō yīn", reading_system: "pinyin" }],
  [82, { term: "口语系词", reading: "kǒu yǔ xì cí", reading_system: "pinyin" }],
  [143, { term: "条件助词", reading: "tiáo jiàn zhù cí", reading_system: "pinyin" }],
  [296, { term: "走", reading: "そう", reading_system: "kana" }],
  [298, { reading: "に", reading_system: "kana" }],
  [304, { term: "我", reading: "われ", reading_system: "kana" }],
  [333, { term: "腿", reading: "tuǐ", reading_system: "pinyin" }],
  [367, { term: "兩", reading: "liǎng", reading_system: "pinyin" }],
  [429, { pronunciation: "cê", pronunciation_system: "pt-BR respelling" }],
  [461, { term: "壞", reading: "huài", reading_system: "pinyin" }],
  [477, { term: "兒子", reading: "ér zi", reading_system: "pinyin" }],
  [573, { term: "古典过去助动词", reading: "gǔ diǎn guò qù zhù dòng cí", reading_system: "pinyin" }]
]);

const statements = {
  job: db.prepare(`
    SELECT id, target_id, lang, output_json
    FROM product_llm_completion_jobs
    WHERE id = ?
      AND target_type = 'product_sense_localization'
      AND status = 'needs_review'
  `),
  localizationExists: db.prepare(`
    SELECT id FROM product_localizations WHERE product_sense_id = ? AND lang = ?
  `),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = @confidence,
        needs_review = @needs_review
    WHERE product_sense_id = @product_sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system,
       definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system,
       @definition, @source, @confidence, @needs_review)
  `),
  exampleExists: db.prepare(`
    SELECT id FROM product_examples WHERE id = ? AND product_sense_id = ?
  `),
  exampleLocalizationExists: db.prepare(`
    SELECT id FROM product_example_localizations WHERE product_example_id = ? AND lang = ?
  `),
  insertExampleLocalization: db.prepare(`
    INSERT INTO product_example_localizations
      (product_example_id, lang, text, reading, source, confidence, needs_review)
    VALUES
      (@product_example_id, @lang, @text, @reading, @source, @confidence, @needs_review)
  `),
  markJobAccepted: db.prepare(`
    UPDATE product_llm_completion_jobs
    SET status = 'accepted', output_json = ?, error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `),
  completedLangCount: db.prepare(`
    SELECT COUNT(DISTINCT lang) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
  `),
  reviewLocalizationCount: db.prepare(`
    SELECT COUNT(1) AS count
    FROM product_localizations
    WHERE product_sense_id = ?
      AND needs_review = 1
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ?
      AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  senseEntry: db.prepare(`
    SELECT product_entry_id
    FROM product_senses
    WHERE id = ?
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(1) AS count
    FROM product_senses
    WHERE product_entry_id = ?
    GROUP BY status
  `),
  setEntryStatus: db.prepare(`
    UPDATE product_entries
    SET status = ?
    WHERE id = ?
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  dry_run: dryRun,
  planned: fixes.size,
  applied: 0,
  skipped: []
};

const applyFixes = db.transaction(() => {
  for (const [jobId, patch] of fixes) {
    const job = statements.job.get(jobId);
    if (!job) {
      stats.skipped.push({ job_id: jobId, reason: "job_not_found_or_not_needs_review" });
      continue;
    }
    if (!job.output_json) {
      stats.skipped.push({ job_id: jobId, reason: "missing_output_json" });
      continue;
    }

    const output = JSON.parse(job.output_json);
    const loc = output.sense_localization;
    if (!loc || loc.lang !== job.lang) {
      stats.skipped.push({ job_id: jobId, reason: "bad_output_shape" });
      continue;
    }

    output.sense_localization = {
      ...loc,
      ...patch
    };
    const fixed = output.sense_localization;
    const payload = {
      product_sense_id: job.target_id,
      lang: job.lang,
      term: cleanText(fixed.term),
      reading: cleanNullable(fixed.reading),
      reading_system: cleanNullable(fixed.reading_system),
      pronunciation: cleanNullable(fixed.pronunciation),
      pronunciation_system: cleanNullable(fixed.pronunciation_system),
      definition: cleanText(fixed.definition),
      source: "manual:deterministic-needs-review-repair",
      confidence: 0.82,
      needs_review: 0
    };

    if (!payload.term || !payload.definition) {
      stats.skipped.push({ job_id: jobId, reason: "empty_term_or_definition_after_patch" });
      continue;
    }

    if (statements.localizationExists.get(job.target_id, job.lang)) {
      statements.updateLocalization.run(payload);
    } else {
      statements.insertLocalization.run(payload);
    }

    for (const example of output.example_localizations || []) {
      const exampleId = Number(example.example_id);
      if (!Number.isInteger(exampleId)) continue;
      if (!statements.exampleExists.get(exampleId, job.target_id)) continue;
      if (statements.exampleLocalizationExists.get(exampleId, job.lang)) continue;
      statements.insertExampleLocalization.run({
        product_example_id: exampleId,
        lang: job.lang,
        text: cleanText(example.text),
        reading: cleanNullable(example.reading),
        source: "manual:deterministic-needs-review-repair",
        confidence: 0.78,
        needs_review: 0
      });
    }

    statements.markJobAccepted.run(JSON.stringify(output, null, 2), jobId);
    maybeMarkSenseAccepted(job.target_id);
    stats.applied++;
  }
});

if (!dryRun) applyFixes();
else {
  for (const jobId of fixes.keys()) {
    const job = statements.job.get(jobId);
    stats.skipped.push(job ? { job_id: jobId, reason: "dry_run" } : { job_id: jobId, reason: "job_not_found_or_not_needs_review" });
  }
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function maybeMarkSenseAccepted(productSenseId) {
  if (
    statements.completedLangCount.get(productSenseId).count >= 4 &&
    statements.reviewLocalizationCount.get(productSenseId).count === 0
  ) {
    statements.markSenseAccepted.run(productSenseId);
    const entry = statements.senseEntry.get(productSenseId);
    if (entry) updateEntryStatus(entry.product_entry_id);
  }
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === "accepted")?.count || 0;
  if (accepted === total) statements.setEntryStatus.run("accepted", productEntryId);
}

function cleanText(value) {
  return String(value || "").trim();
}

function cleanNullable(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
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
