import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_REPORT = 'logs/product-incomplete-gap-senses-clean-20260623.json';
const DEFAULT_OUT = 'logs/product-source-gap-residual-clean-20260624.json';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const reportPath = path.resolve(args.report || DEFAULT_REPORT);
const attemptLogPath = args['attempt-log'] ? path.resolve(args['attempt-log']) : null;
const outPath = path.resolve(args.out || DEFAULT_OUT);
const sampleLimit = Number(args['sample-limit'] || 80);

if (!fs.existsSync(dbPath)) throw new Error(`Product DB not found: ${dbPath}`);
if (!fs.existsSync(reportPath)) throw new Error(`Clean source-gap report not found: ${reportPath}`);
if (attemptLogPath && !fs.existsSync(attemptLogPath)) throw new Error(`Attempt log not found: ${attemptLogPath}`);
if (!Number.isInteger(sampleLimit) || sampleLimit < 1)
  throw new Error(`Invalid --sample-limit: ${args['sample-limit']}`);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const sourceRows = Array.isArray(report.selected) ? report.selected : [];
const latestAttempts = loadAttemptErrors(attemptLogPath);
const db = new Database(dbPath, { readonly: true });

const exactComplete = db.prepare(`
  SELECT ps.id
  FROM product_entries pe
  JOIN product_senses ps ON ps.product_entry_id = pe.id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE pe.group_key = ?
    AND ps.gloss_key = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);

const linkedComplete = db.prepare(`
  SELECT ps.id
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE link.source_sense_id = ?
    AND ps.status = 'accepted'
    AND COALESCE(pl.needs_review, 0) = 0
  GROUP BY ps.id
  HAVING COUNT(DISTINCT pl.lang) = 4
  LIMIT 1
`);

const residuals = [];
const skipped = [];

for (const row of sourceRows) {
  const status = completionStatus(row);
  if (status.complete) {
    skipped.push({
      source_entry_id: row.source_entry_id,
      first_sense_id: row.first_sense_id,
      word: row.word,
      source_lang: row.source_lang,
      reason: status.reason,
      product_sense_id: status.product_sense_id
    });
    continue;
  }

  const attempt = latestAttempts.get(String(row.source_entry_id));
  const classification = classifyResidual(row, attempt?.errors || []);
  residuals.push({
    source_entry_id: row.source_entry_id,
    first_sense_id: row.first_sense_id,
    word: row.word,
    normalized_key: row.normalized_key,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    first_gloss_key: row.first_gloss_key,
    first_gloss_preview: row.first_gloss_preview,
    gloss_key: row.gloss_key,
    gloss_preview: row.gloss_preview,
    part_of_speech: row.useful_senses?.[0]?.part_of_speech || null,
    latest_errors: attempt?.errors || [],
    latest_endpoint: attempt?.endpoint || null,
    latest_seconds: attempt?.seconds ?? null,
    residual_class: classification.kind,
    recommended_action: classification.action,
    risk_tags: classification.tags
  });
}

db.close();

const summary = {
  db: path.relative(process.cwd(), dbPath),
  report: path.relative(process.cwd(), reportPath),
  attempt_log: attemptLogPath ? path.relative(process.cwd(), attemptLogPath) : null,
  clean_report_total: sourceRows.length,
  complete_now: skipped.length,
  residual_total: residuals.length,
  residual_by_lang: countBy(residuals.map((row) => row.source_lang)),
  residual_by_class: countBy(residuals.map((row) => row.residual_class)),
  residual_error_counts: countReasons(residuals.flatMap((row) => row.latest_errors)),
  residual_action_counts: countBy(residuals.map((row) => row.recommended_action)),
  complete_by_reason: countBy(skipped.map((row) => row.reason)),
  top_frequency_rank: residuals[0]?.frequency_rank ?? null,
  last_frequency_rank: residuals.at(-1)?.frequency_rank ?? null
};

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  summary,
  residuals,
  samples: {
    by_class: sampleBy(residuals, 'residual_class', sampleLimit),
    by_action: sampleBy(residuals, 'recommended_action', sampleLimit)
  },
  next_step: nextStep(summary)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

function completionStatus(row) {
  const linked = row.first_sense_id ? linkedComplete.get(row.first_sense_id) : null;
  if (linked) return { complete: true, reason: 'linked_complete', product_sense_id: linked.id };

  const groupKey = `source-gap:${row.source_lang}:${normalize(row.normalized_key || row.word)}`;
  const glossKey = row.first_gloss_key || row.first_gloss_preview || '';
  const exact = glossKey ? exactComplete.get(groupKey, glossKey) : null;
  if (exact) return { complete: true, reason: 'exact_complete', product_sense_id: exact.id };

  return { complete: false, reason: 'residual', product_sense_id: null };
}

function classifyResidual(row, errors) {
  const tags = riskTags(row);
  const errorText = errors.join(' | ');
  if (/fetch failed|TimeoutError|AbortError|No model loaded|HTTP 5\d\d|not JSON|content is not JSON/u.test(errorText)) {
    return { kind: 'transient_generation_error', action: 'retry_with_same_pipeline', tags };
  }
  if (tags.includes('brand_or_software') || tags.includes('proper_name') || tags.includes('symbol_or_letter')) {
    return { kind: 'low_dictionary_value_or_named_entity', action: 'filter_or_manual_review', tags };
  }
  if (tags.includes('rare_single_han') || tags.includes('single_kana_item')) {
    return { kind: 'orthography_or_variant_entry', action: 'specialized_prompt_or_filter', tags };
  }
  if (errors.some((error) => error.startsWith('missing_pronunciation'))) {
    return { kind: 'pronunciation_missing', action: 'add_pronunciation_fallback_then_retry', tags };
  }
  if (
    errors.some((error) => error.startsWith('term_language_')) ||
    errors.includes('en_term_copies_non_english_source')
  ) {
    return { kind: 'term_language_validation', action: 'specialized_prompt_then_retry', tags };
  }
  if (errors.some((error) => error.startsWith('thin_definition'))) {
    return { kind: 'definition_too_thin', action: 'specialized_prompt_then_retry', tags };
  }
  if (!errors.length) return { kind: 'unattempted_or_unlogged', action: 'retry_with_same_pipeline', tags };
  return { kind: 'other_validation_error', action: 'manual_review_or_specialized_prompt', tags };
}

function riskTags(row) {
  const tags = [];
  const word = String(row.word || '')
    .normalize('NFKC')
    .trim();
  const gloss = String(row.first_gloss_key || row.first_gloss_preview || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (row.source_lang === 'en' && /^[A-Z0-9]{2,}$/u.test(word)) tags.push('acronym_or_code');
  if (row.source_lang === 'en' && /^[A-Za-z]$/u.test(word)) tags.push('symbol_or_letter');
  if (row.source_lang === 'ja' && /^[\u3040-\u30ffーｰ]$/u.test(word)) tags.push('single_kana_item');
  if (row.source_lang === 'zh' && /^[\u3400-\u9fff]$/u.test(word) && row.frequency_rank > 3000) {
    tags.push('rare_single_han');
  }
  if (/\b(surname|given name|family name|male name|female name|proper noun)\b/u.test(gloss)) tags.push('proper_name');
  if (/\b(facebook|dvd|software|website|brand|trademark)\b/u.test(`${word.toLowerCase()} ${gloss}`)) {
    tags.push('brand_or_software');
  }
  if (/\b(letter|symbol|unit|prefix|suffix|abbreviation|acronym)\b/u.test(gloss)) tags.push('symbol_or_letter');
  return tags;
}

function loadAttemptErrors(filePath) {
  const attempts = new Map();
  if (!filePath) return attempts;
  const log = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const item of log.rejected || []) {
    attempts.set(String(item.source_entry_id), {
      errors: item.errors || [],
      endpoint: item.endpoint || null,
      seconds: item.seconds ?? null
    });
  }
  for (const item of log.generated || []) {
    if (!item.valid) {
      attempts.set(String(item.source_entry_id), {
        errors: item.errors || [],
        endpoint: item.endpoint || null,
        seconds: item.seconds ?? null
      });
    }
  }
  return attempts;
}

function nextStep(summary) {
  if (!summary.residual_total) return 'No clean source-gap residuals remain. Run fast audit, then export/release.';
  return 'Do not rerun the generic source-gap pipeline first. Filter low-value residuals, then run a specialized residual prompt for term-language and pronunciation failures.';
}

function sampleBy(rows, field, limit) {
  const samples = {};
  for (const row of rows) {
    const key = row[field] || 'unknown';
    if (!samples[key]) samples[key] = [];
    if (samples[key].length < limit) samples[key].push(row);
  }
  return samples;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value || ''] = (counts[value || ''] || 0) + 1;
  return counts;
}

function countReasons(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const keyName = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) result[keyName] = 'true';
    else {
      result[keyName] = next;
      index++;
    }
  }
  return result;
}
