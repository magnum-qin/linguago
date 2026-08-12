import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DEFAULT_IN = 'logs/product-coverage-gaps-20260622.json';
const DEFAULT_OUT = 'logs/product-coverage-gaps-clean-high-value.json';
const FUNCTION_GLOSSES = new Set([
  'a',
  'an',
  'the',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'from',
  'by',
  'with',
  'and',
  'or',
  'but',
  'if',
  'as',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'his',
  'her',
  'their',
  'our',
  'its',
  'neither',
  'all',
  'one',
  'two'
]);
const MANUAL_RESIDUAL_SOURCE_ENTRY_IDS = new Set([2512756, 2482999, 2734525, 2607307, 2639444, 2399378, 2649794]);

const args = parseArgs(process.argv.slice(2));
const inPath = path.resolve(args.in || DEFAULT_IN);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const limit = Number(args.limit || 500);
const balanced = args.balanced === 'true';
const fillRemaining = args['fill-remaining'] !== 'false';
const langTargets = parseLangTargets(args['lang-targets']);
const minLangs = Number(args['min-clean-langs'] || 1);
const minFirstSenseLangs = Number(args['min-first-sense-langs'] || 1);
const maxFirstSenseLangs = Number(args['max-first-sense-langs'] || 4);
const minGlossLength = Number(args['min-gloss-length'] || 4);
const sampleLimit = Number(args['sample-limit'] || 80);
const keepRisky = args['keep-risky'] === 'true';
const strictZh = args['strict-zh'] === 'true';
const blockKnownResiduals = args['block-known-residuals'] === 'true';
const allowSupplementalTwoLangEvidence = args['allow-supplemental-two-lang-evidence'] === 'true';
const requiredEvidenceGate = String(args['required-evidence-gate'] || '').trim();
const excludedSourceEntryIds = new Set(
  String(args['exclude-source-entry-ids'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger)
);
const excludedSourceEntryIdFiles = String(args['exclude-source-entry-id-files'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
for (const filePath of excludedSourceEntryIdFiles) {
  if (!fs.existsSync(filePath)) throw new Error(`Source-entry exclusion file not found: ${filePath}`);
  addSourceEntryIds(excludedSourceEntryIds, JSON.parse(fs.readFileSync(filePath, 'utf8')));
}
const excludedSourceSenseKeys = new Set();
const excludedSourceSenseKeyFiles = String(args['exclude-source-sense-key-files'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(value));
for (const filePath of excludedSourceSenseKeyFiles) {
  if (!fs.existsSync(filePath)) throw new Error(`Source-sense exclusion file not found: ${filePath}`);
  addSourceSenseKeys(excludedSourceSenseKeys, JSON.parse(fs.readFileSync(filePath, 'utf8')));
}
const traditionalToSimplified = strictZh ? OpenCC.Converter({ from: 'tw', to: 'cn' }) : null;
const KNOWN_RESIDUAL_KEYS = new Set([
  'en|audible|n. a football play is changed orally after both teams have assumed their positions at the line of scrimmage\\na. heard or perceptible by the ear',
  'en|maneuver|n. a military training exercise\\nn. a deliberate coordinated movement requiring dexterity and skill\\nn. a move made to gain a tactical end\\nv. act in order to achieve a certain goal\\nv. direct the course; determine the direction of travelling\\nv. perform a movement in military or naval tactics in order to secure an advantage in attack or defense',
  'en|allegedly|r. according to what has been alleged',
  'en|tram|v. travel by tram',
  'en|minimal|a. the least possible',
  'pt-BR|ouvintes|audience',
  'pt-BR|seja|are',
  'pt-BR|ama|lady',
  'ja|だめ|ruin',
  'ja|だめ|ruin, spoil',
  'ja|わけ|difficulty; obstacle',
  'pt-BR|bisavó|great-grandmother'
]);

if (!fs.existsSync(inPath)) throw new Error(`Coverage gap report not found: ${inPath}`);
if (!Number.isInteger(limit) || limit < 1) throw new Error(`Invalid --limit: ${args.limit}`);
if (!Number.isInteger(minLangs) || minLangs < 1 || minLangs > 4) {
  throw new Error(`Invalid --min-clean-langs: ${args['min-clean-langs']}`);
}
if (!Number.isInteger(minFirstSenseLangs) || minFirstSenseLangs < 0 || minFirstSenseLangs > 4) {
  throw new Error(`Invalid --min-first-sense-langs: ${args['min-first-sense-langs']}`);
}
if (!Number.isInteger(maxFirstSenseLangs) || maxFirstSenseLangs < minFirstSenseLangs || maxFirstSenseLangs > 4) {
  throw new Error(`Invalid --max-first-sense-langs: ${args['max-first-sense-langs']}`);
}
if (requiredEvidenceGate && !['canonical_localizations', 'kaikki_raw_two_lang'].includes(requiredEvidenceGate)) {
  throw new Error(`Invalid --required-evidence-gate: ${requiredEvidenceGate}`);
}

const report = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const rows = Array.isArray(report.selected) ? report.selected : [];
const eligible = [];
const rejected = [];

for (const row of rows) {
  const reasons = rejectReasons(row);
  if (reasons.length) {
    rejected.push(compactRejected(row, reasons));
    continue;
  }
  eligible.push({
    ...row,
    evidence_gate: usesSupplementalEvidence(row) ? 'kaikki_raw_two_lang' : 'canonical_localizations',
    quality_bucket: qualityBucket(row),
    quality_reasons: qualityReasons(row)
  });
  if (!balanced && eligible.length >= limit) break;
}

const accepted = balanced ? selectBalanced(eligible, limit, langTargets, fillRemaining) : eligible.slice(0, limit);

const summary = {
  input: path.relative(process.cwd(), inPath),
  output: path.relative(process.cwd(), outPath),
  source_selected: rows.length,
  clean_selected: accepted.length,
  rejected_scanned: rejected.length,
  limit,
  min_clean_langs: minLangs,
  min_first_sense_langs: minFirstSenseLangs,
  max_first_sense_langs: maxFirstSenseLangs,
  min_gloss_length: minGlossLength,
  balanced,
  fill_remaining: fillRemaining,
  lang_targets: langTargets,
  eligible_scanned: eligible.length,
  keep_risky: keepRisky,
  strict_zh: strictZh,
  block_known_residuals: blockKnownResiduals,
  allow_supplemental_two_lang_evidence: allowSupplementalTwoLangEvidence,
  required_evidence_gate: requiredEvidenceGate || null,
  excluded_source_entry_ids: excludedSourceEntryIds.size,
  excluded_source_entry_id_files: excludedSourceEntryIdFiles.map((filePath) => path.relative(process.cwd(), filePath)),
  excluded_source_sense_keys: excludedSourceSenseKeys.size,
  excluded_source_sense_key_files: excludedSourceSenseKeyFiles.map((filePath) =>
    path.relative(process.cwd(), filePath)
  ),
  rejected_by_reason: countReasons(rejected),
  clean_by_lang: countBy(accepted.map((row) => row.source_lang)),
  clean_by_quality_bucket: countBy(accepted.map((row) => row.quality_bucket)),
  eligible_by_lang: countBy(eligible.map((row) => row.source_lang)),
  unmet_lang_targets: unmetLangTargets(accepted, langTargets),
  clean_top_frequency_rank: accepted[0]?.frequency_rank ?? null,
  clean_last_frequency_rank: accepted.at(-1)?.frequency_rank ?? null
};

const output = {
  ...report,
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), inPath),
  summary: {
    ...(report.summary || {}),
    high_value_filter: summary
  },
  selected_count: accepted.length,
  selected: accepted,
  rejected_preview: rejected.slice(0, sampleLimit),
  next_step:
    'Run supplement-dictionary-v2-product-source-gaps-unsloth.mjs against this clean report in dry-run mode first.'
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary }, null, 2));

function rejectReasons(row) {
  const reasons = [];
  const word = String(row?.word || '').trim();
  const normalizedKey = String(row?.normalized_key || '').trim();
  const sourceLang = row?.source_lang;
  const gloss = String(
    row?.first_gloss_key || row?.gloss_key || row?.first_gloss_preview || row?.gloss_preview || ''
  ).trim();
  const cleanLangCount = Number(row?.clean_localization_lang_count || 0);
  const firstSenseCleanLangCount = Number(row?.first_sense_clean_localization_lang_count || 0);
  const hasSupplementalTwoLangEvidence = supplementalTwoLangEvidenceIsUsable(row);
  const evidenceGate = usesSupplementalEvidence(row) ? 'kaikki_raw_two_lang' : 'canonical_localizations';

  if (!LANGS.includes(sourceLang)) reasons.push('invalid_source_lang');
  if (requiredEvidenceGate && evidenceGate !== requiredEvidenceGate) reasons.push('evidence_gate_mismatch');
  if (!word) reasons.push('empty_word');
  if (MANUAL_RESIDUAL_SOURCE_ENTRY_IDS.has(Number(row?.source_entry_id))) reasons.push('manual_source_gap_residual');
  if (excludedSourceEntryIds.has(Number(row?.source_entry_id))) reasons.push('excluded_source_entry_id');
  if (excludedSourceSenseKeys.has(sourceSenseKey(row))) reasons.push('excluded_source_sense_key');
  if (!gloss) reasons.push('missing_gloss');
  if (blockKnownResiduals && KNOWN_RESIDUAL_KEYS.has(sourceGapKey(row))) reasons.push('known_source_term_residual');
  if (cleanLangCount < minLangs && !hasSupplementalTwoLangEvidence) reasons.push('too_few_clean_langs');
  if (firstSenseCleanLangCount < minFirstSenseLangs && !hasSupplementalTwoLangEvidence)
    reasons.push('too_few_first_sense_clean_langs');
  if (firstSenseCleanLangCount > maxFirstSenseLangs) reasons.push('too_many_first_sense_clean_langs');
  if (cleanLangCount <= 1 && gloss.length < Math.max(8, minGlossLength)) reasons.push('thin_single_lang_evidence');
  if (gloss.length < minGlossLength) reasons.push('thin_gloss');
  if (isBroadGloss(gloss)) reasons.push('broad_gloss');

  if (hasBadEncoding(word, sourceLang) || hasBadEncoding(normalizedKey, sourceLang)) reasons.push('source_mojibake');
  if (hasBadEncoding(gloss, 'en')) reasons.push('gloss_mojibake');
  if (sourceLang && !sourceScriptOk(word, sourceLang)) reasons.push('source_script_mismatch');
  if (sourceLang === 'pt-BR' && isLikelyPtPtHeadword(word)) reasons.push('pt_pt_locale_variant');

  const risk = riskReason(row);
  if (risk && !keepRisky) reasons.push(risk);
  if (strictZh && sourceLang === 'zh') reasons.push(...strictZhRejectReasons(row));

  return [...new Set(reasons)];
}

function isLikelyPtPtHeadword(word) {
  const value = String(word || '').trim().toLocaleLowerCase('pt-BR');
  if (
    new Set([
      'utilizador',
      'multim\u00e9dia',
      '\u00f3ptimo',
      'ac\u00e7\u00e3o',
      'facto',
      'eletr\u00f3nica',
      'champ\u00f4',
      'pol\u00e9mico',
      'falhan\u00e7o',
      'assembly',
      'escale',
      'arsénio'
    ]).has(value)
  )
    return true;
  return /(?:ómico|ómica|ónicos|ónicas|ómeno|ómenos|ónimo|ónima|ónimos|ónimas)$/u.test(value);
}

function isBroadGloss(value) {
  return (
    String(value || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean).length >= 5
  );
}

function strictZhRejectReasons(row) {
  const reasons = [];
  const word = String(row?.word || '').trim();
  const gloss = String(row?.gloss_key || row?.gloss_preview || '')
    .normalize('NFKC')
    .trim();
  if ([...word].length < 2) reasons.push('strict_zh_single_character');
  if (traditionalToSimplified && traditionalToSimplified(word) !== word) reasons.push('strict_zh_traditional_variant');
  if (
    /\b(see|short for|original form|synonym of|variant of|alternative form|J\.R\.R|Tolkien|county|district|city)\b/iu.test(
      gloss
    )
  ) {
    reasons.push('strict_zh_redirect_or_proper_gloss');
  }
  if (/^[A-Z][a-z]+(?:[- ][A-Z][a-z]+)*$/u.test(gloss)) {
    reasons.push('strict_zh_latin_proper_name_gloss');
  }
  if (/[縣區市]/u.test(gloss) || /\[[A-Z][A-Za-z0-9]+\d/u.test(gloss)) {
    reasons.push('strict_zh_proper_name_gloss');
  }
  return reasons;
}

function sourceGapKey(row) {
  const gloss = row?.first_gloss_key || row?.gloss_key || row?.first_gloss_preview || row?.gloss_preview || '';
  return `${row?.source_lang || ''}|${row?.word || ''}|${gloss}`;
}

function selectBalanced(rows, maxItems, targets, shouldFillRemaining) {
  const selected = [];
  const used = new Set();
  for (const lang of LANGS) {
    const target = targets[lang] || 0;
    if (!target) continue;
    for (let index = 0; index < rows.length && selected.length < maxItems; index++) {
      const row = rows[index];
      if (used.has(index) || row.source_lang !== lang) continue;
      selected.push(row);
      used.add(index);
      if (selected.filter((item) => item.source_lang === lang).length >= target) break;
    }
  }
  if (shouldFillRemaining && selected.length < maxItems) {
    for (let index = 0; index < rows.length && selected.length < maxItems; index++) {
      if (used.has(index)) continue;
      selected.push(rows[index]);
      used.add(index);
    }
  }
  return selected;
}

function parseLangTargets(value) {
  const defaults = { zh: 80, 'pt-BR': 60, ja: 40, en: 20 };
  if (!value) return defaults;
  const parsed = {};
  for (const item of String(value).split(',')) {
    const [rawLang, rawCount] = item.split('=');
    const lang = String(rawLang || '').trim();
    const count = Number(rawCount);
    if (!LANGS.includes(lang)) throw new Error(`Unknown --lang-targets lang: ${lang}`);
    if (!Number.isInteger(count) || count < 0) throw new Error(`Invalid --lang-targets count: ${item}`);
    parsed[lang] = count;
  }
  return { ...defaults, ...parsed };
}

function unmetLangTargets(rows, targets) {
  const counts = countBy(rows.map((row) => row.source_lang));
  return Object.fromEntries(
    Object.entries(targets)
      .map(([lang, target]) => [lang, Math.max(0, target - (counts[lang] || 0))])
      .filter(([, missing]) => missing > 0)
  );
}

function riskReason(row) {
  const word = String(row?.word || '').trim();
  const rawGloss = String(row?.gloss_key || row?.gloss_preview || '')
    .normalize('NFKC')
    .trim();
  const gloss = rawGloss.toLowerCase();
  const normalizedWord = normalize(word);
  const knownResidualKey = `${row?.source_lang || ''}|${word}`;
  if (
    new Set([
      'pt-BR|consertado',
      'pt-BR|gritaria',
      'pt-BR|pub',
      'pt-BR|rod',
      'pt-BR|sites',
      'ja|カーク',
      'ja|チャ',
      'ja|ヒマ',
      'zh|弗林特',
      'zh|里格',
      'zh|阿尔卑斯山',
      'zh|老马'
    ]).has(knownResidualKey)
  ) {
    return 'known_source_term_residual';
  }
  if (/\b(mountain range|the alps)\b/u.test(gloss)) {
    return 'proper_name_gloss';
  }
  const latinLetters = normalizeLatinLetters(word);
  const latinOnly = /^[\p{Script=Latin}\s.'’_-]+$/u.test(word);

  if (row?.source_lang === 'en' && normalizedWord === 'maneuver' && /\bmilitary training exercise\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (
    row?.source_lang === 'en' &&
    normalizedWord === 'allegedly' &&
    /\baccording to what has been alleged\b/u.test(gloss)
  ) {
    return 'known_source_term_residual';
  }
  if (row?.source_lang === 'en' && normalizedWord === 'tram' && /\btravel by tram\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (row?.source_lang === 'en' && normalizedWord === 'minimal' && /\bleast possible\b/u.test(gloss)) {
    return 'known_source_term_residual';
  }
  if (
    (row?.source_lang === 'pt-BR' && ['seja', 'ama'].includes(normalizedWord)) ||
    (row?.source_lang === 'ja' && ['だめ', 'わけ'].includes(normalizedWord))
  ) {
    return 'known_source_term_residual';
  }
  if (
    (row?.source_lang === 'pt-BR' && ['acha', 'minutos', 'num'].includes(normalizedWord)) ||
    (row?.source_lang === 'zh' && ['听听', '总会', '出身'].includes(normalizedWord)) ||
    (row?.source_lang === 'ja' && ['思', 'いま', 'ピーター'].includes(normalizedWord))
  ) {
    return 'known_source_term_residual';
  }
  if (
    row?.source_lang === 'pt-BR' &&
    [
      'aceite',
      'acorda',
      'afim',
      'ataca',
      'bicha',
      'blá',
      'brilhando',
      'chan',
      'chapado',
      'coca',
      'colegial',
      'cole',
      'constar',
      'curva',
      'curvas',
      'cuzão',
      'escória',
      'estimação',
      'fax',
      'ferrado',
      'fibras',
      'grãos',
      'japonesa',
      'maricas',
      'mexicana',
      'mínima',
      'observando',
      'pelado',
      'perpétua',
      'promotoria',
      'quites',
      'rancor',
      'resíduos',
      'reunidos',
      'rola',
      'ruiva',
      'saca',
      'sacanagem',
      'saí',
      'stone',
      'tento',
      'terrestre',
      'treinando',
      'transa',
      'vice',
      'viciada',
      'àquele',
      'center'
    ].includes(normalizedWord)
  ) {
    return 'known_source_term_residual';
  }
  if (row?.source_lang === 'ja' && [...word].length === 1) return 'ja_single_character_source_gap';
  if (row?.source_lang === 'ja' && isKatakanaProperNameLike(word, rawGloss)) return 'ja_katakana_proper_name';
  if (
    row?.source_lang === 'ja' &&
    /^[\p{Script=Katakana}ー・]+$/u.test(word) &&
    /^\p{Lu}[\p{L}.'-]+\s*\(\p{Lu}[\p{L} .'’-]+\)$/u.test(rawGloss)
  ) {
    return 'ja_katakana_proper_name';
  }
  if (row?.source_lang === 'ja' && ['っけ', '受け取', '忘れ', 'あいつ', 'クソ', 'アホ', 'いったい'].includes(word)) {
    return 'known_source_term_residual';
  }
  if (
    row?.source_lang === 'pt-BR' &&
    [
      'abra',
      'apesar',
      'aposto',
      'babaca',
      'branca',
      'conosco',
      'dos',
      'esse',
      'falo',
      'for',
      'indo',
      'irão',
      'leva',
      'levante',
      'maldita',
      'pega',
      'pego',
      'perca',
      'porra',
      'possa',
      'quer',
      'regras',
      'sai',
      'sei',
      'trata'
    ].includes(normalizedWord)
  ) {
    return 'known_source_term_residual';
  }
  if (row?.source_lang === 'zh' && ['說說', '布洛克', '新书', '要做', '樂部'].includes(word)) {
    return 'known_source_term_residual';
  }
  if (
    row?.source_lang === 'ja' &&
    [
      'いく',
      'きみ',
      'たま',
      'ほんと',
      'やつ',
      'アーロン',
      'ウィル',
      'ウソ',
      'ウォルター',
      'ジェイソン',
      'ベイビー',
      '見張'
    ].includes(word)
  ) {
    return 'known_source_term_residual';
  }
  if (row?.source_lang === 'en' && /^[A-Za-z]$/u.test(word)) return 'latin_single_letter';
  if ((row?.source_lang === 'en' || row?.source_lang === 'pt-BR') && /^[A-Z]{2,}$/u.test(word)) return 'latin_acronym';
  if (
    (row?.source_lang === 'en' || row?.source_lang === 'pt-BR') &&
    /^\p{Lu}\p{Ll}+(?:[- ]\p{Lu}\p{Ll}+)*$/u.test(word)
  ) {
    return 'english_capitalized_proper_like';
  }
  if (row?.source_lang === 'pt-BR' && /^\p{Lu}/u.test(word)) {
    return 'pt_capitalized_residual';
  }
  if ((row?.source_lang === 'en' || row?.source_lang === 'pt-BR') && latinOnly && latinLetters.length <= 2) {
    return 'very_short_latin';
  }
  if (/\b(letter of the roman alphabet|blood group|radioactive|unit used in printing|linear unit)\b/u.test(gloss)) {
    return 'encyclopedic_or_symbol_gloss';
  }
  if (
    /\b(surname|given name|male given name|female given name|family name|male name|female name|personal name|country|province|city|region|republic|administrative region|character from|monkey king|mythology|god of|goddess|prophet|poet|painter|composer|writer|novelist|statesman|emperor|king of|queen of|president of|capital of)\b/u.test(
      gloss
    ) ||
    /(?:女子名|男子名|人名)/u.test(gloss)
  ) {
    return 'proper_name_gloss';
  }
  if (
    /\b(terms of abuse|offensive term|vulgar|derogatory|slur|the fuck|fuck|fucking|shit|asshole|dumbass|dipshit|bastard|idiot|excrement|bitch|brokeback|porn|porno|whore|cunt)\b/u.test(
      gloss
    )
  )
    return 'offensive_or_abuse_term';
  if ((row?.source_lang === 'zh' || row?.source_lang === 'ja') && isMostlyRomanizedCjkNameGloss(gloss)) {
    return 'romanized_cjk_proper_name_gloss';
  }
  if (/\b(brand|trademark|company|corporation|facebook|dvd|bmw)\b/u.test(gloss)) return 'brand_or_acronym_gloss';
  if (
    row?.source_lang === 'ja' &&
    /^[\p{Script=Katakana}ー・]+$/u.test(word) &&
    /\b[A-Z][\p{L}.'-]* language\b/u.test(rawGloss)
  ) {
    return 'ja_katakana_proper_name';
  }
  if (
    /\b(variant of|alternative form of|alternative name for|obsolete form of|archaic form of|old variant)\b/u.test(
      gloss
    )
  ) {
    return 'variant_or_alternative_form';
  }
  if (/\b(only used in|used only in|used in|ancient name of)\b/u.test(gloss)) return 'bound_or_rare_character_gloss';
  if (row?.source_lang === 'en' && FUNCTION_GLOSSES.has(gloss)) return 'english_function_gloss';
  if (row?.source_lang === 'pt-BR' && FUNCTION_GLOSSES.has(gloss)) return 'pt_function_word';
  if (row?.source_lang === 'pt-BR' && ['yes'].includes(normalizedWord)) return 'known_source_term_residual';
  if (normalize(gloss) === normalizedWord) return 'gloss_repeats_word';
  if (row?.source_lang === 'en' && /\b(one's|possessive|demonstrative)\b/u.test(gloss)) {
    return 'english_possessive_or_demonstrative';
  }
  if ((row?.source_lang === 'zh' || row?.source_lang === 'ja') && word.length === 1 && FUNCTION_GLOSSES.has(gloss)) {
    return 'single_cjk_function_word';
  }
  return '';
}

function isMostlyRomanizedCjkNameGloss(gloss) {
  const normalized = String(gloss || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (!normalized || /[;]/u.test(normalized)) return false;
  const tokens = normalized.split(/\s+/u).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 6) return false;
  const toneTokens = tokens.filter((token) => /^[a-züv]+[1-5]$/u.test(token));
  if (toneTokens.length !== tokens.length) return false;
  return tokens.some((token) => token === 'shi4' || token === 'xian4' || token === 'sheng3' || token === 'qu1');
}

function isKatakanaProperNameLike(word, gloss) {
  const source = String(word || '')
    .normalize('NFKC')
    .trim();
  const text = String(gloss || '')
    .normalize('NFKC')
    .trim();
  if (!/^[\p{Script=Katakana}ー・]+$/u.test(source)) return false;
  if (!text) return false;
  if (/\b(noun|verb|adjective|adverb|interjection|pronoun)\b/iu.test(text)) return false;
  if (/[\u3040-\u30ff\u3400-\u9fff]/u.test(text)) return false;
  const cleaned = text
    .replace(/\b(?:en|pt-BR|pt|zh|ja):\s*/giu, '')
    .replace(/[|,;]+/gu, ' ')
    .trim();
  const tokens = cleaned.split(/\s+/u).filter(Boolean);
  if (!tokens.length || tokens.length > 6) return false;
  return tokens.every((token) => /^\p{Lu}[\p{L}.'-]*$/u.test(token));
}

function qualityBucket(row) {
  const langs = Number(row?.first_sense_clean_localization_lang_count || row?.clean_localization_lang_count || 0);
  if (usesSupplementalEvidence(row)) return 'kaikki_raw_two_lang_evidence';
  if (langs >= 4) return 'four_lang_source_evidence';
  if (row?.source_lang === 'zh' || row?.source_lang === 'ja') return 'cjk_high_value';
  if (row?.source_lang === 'pt-BR') return 'pt_high_value';
  return 'en_high_value';
}

function usesSupplementalEvidence(row) {
  if (!supplementalTwoLangEvidenceIsUsable(row)) return false;
  return (
    Number(row?.clean_localization_lang_count || 0) < minLangs ||
    Number(row?.first_sense_clean_localization_lang_count || 0) < minFirstSenseLangs
  );
}

function qualityReasons(row) {
  const reasons = [];
  if (Number(row?.first_sense_clean_localization_lang_count || 0) >= 4)
    reasons.push('first_sense_has_four_clean_langs');
  if (Number(row?.clean_localization_lang_count || 0) >= 3) reasons.push('entry_has_three_or_more_clean_langs');
  if (supplementalTwoLangEvidenceIsUsable(row)) reasons.push('exact_kaikki_source_term_with_english_gloss');
  if (Number(row?.frequency_rank || Infinity) <= 5000) reasons.push('top_5000_frequency');
  if (row?.source_lang === 'zh' || row?.source_lang === 'ja') reasons.push('cjk_lookup_value');
  if (row?.source_lang === 'pt-BR') reasons.push('pt_lookup_value');
  return reasons;
}

function supplementalTwoLangEvidenceIsUsable(row) {
  if (!allowSupplementalTwoLangEvidence) return false;
  const sourceLang = String(row?.source_lang || '');
  const expectedSourceKey = sourceLang === 'ja' ? 'kaikki-ja' : sourceLang === 'pt-BR' ? 'kaikki-pt' : '';
  if (!expectedSourceKey || Number(row?.supplemental_evidence_lang_count || 0) < 2) return false;
  const normalized = normalize(row?.normalized_key || row?.word);
  const evidence = Array.isArray(row?.supplemental_evidence) ? row.supplemental_evidence : [];
  return evidence.some((item) => {
    const gloss = String(item?.gloss || '').normalize('NFKC').trim();
    return (
      item?.source_key === expectedSourceKey &&
      item?.source_lang === sourceLang &&
      normalize(item?.word) === normalized &&
      gloss.length >= 8 &&
      !/<[^>]+>|\uFFFD/u.test(gloss) &&
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(gloss)
    );
  });
}

function compactRejected(row, reasons) {
  return {
    source_entry_id: row?.source_entry_id,
    word: row?.word,
    source_lang: row?.source_lang,
    frequency_rank: row?.frequency_rank,
    gloss: row?.gloss_preview || row?.gloss_key || '',
    clean_localization_lang_count: row?.clean_localization_lang_count,
    first_sense_clean_localization_lang_count: row?.first_sense_clean_localization_lang_count,
    reasons
  };
}

function sourceScriptOk(word, lang) {
  const text = String(word || '').trim();
  if (!text) return false;
  if ((lang === 'en' || lang === 'pt-BR') && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))
    return false;
  if (containsKnownMojibakeChars(text)) return false;
  const hasLatin = /\p{Script=Latin}/u.test(text);
  const hasHan = /\p{Script=Han}/u.test(text);
  const hasHiragana = /\p{Script=Hiragana}/u.test(text);
  const hasKatakana = /\p{Script=Katakana}/u.test(text);
  const hasKana = hasHiragana || hasKatakana || /[\u30fc\uff70]/u.test(text);
  if (lang === 'zh') return hasHan && !hasKana;
  if (lang === 'ja') return hasHan || hasKana;
  if (lang === 'en' || lang === 'pt-BR') return !hasHan && !hasKana && hasLatin;
  return true;
}

function hasBadEncoding(value, lang) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/[\uFFFD]/u.test(text)) return true;
  if (containsKnownMojibakeChars(text)) return true;
  if (/[锟絔]/u.test(text)) return true;
  if (/(?:\u00c3[\u0080-\u00bf]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf]{1,2})/u.test(text)) return true;
  if (/[\u9287\u9288\u9289][\u3040-\u30ff\u4e00-\u9fff]?/u.test(text)) return true;
  if (/[閳ラ敓閾嗚寘鑴垮啋钃规担濡楃粭鐟璢]/u.test(text)) return true;
  if (/[\u9300-\u9fff][\u3040-\u30ff][\u9300-\u9fff]/u.test(text)) return true;
  if (lang === 'zh' && /[閵夐妵閵圿]/u.test(text)) return true;
  if (lang === 'ja' && /[閸旈崙閸熼崗閻╃拠鐠愭禍婢归弰閺夊璁砞]/u.test(text)) return true;
  return false;
}

function containsKnownMojibakeChars(text) {
  return /[谩茅煤莽铆贸茫锚锛锜鍕囨暍鐨澶ц儐鏈夎儐閲忕殑銇仾仆亞亜伆伨]/u.test(String(text || ''));
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function normalizeLatinLetters(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z]/gu, '');
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return counts;
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function addSourceEntryIds(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addSourceEntryIds(target, item);
    return;
  }
  if (typeof value !== 'object') {
    const id = Number(value);
    if (Number.isInteger(id)) target.add(id);
    return;
  }
  const directId = Number(value.source_entry_id);
  if (Number.isInteger(directId)) target.add(directId);
  if (value.items && typeof value.items === 'object') {
    for (const [key, item] of Object.entries(value.items)) {
      const itemId = Number(item?.source_entry_id ?? key);
      if (Number.isInteger(itemId)) target.add(itemId);
    }
  }
  for (const key of ['selected', 'generated', 'accepted', 'approved', 'rejected', 'reviews']) {
    if (Array.isArray(value[key])) addSourceEntryIds(target, value[key]);
  }
}

function addSourceSenseKeys(target, value) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) addSourceSenseKeys(target, item);
    return;
  }
  if (typeof value !== 'object') {
    if (/^\d+:\d+$/u.test(String(value))) target.add(String(value));
    return;
  }
  const key = sourceSenseKey(value);
  if (!key.includes('NaN')) target.add(key);
  for (const collectionKey of ['selected', 'generated', 'accepted', 'approved', 'rejected', 'reviews', 'residuals']) {
    if (Array.isArray(value[collectionKey])) addSourceSenseKeys(target, value[collectionKey]);
  }
}

function sourceSenseKey(row) {
  return `${Number(row?.source_entry_id)}:${Number(row?.source_sense_id ?? row?.first_sense_id)}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
