import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  dailyCandidateReasons,
  setDailyFrequencyRankLimit
} from './lib/daily-candidate-quality.mjs';

const args = parseArgs(process.argv.slice(2));
if (args['max-frequency-rank']) {
  setDailyFrequencyRankLimit(args['max-frequency-rank']);
}
const reportPath = requiredPath(args.report, 'report');
const outPath = requiredPath(args.out, 'out');
const limit = positiveInteger(args.limit, 20);
const zhQuota = nonNegativeInteger(args['zh-quota'], Math.ceil(limit / 2));
const jaQuota = nonNegativeInteger(args['ja-quota'], limit - zhQuota);
const ptQuota = nonNegativeInteger(args['pt-br-quota'], 0);
const enQuota = nonNegativeInteger(args['en-quota'], 0);
const minimumTargetCoverage = nonNegativeInteger(args['minimum-target-coverage'], 3);
const minimumMatchingSources = nonNegativeInteger(args['minimum-matching-sources'], 0);
const minimumMatchRatio = boundedRatio(args['minimum-match-ratio'], 0);
const includeExtended = args['include-extended'] === 'true';
const allowExistingQueryable = args['allow-existing-queryable'] === 'true';
const allowMissingDailyTier = args['allow-missing-daily-tier'] === 'true';
const qualityProfile = String(args['quality-profile'] || 'daily-general').trim();
const excludedCandidateKeys = loadExcludedCandidateKeys(args['exclude-reports']);
const sourceLanguageQuotas = {
  zh: zhQuota,
  ja: jaQuota,
  'pt-BR': ptQuota,
  en: enQuota
};
const quotas = new Map(Object.entries(sourceLanguageQuotas));
const enabledSourceLangs = new Set(
  Object.entries(sourceLanguageQuotas)
    .filter(([, quota]) => quota > 0)
    .map(([lang]) => lang)
);

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const productDbPath = path.resolve(args['product-db'] || report.product_db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
if (!fs.existsSync(productDbPath)) throw new Error(`Product DB not found: ${productDbPath}`);
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
productDb.pragma('query_only = ON');
const publishedLocalizationTerms = new Set(productDb.prepare(`
  SELECT DISTINCT pl.term
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pe.status = 'accepted' AND ps.status = 'accepted' AND pl.needs_review = 0
`).all().map((row) => String(row.term || '').normalize('NFKC')));
const input = Array.isArray(report.selected) ? report.selected : [];
const rejected = [];
const eligible = [];

for (const row of input) {
  const reason = rejectionReason(row);
  if (reason) rejected.push({ ...compact(row), reason });
  else eligible.push(row);
}

eligible.sort((left, right) => score(right) - score(left) || Number(left.frequency_rank || Infinity) - Number(right.frequency_rank || Infinity));
const selected = [];
const selectedConcepts = new Set();
for (const row of eligible) {
  const remaining = quotas.get(row.source_lang) || 0;
  if (remaining <= 0) continue;
  const concept = normalizeConcept(selectedGloss(row));
  if (concept && selectedConcepts.has(concept)) continue;
  selected.push({
    ...row,
    daily_scale_selection: {
      score: score(row),
      target_coverage_count: targetCoverage(row),
      automatic_promotion: false,
      required_next_gate: 'qwen_source_review'
    }
  });
  if (concept) selectedConcepts.add(concept);
  quotas.set(row.source_lang, remaining - 1);
  if (selected.length >= limit) break;
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  policy: {
    daily_tiers: includeExtended ? ['core', 'common', 'extended'] : ['core', 'common'],
    minimum_target_coverage: minimumTargetCoverage,
    minimum_matching_sources: minimumMatchingSources,
    minimum_match_ratio: minimumMatchRatio,
    exclude_numeric_glosses: true,
    exclude_proper_and_specialized_glosses: true,
    exclude_existing_published_localization_lookup: true,
    allow_existing_queryable_for_additional_sense: allowExistingQueryable,
    allow_missing_daily_tier_for_additional_sense: allowMissingDailyTier,
    exclude_previously_attempted_candidates: excludedCandidateKeys.size,
    quality_profile: qualityProfile,
    automatic_promotion: false,
    source_language_quotas: sourceLanguageQuotas
  },
  summary: {
    input: input.length,
    eligible: eligible.length,
    selected: selected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    rejected: rejected.length,
    rejected_by_reason: countBy(rejected, (row) => row.reason)
  },
  selected_count: selected.length,
  selected,
  rejected_preview: rejected.slice(0, 100)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function rejectionReason(row) {
  if (!enabledSourceLangs.has(row.source_lang)) return 'unsupported_source_lang';
  if (excludedCandidateKeys.has(candidateKey(row))) return 'previously_attempted';
  const deterministicDailyReasons = dailyCandidateReasons(row);
  if (deterministicDailyReasons.length) return `daily_quality:${deterministicDailyReasons[0]}`;
  if (!['core', 'common'].includes(row.daily_tier) && !(includeExtended && row.daily_tier === 'extended') && !(allowMissingDailyTier && !row.daily_tier)) return 'non_daily_tier';
  if (targetCoverage(row) < minimumTargetCoverage) return 'insufficient_target_coverage';
  if (matchingSourceCount(row) < minimumMatchingSources) return 'insufficient_matching_sources';
  if (matchRatio(row) < minimumMatchRatio) return 'insufficient_gloss_match_ratio';
  const word = String(row.word || '').trim();
  const gloss = selectedGloss(row);
  if (!word || !gloss) return 'missing_word_or_gloss';
  if (qualityProfile === 'daily-general') {
    const dailyGeneralReason = dailyGeneralRejectionReason(row, word, gloss);
    if (dailyGeneralReason) return dailyGeneralReason;
  }
  if (looksLikeProperNamePartOfSpeech(row.part_of_speech) || looksLikeStandaloneProperNameGloss(gloss)) {
    return 'proper_name';
  }
  if (!allowExistingQueryable && publishedLocalizationTerms.has(word.normalize('NFKC'))) return 'already_queryable_localization';
  if (/\d/u.test(word) || /(?:^|\b)\d+(?:st|nd|rd|th)?(?:\b|$)/iu.test(gloss)) return 'numeric';
  if (/\b(?:city|province|prefecture|territory|republic|country name|surname|given name|brand|company|dynasty|emperor|chemical|enzyme|protein|disease|syndrome|military|weapon|taxon|species|genus|war|wartime|bomb|missile|army|monarch|pope|camp|religion|political|glycosuria|diabetes|masturbation|sexual harassment)\b/iu.test(gloss)) return 'proper_or_specialized';
  if (/^(?:zero|one|two|three|four|five|six|seven|eight|nine|ten)$/iu.test(gloss)) return 'numeric';
  if (/\b(?:archaic|obsolete|historical|rare|literary)\b/iu.test(gloss)) return 'non_modern';
  if (/(?:市|県|省|氏|姓)$/u.test(word) && /\b(?:city|prefecture|province|surname)\b/iu.test(gloss)) return 'proper_name';
  if (gloss.length > 120) return 'broad_or_verbose_gloss';
  return null;
}

function dailyGeneralRejectionReason(row, word, gloss) {
  const normalizedWord = word.normalize('NFKC').toLocaleLowerCase();
  const normalizedGloss = gloss.normalize('NFKC').toLocaleLowerCase();

  // Keep the main expansion lane neutral and useful for ordinary lookup. These
  // entries can be handled later by dedicated slang, proper-name, and domain lanes.
  if (/(?:^|\b)(?:porn|porno|pornô|cunt|bitch|shit|fuck|slut|pussy|blowjob|vomit|fetish|virgin|striptease)(?:\b|$)/iu.test(`${normalizedWord} ${normalizedGloss}`) ||
      /(?:クソ|うんこ|フェラ|ゲロ|フェチ|バージン|屄|婊子|淫穴|拉屎|猥亵)/u.test(`${word} ${gloss}`)) {
    return 'non_neutral_register';
  }
  if (/^(?:tesla|weber|pascal|joule|watt|kelvin|hertz|newton|volt|ampere|ohm)$/iu.test(normalizedWord)) {
    return 'measurement_unit';
  }
  if (['en', 'pt-BR'].includes(row.source_lang) && /^\p{Lu}/u.test(word)) return 'capitalized_proper_like';
  if (['en', 'pt-BR'].includes(row.source_lang) && /^[a-z]{1,3}$/iu.test(word) && !/^(?:a|an|as|at|be|by|do|go|he|i|if|in|is|it|me|my|no|of|on|or|so|to|up|us|we)$/iu.test(word)) {
    return 'short_abbreviation_or_fragment';
  }
  if (row.source_lang === 'en' && /(?:ing|ed)$/iu.test(word)) {
    return 'english_inflected_form';
  }
  if (row.source_lang === 'pt-BR' && /^(?:primeir[oa]s?|segund[oa]s?|terceir[oa]s?|quart[oa]s?|quint[oa]s?|sext[oa]s?|s[eé]tim[oa]s?|oitav[oa]s?|non[oa]s?|d[eé]cim[oa]s?)$/iu.test(normalizedWord)) {
    return 'ordinal_form';
  }
  if (/\b(?:slang|vulgar|offensive|derogatory|insult|expletive|profanity|sexual act|genitalia)\b/iu.test(normalizedGloss)) {
    return 'non_neutral_register';
  }
  if (/\b(?:reggae|derby|commonwealth|trinity|baron|terrier|lactose|mainframe|occult|platinum|treason|embassy|council|martial|chemical element)\b/iu.test(`${normalizedWord} ${normalizedGloss}`)) {
    return 'domain_or_proper_like';
  }
  if (/(?:Havana|Antarctica|Goethe|Hamlet|ハーグ|ゲーテ|ハムレット)/iu.test(`${word} ${gloss}`)) {
    return 'proper_name';
  }
  return null;
}

function looksLikeProperNamePartOfSpeech(value) {
  return /(?:^|[;&\s-])(?:name|n-pr|proper)(?:$|[;&\s-])/iu.test(String(value || ''));
}

function looksLikeStandaloneProperNameGloss(value) {
  const gloss = String(value || '').trim();
  if (!gloss || gloss.length > 48 || /\s/u.test(gloss)) return false;
  return /^(?:[A-Z][\p{L}\p{M}'’-]*)(?:-[A-Z][\p{L}\p{M}'’-]*)*$/u.test(gloss);
}

function loadExcludedCandidateKeys(value) {
  const keys = new Set();
  for (const file of String(value || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    const resolved = path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error(`Excluded report not found: ${resolved}`);
    const report = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    for (const row of [...(report.selected || []), ...(report.reviews || []), ...(report.generated || [])]) {
      const key = candidateKey(row);
      if (key) keys.add(key);
    }
  }
  return keys;
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.first_sense_id ?? row?.output?.source_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function score(row) {
  const rank = Math.max(1, Number(row.frequency_rank || 200000));
  const daily = Number(row.daily_priority || 0);
  const coverage = targetCoverage(row);
  const matchRatio = Number(row.reverse_evidence_prefilter?.match_ratio || 0);
  const sourceCount = row.reverse_evidence_prefilter?.matching_sources?.length || 0;
  const gloss = selectedGloss(row);
  const compactGlossBonus = gloss.length <= 36 ? 5000 : gloss.length <= 64 ? 2000 : 0;
  const tierPenalty = row.daily_tier === 'extended' ? 150000 : 0;
  return daily + coverage * 15000 + sourceCount * 3000 + matchRatio * 10000 + compactGlossBonus - rank - tierPenalty;
}

function targetCoverage(row) {
  return Number(row.reverse_evidence_prefilter?.target_coverage_count || 0);
}

function matchingSourceCount(row) {
  return Array.isArray(row.reverse_evidence_prefilter?.matching_sources)
    ? row.reverse_evidence_prefilter.matching_sources.length
    : 0;
}

function matchRatio(row) {
  const value = Number(row.reverse_evidence_prefilter?.match_ratio || 0);
  return Number.isFinite(value) ? value : 0;
}

function selectedGloss(row) {
  return String(
    row.daily_sense_selection?.selected?.gloss ||
      row.first_gloss_preview ||
      row.gloss_preview ||
      row.gloss_key ||
      ''
  ).trim();
}

function normalizeConcept(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compact(row) {
  return {
    source_entry_id: row.source_entry_id,
    source_sense_id: row.first_sense_id,
    word: row.word,
    source_lang: row.source_lang,
    frequency_rank: row.frequency_rank,
    gloss: selectedGloss(row)
  };
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(String(value));
  if (name === 'report' && !fs.existsSync(resolved)) throw new Error(`Report not found: ${resolved}`);
  return resolved;
}

function positiveInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Expected positive integer, got ${value}`);
  return parsed;
}

function nonNegativeInteger(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected non-negative integer, got ${value}`);
  return parsed;
}

function boundedRatio(value, fallback) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected ratio between 0 and 1, got ${value}`);
  }
  return parsed;
}

function relative(value) {
  return path.relative(process.cwd(), value);
}
