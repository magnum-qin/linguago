#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['zh', 'ja', 'pt-BR', 'en'];
const DEFAULT_QUOTAS = { zh: 150, ja: 150, 'pt-BR': 125, en: 75 };
const FREQUENCY_FILES = {
  zh: ['frequencywords-zh_50k.txt', 'wordfreq-zh-200000.txt'],
  ja: ['frequencywords-ja_50k.txt', 'wordfreq-ja-200000.txt'],
  'pt-BR': ['frequencywords-pt_br_50k.txt', 'wordfreq-pt-200000.txt'],
  en: ['frequencywords-en_50k.txt', 'wordfreq-en-200000.txt']
};

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.in, 'in');
const outputPath = path.resolve(args.out || 'logs/product-daily-high-value-coverage-gaps.json');
const frequencyDir = path.resolve(args['frequency-dir'] || 'data/raw/frequency');
const limit = positiveInteger(args.limit || 500, 'limit');
const quotas = parseQuotas(args.quotas, limit);
const maxConsensusRank = positiveInteger(args['max-consensus-rank'] || 30_000, 'max-consensus-rank');
const minFirstSenseLangs = nonNegativeInteger(args['min-first-sense-langs'] ?? 3, 'min-first-sense-langs');
const minCjkLength = positiveInteger(args['min-cjk-length'] || 1, 'min-cjk-length');

const input = readJson(inputPath);
const rows = Array.isArray(input.selected) ? input.selected : [];
const frequencyRanks = loadFrequencyRanks(frequencyDir);
const eligible = [];
const rejected = [];

for (const row of rows) {
  const result = rankCandidate(row, frequencyRanks, maxConsensusRank, minFirstSenseLangs, minCjkLength);
  if (result.reasons.length) {
    rejected.push({
      source_entry_id: row.source_entry_id,
      source_sense_id: row.first_sense_id,
      source_lang: row.source_lang,
      word: row.word,
      frequency_rank: row.frequency_rank,
      reasons: result.reasons
    });
    continue;
  }
  eligible.push({
    ...row,
    daily_priority: result.priority,
    daily_tier: result.tier,
    frequency_consensus: result.frequency,
    daily_priority_reasons: result.priorityReasons,
    publication_eligible: false,
    required_next_gate: 'independent_source_family_review'
  });
}

eligible.sort(compareCandidates);
const selected = selectBalanced(eligible, quotas, limit);
const output = {
  ok: selected.length === limit,
  generated_at: new Date().toISOString(),
  source_report: relative(inputPath),
  policy: {
    purpose: 'daily_high_value_candidate_ranking',
    frequency_sources_required: 2,
    frequency_files: FREQUENCY_FILES,
    max_consensus_rank: maxConsensusRank,
    min_first_sense_localization_langs: minFirstSenseLangs,
    min_cjk_length: minCjkLength,
    quotas,
    independent_dictionary_evidence_required_after_ranking: true,
    automatic_publication: false
  },
  summary: {
    input: rows.length,
    eligible: eligible.length,
    eligible_by_lang: countBy(eligible, (row) => row.source_lang),
    rejected: rejected.length,
    selected: selected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    selected_by_tier: countBy(selected, (row) => row.daily_tier),
    rejected_by_reason: countReasons(rejected)
  },
  selected_count: selected.length,
  selected,
  rejected_preview: rejected.slice(0, 100)
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: relative(outputPath), summary: output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function rankCandidate(row, rankMaps, rankLimit, localizationMinimum, cjkLengthMinimum) {
  const reasons = [];
  const priorityReasons = [];
  const lang = String(row.source_lang || '');
  const word = String(row.word || '').normalize('NFKC').trim();
  const gloss = String(row.gloss_key || row.gloss_preview || '').normalize('NFKC').trim();
  if (!LANGS.includes(lang)) reasons.push('invalid_source_lang');
  if (!word) reasons.push('empty_word');
  if (!dailyShape(word, lang)) reasons.push('non_daily_shape');
  if ((lang === 'zh' || lang === 'ja') && [...word].length < cjkLengthMinimum) reasons.push('short_cjk_deferred');
  if (isAbbreviation(word, lang)) reasons.push('abbreviation');
  if (isProperOrSpecialized(gloss)) reasons.push('proper_or_specialized_gloss');
  if (Number(row.first_sense_clean_localization_lang_count || 0) < localizationMinimum)
    reasons.push('insufficient_first_sense_localizations');

  const key = normalize(word);
  const [primary, secondary] = rankMaps[lang]?.map((map) => map.get(key) ?? null) || [null, null];
  if (primary === null) reasons.push('missing_frequencywords_rank');
  if (secondary === null) reasons.push('missing_wordfreq_rank');
  const consensusRank = primary === null || secondary === null ? null : Math.max(primary, secondary);
  if (consensusRank !== null && consensusRank > rankLimit) reasons.push('outside_daily_frequency_limit');

  let priority = 0;
  if (consensusRank !== null) {
    priority += Math.max(0, rankLimit + 1 - consensusRank) * 10;
    priority += Math.max(0, rankLimit + 1 - Math.round(Math.sqrt(primary * secondary))) * 4;
    priorityReasons.push('two_frequency_sources');
  }
  const localizationCount = Number(row.first_sense_clean_localization_lang_count || 0);
  priority += localizationCount * 2_000;
  if (localizationCount >= 4) priorityReasons.push('four_localized_source_sense');
  if (hasDailyGlossSignal(gloss)) {
    priority += 2_500;
    priorityReasons.push('daily_gloss_signal');
  }
  if ((lang === 'zh' || lang === 'ja') && [...word].length >= 2) {
    priority += 1_000;
    priorityReasons.push('multi_character_cjk');
  }

  return {
    reasons: [...new Set(reasons)],
    priority,
    tier: consensusRank !== null && consensusRank <= 5_000 ? 'core' : consensusRank <= 15_000 ? 'common' : 'extended',
    frequency: { frequencywords_rank: primary, wordfreq_rank: secondary, consensus_rank: consensusRank },
    priorityReasons
  };
}

function dailyShape(word, lang) {
  if (/\d|[０-９]|[_/@#%&*=+()[\]{}<>]/u.test(word)) return false;
  if (lang === 'zh') return /^[\p{Script=Han}]{1,6}$/u.test(word);
  if (lang === 'ja')
    return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,10}$/u.test(word);
  if (lang === 'en') return /^[\p{Script=Latin}][\p{Script=Latin}'-]{1,20}$/u.test(word);
  if (lang === 'pt-BR') return /^[\p{Script=Latin}][\p{Script=Latin}'-]{1,22}$/u.test(word);
  return false;
}

function isAbbreviation(word, lang) {
  if (lang === 'zh' || lang === 'ja') return false;
  return [...word].length <= 2 || /^[A-Z.]{2,}$/u.test(word);
}

function isProperOrSpecialized(gloss) {
  return /\b(?:surname|given name|family name|place name|province|county|municipality|capital of|chemical element|enzyme|protein|genus|species|taxonomy|pathology|surgery|anatomy|botany|zoology|geology|mineralogy|legal|archaic|obsolete)\b/iu.test(
    gloss
  );
}

function hasDailyGlossSignal(gloss) {
  return /\b(?:go|come|eat|drink|buy|sell|pay|work|study|school|home|family|friend|food|water|time|day|night|today|tomorrow|yesterday|morning|evening|train|bus|car|road|street|hotel|room|shop|store|restaurant|hospital|doctor|body|weather|rain|hot|cold|good|bad|big|small|want|need|like|love|know|think|say|speak|see|look|hear|give|take|make|use|open|close|start|stop|help|please|thanks|sorry|hello|yes|no|where|when|what|why|how)\b/iu.test(
    gloss
  );
}

function loadFrequencyRanks(directory) {
  return Object.fromEntries(
    Object.entries(FREQUENCY_FILES).map(([lang, files]) => [
      lang,
      files.map((file) => readFrequencyFile(path.join(directory, file), lang))
    ])
  );
}

function readFrequencyFile(filePath, lang) {
  if (!fs.existsSync(filePath)) throw new Error(`Frequency file not found: ${filePath}`);
  const result = new Map();
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const term = line.trim().split(/\s+/u)[0];
    if (!term || isHeader(term, lang)) continue;
    const key = normalize(term);
    if (!result.has(key)) result.set(key, result.size + 1);
  }
  return result;
}

function isHeader(term, lang) {
  const value = term.toLocaleLowerCase();
  return value === lang.toLocaleLowerCase() || (lang === 'zh' && value === 'zh-cn') || (lang === 'pt-BR' && value === 'pt');
}

function selectBalanced(rows, targets, maxItems) {
  const selected = [];
  const usedEntries = new Set();
  for (const lang of LANGS) {
    const target = targets[lang] || 0;
    if (target === 0 || selected.length >= maxItems) continue;
    let count = 0;
    for (const row of rows) {
      if (row.source_lang !== lang || usedEntries.has(row.source_entry_id)) continue;
      selected.push(row);
      usedEntries.add(row.source_entry_id);
      count += 1;
      if (count >= target || selected.length >= maxItems) break;
    }
  }
  if (selected.length < maxItems) {
    for (const row of rows) {
      if (usedEntries.has(row.source_entry_id)) continue;
      selected.push(row);
      usedEntries.add(row.source_entry_id);
      if (selected.length >= maxItems) break;
    }
  }
  return selected.sort(compareCandidates);
}

function compareCandidates(left, right) {
  return right.daily_priority - left.daily_priority ||
    left.frequency_consensus.consensus_rank - right.frequency_consensus.consensus_rank ||
    String(left.word).localeCompare(String(right.word));
}

function parseQuotas(value, total) {
  if (!value) return { ...DEFAULT_QUOTAS };
  const result = Object.fromEntries(LANGS.map((lang) => [lang, 0]));
  for (const item of String(value).split(',')) {
    const [lang, rawCount] = item.split('=');
    if (!LANGS.includes(lang)) throw new Error(`Unknown quota language: ${lang}`);
    result[lang] = nonNegativeInteger(rawCount, `quota ${lang}`);
  }
  if (Object.values(result).reduce((sum, count) => sum + count, 0) !== total)
    throw new Error(`Quotas must sum to --limit (${total})`);
  return result;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`Invalid --${name}: ${value}`);
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`Invalid --${name}: ${value}`);
  return number;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) for (const reason of row.reasons) counts[reason] = (counts[reason] || 0) + 1;
  return counts;
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
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

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}
