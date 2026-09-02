#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const sourceDbPath = requiredPath(args['source-db'], 'source-db');
const productDbPath = requiredPath(
  args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db',
  'product-db'
);
const outPath = path.resolve(args.out || 'logs/product-daily-primary-senses.json');
const rejectedOutPath = path.resolve(args['rejected-out'] || outPath.replace(/\.json$/u, '-rejected.json'));
const minimumScore = Number(args['min-score'] || 2_500);
const requireNativeSource = args['require-native-source'] === 'true';
const allowLinkedPrimaryForAdditionalSense =
  args['allow-linked-primary-for-additional-sense'] === 'true';
const excludedReportPaths = [args.exclude, args['attempt-index']]
  .filter(Boolean)
  .flatMap((value) => String(value).split(','))
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => requiredPath(value, 'exclude'));
const attemptedSourceSenses = loadAttemptedSourceSenses(excludedReportPaths);

const report = readJson(reportPath);
const candidates = Array.isArray(report.selected) ? report.selected : [];
const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
productDb.pragma('query_only = ON');

const senses = sourceDb.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND needs_review = 0
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
`);
const localizations = sourceDb.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system,
         definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang, id
`);
const linkedProductSense = productDb.prepare(`
  SELECT ps.id, ps.status
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  WHERE link.source_sense_id = ?
    AND ps.status IN ('accepted', 'draft_single_source')
  LIMIT 1
`);

const selected = [];
const rejected = [];
for (const candidate of candidates) {
  const sourceSenses = senses.all(candidate.source_entry_id);
  const firstOrderBySource = new Map();
  for (const sense of sourceSenses) {
    const key = String(sense.source || 'unknown');
    if (!firstOrderBySource.has(key)) firstOrderBySource.set(key, Number(sense.sense_order));
  }
  const alternatives = sourceSenses.map((sense) =>
    inspectSense(candidate, sense, firstOrderBySource.get(String(sense.source || 'unknown')))
  );
  const primaryNativeSense = alternatives
    .filter((sense) => isNativeSource(candidate.source_lang, sense.source) && !sense.blocked_reason)
    .sort((left, right) => left.sense_order - right.sense_order)[0];
  if (primaryNativeSense?.linked_product_sense && !allowLinkedPrimaryForAdditionalSense) {
    rejected.push({
      ...identity(candidate),
      reason: 'primary_native_sense_already_linked_use_entry_form_alias',
      linked_product_sense: primaryNativeSense.linked_product_sense,
      alternatives: alternatives.slice(0, 12).map(compactAlternative)
    });
    continue;
  }
  const otherwiseEligible = alternatives.filter(
    (sense) => !sense.linked_product_sense && !sense.blocked_reason
  );
  const eligible = otherwiseEligible.filter(
    (sense) => !attemptedSourceSenses.has(sourceSenseKey(candidate.source_entry_id, sense.id))
  );
  eligible.sort((left, right) => right.daily_sense_score - left.daily_sense_score || left.sense_order - right.sense_order);
  const best = eligible[0];
  if (!best || best.daily_sense_score < minimumScore) {
    rejected.push({
      ...identity(candidate),
      reason: best
        ? 'daily_sense_score_below_threshold'
        : otherwiseEligible.length > 0
          ? 'all_eligible_source_senses_attempted'
          : 'no_eligible_source_sense',
      best_score: best?.daily_sense_score ?? null,
      alternatives: alternatives.slice(0, 12).map(compactAlternative)
    });
    continue;
  }
  selected.push({
    ...candidate,
    candidate_key: `${candidate.source_entry_id}:${best.id}`,
    first_sense_id: best.id,
    first_sense_order: best.sense_order,
    part_of_speech: best.part_of_speech,
    gloss_key: best.gloss_key,
    gloss_preview: preview(best.gloss_key, 180),
    first_sense_clean_localization_langs: best.clean_localization_langs,
    first_sense_clean_localization_lang_count: best.clean_localization_langs.length,
    first_sense_localizations: best.localizations,
    daily_sense_selection: {
      policy: allowLinkedPrimaryForAdditionalSense
        ? 'native_dictionary_additional_unlinked_sense'
        : 'native_dictionary_then_daily_semantics',
      score: best.daily_sense_score,
      reasons: best.score_reasons,
      original_sense_id: candidate.first_sense_id ?? null,
      changed: Number(candidate.first_sense_id) !== Number(best.id),
      alternatives: compactSelectedAlternatives(alternatives, best),
      requires_independent_source_review: true
    }
  });
}

sourceDb.close();
productDb.close();

const common = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  source_db: relative(sourceDbPath),
  product_db: relative(productDbPath),
  policy: {
    one_primary_daily_sense_per_entry: true,
    native_lexicon_source_preferred: true,
    existing_product_links_excluded: true,
    independent_source_review_still_required: true,
    automatic_publication: false,
    minimum_score: minimumScore,
    require_native_source: requireNativeSource,
    allow_linked_primary_for_additional_sense: allowLinkedPrimaryForAdditionalSense,
    excluded_reports: excludedReportPaths.map(relative),
    attempted_source_senses: attemptedSourceSenses.size
  },
  summary: {
    input: candidates.length,
    selected: selected.length,
    rejected: rejected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    changed_from_report_first_sense: selected.filter((row) => row.daily_sense_selection.changed).length,
    excluded_attempted_senses: attemptedSourceSenses.size,
    selected_by_source: countBy(selected, (row) => row.daily_sense_selection.alternatives.find((item) => item.id === row.first_sense_id)?.source)
  }
};

writeJson(outPath, { ...common, selected_count: selected.length, selected });
writeJson(rejectedOutPath, { ...common, rejected_count: rejected.length, rejected });
console.log(JSON.stringify({ ok: true, out: relative(outPath), rejected_out: relative(rejectedOutPath), summary: common.summary }, null, 2));

function inspectSense(candidate, sense, firstSourceSenseOrder) {
  const rows = localizations.all(sense.id).filter(isCleanLocalization).map(compactLocalization);
  const cleanLangs = [...new Set(rows.map((row) => row.lang))].sort();
  const gloss = String(sense.gloss_key || '').normalize('NFKC').trim();
  const linked = linkedProductSense.get(sense.id) || null;
  const scoreReasons = [];
  let score = nativeSourceScore(candidate.source_lang, sense.source);
  if (score) scoreReasons.push('native_lexicon_source');
  if (Number(sense.sense_order) === Number(firstSourceSenseOrder)) {
    score += 2_000;
    scoreReasons.push('first_sense_within_native_source');
  }
  score += cleanLangs.length * 700;
  if (cleanLangs.length >= 3) scoreReasons.push('multilingual_source_localizations');
  if (hasDailyGlossSignal(gloss)) {
    score += 1_000;
    scoreReasons.push('daily_gloss_signal');
  }
  if (hasReadableEnglishGloss(gloss)) {
    score += 800;
    scoreReasons.push('readable_english_gloss');
  }
  if (sense.part_of_speech && !String(sense.part_of_speech).startsWith('&')) score += 250;
  score -= Math.min(1_000, Math.max(0, Number(sense.sense_order || 1) - 1) * 50);

  let blockedReason = null;
  if (requireNativeSource && !isNativeSource(candidate.source_lang, sense.source))
    blockedReason = 'non_native_lexicon_source';
  else if (isMetaLetterSense(gloss)) blockedReason = 'metalinguistic_letter_or_symbol_sense';
  else if (isProperOrSpecialized(gloss)) blockedReason = 'proper_or_specialized_gloss';
  else if (hasWrongScriptGloss(gloss, candidate.source_lang)) blockedReason = 'wrong_script_or_translation_only_gloss';

  return {
    ...sense,
    linked_product_sense: linked,
    localizations: rows,
    clean_localization_langs: cleanLangs,
    daily_sense_score: blockedReason ? -1 : score,
    score_reasons: scoreReasons,
    blocked_reason: blockedReason
  };
}

function nativeSourceScore(lang, source) {
  const value = String(source || '').toLocaleLowerCase();
  if (lang === 'zh') {
    if (value.includes('cc-cedict')) return 6_000;
    if (value.includes('kaikki-zh')) return 4_500;
  }
  if (lang === 'ja') {
    if (value.includes('jmdict')) return 6_000;
    if (value.includes('kaikki-ja')) return 4_500;
  }
  if (lang === 'pt-BR') {
    if (value.includes('dicionario') || value.includes('freedict')) return 6_000;
    if (value.includes('kaikki-pt')) return 4_500;
  }
  if (lang === 'en') {
    if (value.includes('freedict-eng-por')) return 6_000;
    if (value.includes('ecdict')) return 6_000;
    if (value.includes('wordnet')) return 5_500;
    if (value.includes('kaikki-en')) return 4_500;
  }
  if (value.includes('omw')) return 2_500;
  if (value.includes('wikdict')) return 1_500;
  return 500;
}

function isNativeSource(lang, source) {
  const value = String(source || '').toLocaleLowerCase();
  if (lang === 'zh') return value.includes('cc-cedict') || value.includes('kaikki-zh');
  if (lang === 'ja') return value.includes('jmdict') || value.includes('kaikki-ja');
  if (lang === 'pt-BR')
    return value.includes('dicionario') || value.includes('freedict') || value.includes('kaikki-pt');
  if (lang === 'en')
    return (
      value.includes('freedict-eng-por') ||
      value.includes('ecdict') ||
      value.includes('wordnet') ||
      value.includes('kaikki-en')
    );
  return false;
}

function hasDailyGlossSignal(gloss) {
  return /\b(?:go|come|leave|arrive|return|eat|drink|cook|buy|sell|pay|cost|work|job|study|learn|school|teacher|student|home|house|family|relative|friend|food|water|time|day|night|today|tomorrow|yesterday|morning|evening|train|bus|car|road|street|hotel|room|shop|store|restaurant|hospital|doctor|body|weather|rain|hot|cold|good|bad|big|small|want|need|like|love|know|understand|think|say|speak|see|look|hear|give|take|make|use|open|close|start|stop|help|please|thanks|sorry|hello|yes|no|where|when|what|why|how|origin|background|person|thing|place)\b/iu.test(
    gloss
  );
}

function hasReadableEnglishGloss(gloss) {
  const latin = gloss.match(/\p{Script=Latin}/gu)?.length || 0;
  return gloss.length >= 3 && latin / Math.max(1, [...gloss].length) >= 0.45;
}

function isMetaLetterSense(gloss) {
  return /\b(?:letter of the .*alphabet|the letter|spelling of|symbol for|blood group|radioactive|for loop)\b/iu.test(gloss);
}

function isProperOrSpecialized(gloss) {
  return /\b(?:surname|given name|family name|place name|province|county|municipality|special administrative region|capital of|chemical element|enzyme|protein|genus|species|taxonomy|pathology|surgery|anatomy|botany|zoology|geology|mineralogy|legal|archaic|obsolete)\b/iu.test(
    gloss
  );
}

function hasWrongScriptGloss(gloss, sourceLang) {
  if (sourceLang === 'ja' && /^[\p{Script=Han}]+$/u.test(gloss)) return true;
  if (sourceLang === 'pt-BR' && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(gloss)) return true;
  return false;
}

function compactAlternative(sense) {
  return {
    id: sense.id,
    sense_order: sense.sense_order,
    part_of_speech: sense.part_of_speech,
    gloss: preview(sense.gloss_key, 180),
    source: sense.source,
    clean_langs: sense.clean_localization_langs,
    score: sense.daily_sense_score,
    blocked_reason: sense.blocked_reason,
    linked_product_sense: sense.linked_product_sense
  };
}

function compactSelectedAlternatives(alternatives, selectedSense) {
  const rows = [selectedSense, ...alternatives.filter((sense) => sense.id !== selectedSense.id)];
  return rows.slice(0, 12).map(compactAlternative);
}

function compactLocalization(row) {
  return {
    lang: row.lang,
    term: row.term,
    reading: row.reading || null,
    reading_system: row.reading_system || null,
    pronunciation: row.pronunciation || null,
    pronunciation_system: row.pronunciation_system || null,
    definition: row.definition,
    source: row.source,
    confidence: row.confidence,
    needs_review: row.needs_review
  };
}

function isCleanLocalization(row) {
  return !row.needs_review && clean(row.term) && clean(row.definition);
}

function clean(value) {
  const text = String(value || '').normalize('NFKC').trim();
  return text && !/\uFFFD|<[^>]+>/u.test(text) ? text : '';
}

function loadAttemptedSourceSenses(reportPaths) {
  const keys = new Set();
  for (const reportFilePath of reportPaths) collectAttemptedSourceSenses(readJson(reportFilePath), keys);
  return keys;
}

function collectAttemptedSourceSenses(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) collectAttemptedSourceSenses(item, keys);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const sourceEntryId = value.source_entry_id;
  const sourceSenseId = value.source_sense_id ?? value.first_sense_id;
  if (sourceEntryId != null && sourceSenseId != null) {
    keys.add(sourceSenseKey(sourceEntryId, sourceSenseId));
  }

  for (const [name, child] of Object.entries(value)) {
    if (
      name === 'selected' ||
      name === 'candidates' ||
      name === 'rows' ||
      name === 'accepted' ||
      name === 'rejected' ||
      name === 'completed' ||
      name === 'results'
    ) {
      collectAttemptedSourceSenses(child, keys);
    }
  }
}

function sourceSenseKey(sourceEntryId, sourceSenseId) {
  return `${Number(sourceEntryId)}:${Number(sourceSenseId)}`;
}

function identity(row) {
  return {
    source_entry_id: row.source_entry_id,
    source_lang: row.source_lang,
    word: row.word,
    frequency_consensus: row.frequency_consensus,
    daily_tier: row.daily_tier
  };
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function preview(value, length) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    parsed[token.slice(2)] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const filePath = path.resolve(value);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return filePath;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
