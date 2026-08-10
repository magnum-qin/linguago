import Database from 'better-sqlite3';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const dryRun = args['dry-run'] === 'true';

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const statements = {
  jobs: db.prepare(`
    SELECT id, target_id, lang, provider, model, input_json, output_json, error
    FROM product_llm_completion_jobs
    WHERE target_type = 'product_sense_localization'
      AND status = 'needs_review'
    ORDER BY lang, id
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
        needs_review = 0
    WHERE product_sense_id = @product_sense_id
      AND lang = @lang
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations
      (product_sense_id, lang, term, reading, reading_system, pronunciation, pronunciation_system, definition, source, confidence, needs_review)
    VALUES
      (@product_sense_id, @lang, @term, @reading, @reading_system, @pronunciation, @pronunciation_system, @definition, @source, @confidence, 0)
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
      (@product_example_id, @lang, @text, @reading, @source, 0.72, 0)
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
    SELECT COUNT(*) AS count
    FROM product_localizations
    WHERE product_sense_id = ? AND needs_review = 1
  `),
  senseEntry: db.prepare(`
    SELECT product_entry_id FROM product_senses WHERE id = ?
  `),
  markSenseAccepted: db.prepare(`
    UPDATE product_senses
    SET status = 'accepted'
    WHERE id = ? AND status IN ('ready_for_llm', 'needs_review', 'draft_fused', 'draft_single_source')
  `),
  entryStatusCounts: db.prepare(`
    SELECT status, COUNT(*) AS count
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
  scanned: 0,
  repaired: 0,
  skipped_parse: 0,
  skipped_unsafe: 0,
  repairs: {}
};
const samples = [];

const tx = db.transaction((jobs) => {
  for (const job of jobs) {
    stats.scanned++;
    const input = parseMaybeJson(job.input_json);
    const output = parseMaybeJson(job.output_json);
    const loc = output?.sense_localization;
    if (!input || !loc) {
      stats.skipped_parse++;
      continue;
    }

    const repair = repairOutput({ job, input, output, loc });
    if (!repair.ok) {
      stats.skipped_unsafe++;
      if (samples.length < 20) {
        samples.push({
          job_id: job.id,
          lang: job.lang,
          error: job.error,
          reason: repair.reason,
          term: loc.term,
          reading: loc.reading,
          definition: loc.definition
        });
      }
      continue;
    }

    applyJob({ job, output: repair.output });
    stats.repaired++;
    stats.repairs[repair.kind] = (stats.repairs[repair.kind] || 0) + 1;
  }
});

const jobs = statements.jobs.all();
if (!dryRun) tx(jobs);
else {
  for (const job of jobs) {
    stats.scanned++;
    const input = parseMaybeJson(job.input_json);
    const output = parseMaybeJson(job.output_json);
    const loc = output?.sense_localization;
    if (!input || !loc) {
      stats.skipped_parse++;
      continue;
    }
    const repair = repairOutput({ job, input, output, loc });
    if (repair.ok) {
      stats.repaired++;
      stats.repairs[repair.kind] = (stats.repairs[repair.kind] || 0) + 1;
    } else {
      stats.skipped_unsafe++;
    }
  }
}

const remaining = db
  .prepare(
    `
    SELECT lang, error, COUNT(*) AS count
    FROM product_llm_completion_jobs
    WHERE status = 'needs_review'
    GROUP BY lang, error
    ORDER BY count DESC, lang
  `
  )
  .all();

console.log(JSON.stringify({ ok: true, stats, remaining_needs_review: remaining, skipped_samples: samples }, null, 2));
db.close();

function repairOutput({ job, input, output, loc }) {
  const error = String(job.error || '');
  const sourceLinks = Array.isArray(input.source_links) ? input.source_links : [];
  const soleSource = sourceLinks.length === 1 ? sourceLinks[0] : null;
  const patched = structuredClone(output);
  const target = patched.sense_localization;
  const kinds = [];

  if (
    error.includes('term must match sole source_word when target language is the source language') &&
    soleSource?.source_lang === job.lang &&
    nonEmpty(soleSource.source_word)
  ) {
    target.term = soleSource.source_word;
    kinds.push('source_term_restored');
  }

  if (
    error.includes('reading must contain kana') &&
    job.lang === 'ja' &&
    containsKana(target.term) &&
    !containsKana(target.reading)
  ) {
    target.reading = target.term;
    target.reading_system = 'kana';
    kinds.push('ja_reading_from_term');
  }

  const remaining = validatePatchedOutput(patched, input);
  if (remaining.length) return { ok: false, reason: remaining.join('; ') };
  if (!kinds.length) return { ok: false, reason: 'no safe deterministic repair' };
  return { ok: true, kind: kinds.join('+'), output: patched };
}

function validatePatchedOutput(output, input) {
  const errors = [];
  const lang = input.target_lang;
  const loc = output?.sense_localization;
  if (!loc || typeof loc !== 'object') return ['missing sense_localization object'];
  if (loc.lang !== lang) errors.push(`lang must be ${lang}`);
  if (!nonEmpty(loc.term)) errors.push('missing term');
  if (!termLanguageLooksRight(loc.term, lang)) errors.push('term language looks suspicious');
  if (!nonEmpty(loc.definition)) errors.push('missing definition');
  if (!definitionLanguageLooksRight(loc.definition, lang)) errors.push('definition language looks suspicious');
  if (lang === 'zh' && !readingLooksPinyin(loc.reading)) errors.push('reading must look like pinyin');
  if (lang === 'ja' && !containsKana(loc.reading)) errors.push('reading must contain kana');
  if ((lang === 'en' || lang === 'pt-BR') && !nonEmpty(loc.pronunciation)) errors.push('missing pronunciation');

  const sourceLinks = Array.isArray(input.source_links) ? input.source_links : [];
  const soleSource = sourceLinks.length === 1 ? sourceLinks[0] : null;
  if (soleSource?.source_lang === lang && normalizeLoose(loc.term) !== normalizeLoose(soleSource.source_word)) {
    errors.push('term must match sole source_word when target language is the source language');
  }
  if (lang === 'pt-BR' && looksLikeShortLatinTerm(loc.term) && nonEmpty(loc.pronunciation)) {
    const termLetters = normalizeLatinLetters(loc.term);
    const pronunciationLetters = normalizeLatinLetters(loc.pronunciation);
    if (termLetters.length <= 3 && pronunciationLetters && !sharesAnyLetter(termLetters, pronunciationLetters)) {
      errors.push('pt-BR pronunciation looks unrelated to short term');
    }
  }
  if ((lang === 'zh' || lang === 'ja') && nonEmpty(loc.pronunciation)) {
    errors.push('zh/ja localizations should use reading, not pronunciation');
  }
  return errors;
}

function applyJob({ job, output }) {
  const loc = output.sense_localization;
  const payload = {
    product_sense_id: job.target_id,
    lang: job.lang,
    term: cleanText(loc.term),
    reading: cleanNullable(loc.reading),
    reading_system: cleanNullable(loc.reading_system),
    pronunciation: cleanNullable(loc.pronunciation),
    pronunciation_system: cleanNullable(loc.pronunciation_system),
    definition: cleanText(loc.definition),
    source: `${job.provider}:${job.model}`,
    confidence: 0.78
  };
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
      source: `${job.provider}:${job.model}`
    });
  }

  statements.markJobAccepted.run(JSON.stringify(output, null, 2), job.id);
  if (
    statements.completedLangCount.get(job.target_id).count >= 4 &&
    statements.reviewLocalizationCount.get(job.target_id).count === 0
  ) {
    statements.markSenseAccepted.run(job.target_id);
    const entry = statements.senseEntry.get(job.target_id);
    if (entry) updateEntryStatus(entry.product_entry_id);
  }
}

function updateEntryStatus(productEntryId) {
  const statuses = statements.entryStatusCounts.all(productEntryId);
  const total = statuses.reduce((sum, row) => sum + Number(row.count), 0);
  const accepted = statuses.find((row) => row.status === 'accepted')?.count || 0;
  if (accepted === total) statements.setEntryStatus.run('accepted', productEntryId);
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullable(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function containsKana(value) {
  return /[\u3040-\u30ff]/u.test(String(value || ''));
}

function readingLooksPinyin(value) {
  const text = String(value || '').trim();
  return /[\p{Script=Latin}\u0300-\u036f0-9]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
}

function termLanguageLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text) && !/[\u3040-\u30ff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'pt-BR') return /[\p{Script=Latin}]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'en') return /[A-Za-z]/u.test(text) && !/[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  return false;
}

function definitionLanguageLooksRight(value, lang) {
  const text = String(value || '');
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff\u3400-\u9fff]/u.test(text);
  if (lang === 'pt-BR') return /[\p{Script=Latin}]/u.test(text);
  if (lang === 'en') return /[A-Za-z]/u.test(text);
  return false;
}

function looksLikeShortLatinTerm(value) {
  const text = String(value || '').trim();
  return /^[\p{Script=Latin}\s'’?-]{1,12}$/u.test(text) && normalizeLatinLetters(text).length <= 3;
}

function sharesAnyLetter(left, right) {
  return [...new Set(left)].some((letter) => right.includes(letter));
}

function normalizeLoose(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Script=Latin}]/gu, '')
    .toLowerCase();
}

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    output[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return output;
}
