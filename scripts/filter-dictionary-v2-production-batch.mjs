#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const outPath = path.resolve(args.out || 'logs/product-production-batch-filtered.json');
const rejectedOutPath = path.resolve(
  args['rejected-out'] || outPath.replace(/\.json$/u, '-rejected.json')
);
const enabled = args.enabled !== 'false';
const excludeAllCapitalizedLatin = args['exclude-all-capitalized-latin'] === 'true';
const requireAuthoritativeSourceSense = args['require-authoritative-source-sense'] === 'true';
const allowEnglishOmwSource = args['allow-english-omw-source'] === 'true';
const allowPtBrOmwSource = args['allow-pt-br-omw-source'] === 'true';
const allowPtBrWikdictSource = args['allow-pt-br-wikdict-source'] === 'true';
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = reportRows(report);
if (!rows) throw new Error('Production batch requires a selected or candidates array');

const selected = [];
const rejected = [];
for (const row of rows) {
  const reason = enabled ? rejectionReason(row) : null;
  if (reason) {
    rejected.push({
      ...row,
      production_prefilter: {
        decision: 'exclude_from_general_production',
        reason,
        automatic_database_write: false
      }
    });
  } else {
    selected.push(row);
  }
}

const summary = {
  input: rows.length,
  selected: selected.length,
  rejected: rejected.length,
  rejected_by_reason: countBy(rejected, (row) => row.production_prefilter.reason)
};
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  production_prefilter: {
    enabled,
    profile: 'daily-general-conservative-v1',
    policy: {
      exclude_explicit_proper_names: true,
      exclude_capitalized_latin_name_like_rows: true,
      exclude_all_capitalized_latin_rows: excludeAllCapitalizedLatin,
      exclude_english_inflected_forms_from_general_lane: true,
      exclude_multi_sense_gloss_dumps: true,
      exclude_obvious_source_language_mismatch: true,
      require_authoritative_selected_source_sense: requireAuthoritativeSourceSense,
      allow_english_omw_source: allowEnglishOmwSource,
      allow_pt_br_omw_source: allowPtBrOmwSource,
      allow_pt_br_wikdict_source: allowPtBrWikdictSource,
      automatic_database_write: false
    },
    summary,
    rejected_report: relative(rejectedOutPath)
  },
  summary: { ...(report.summary || {}), production_prefilter: summary },
  selected_count: selected.length,
  selected
};
const rejectedOutput = {
  ok: true,
  generated_at: output.generated_at,
  source_report: relative(reportPath),
  profile: output.production_prefilter.profile,
  summary,
  selected_count: rejected.length,
  selected: rejected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(rejectedOutPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
fs.writeFileSync(rejectedOutPath, `${JSON.stringify(rejectedOutput, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), rejected_out: relative(rejectedOutPath), summary }, null, 2));

function rejectionReason(row) {
  const word = String(row?.word || row?.headword || '').trim();
  const lang = String(row?.source_lang || '').trim();
  const partOfSpeech = String(row?.part_of_speech || '').trim();
  const gloss = String(row?.gloss_key || row?.gloss_preview || row?.definition || row?.gloss || '').trim();
  if (!word || !['zh', 'ja', 'en', 'pt-BR'].includes(lang)) return 'missing_or_unsupported_source';
  if (requireAuthoritativeSourceSense && !hasAuthoritativeSelectedSense(row, lang)) {
    return 'untrusted_selected_source_sense';
  }
  if (looksLowValueLatinToken(word, lang)) return 'low_value_letter_abbreviation_or_ordinal';
  if (looksCompositionalNumber(word, lang)) return 'compositional_number';
  if (looksExplicitlyProper(partOfSpeech, gloss)) return 'explicit_proper_name';
  if (looksNamedEntityGloss(word, lang, gloss)) return 'named_entity_or_dictionary_redirect';
  if (excludeAllCapitalizedLatin && looksCapitalizedLatin(word, lang)) {
    return 'capitalized_latin_headword';
  }
  if (looksCapitalizedNameLike(word, lang, gloss)) return 'capitalized_name_like';
  if (lang === 'en' && looksEnglishInflected(word, gloss)) return 'english_inflected_form';
  if (looksMultiSenseDump(gloss)) return 'multi_sense_gloss_dump';
  if (looksSourceLanguageMismatch(word, lang, gloss)) return 'source_language_mismatch';
  return null;
}

function hasAuthoritativeSelectedSense(row, lang) {
  const selectedSenseId = Number(row?.first_sense_id ?? row?.source_sense_id);
  const selected = Array.isArray(row?.daily_sense_selection?.alternatives)
    ? row.daily_sense_selection.alternatives.find((item) => Number(item?.id) === selectedSenseId)
    : null;
  const source = String(selected?.source || '').toLocaleLowerCase();
  if (lang === 'zh') return source.includes('cc-cedict');
  if (lang === 'ja') return source.includes('jmdict');
  if (lang === 'pt-BR') {
    return (
      source.includes('freedict') ||
      source.includes('dicionario') ||
      (allowPtBrOmwSource && source.includes('omw')) ||
      (allowPtBrWikdictSource && source.includes('wikdict-pt'))
    );
  }
  if (lang === 'en') {
    return (
      source.includes('freedict-eng-por') ||
      source.includes('ecdict') ||
      source.includes('wordnet') ||
      (allowEnglishOmwSource && source.includes('omw'))
    );
  }
  return false;
}

function looksLowValueLatinToken(word, lang) {
  if (!['en', 'pt-BR'].includes(lang)) return false;
  if (/^\p{L}$/u.test(word)) return true;
  if (/^\d+(?:st|nd|rd|th)$/iu.test(word)) return true;
  if (/^(?=[ivxlcdm]+$)(?:m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))$/iu.test(word)) {
    return true;
  }
  // Keep ordinary lexical words such as am/as; only all-uppercase forms are
  // treated as abbreviations in the general production lane.
  return /^[A-Z][A-Z0-9.-]{1,5}$/u.test(word);
}

function looksCapitalizedLatin(word, lang) {
  return ['en', 'pt-BR'].includes(lang) && /^\p{Lu}[\p{L}\p{M}'’-]{2,}$/u.test(word);
}

function looksCompositionalNumber(word, lang) {
  if (!['zh', 'ja'].includes(lang)) return false;
  // Single digits remain useful dictionary headwords. Multi-character cardinal
  // numbers are productive expressions and should be rendered compositionally
  // instead of consuming one product entry and a remote generation request.
  return word.length > 1 && /^[零〇一二三四五六七八九十百千万億亿兆兩两]+$/u.test(word);
}

function looksExplicitlyProper(partOfSpeech, gloss) {
  return /(?:^|[;&\s-])(?:proper|proper noun|name|n-pr)(?:$|[;&\s-])/iu.test(partOfSpeech) ||
    /\b(?:given name|family name|surname|personal name|place name|city in|province of|saint peter)\b/iu.test(gloss);
}

function looksNamedEntityGloss(word, lang, gloss) {
  if (!['zh', 'ja'].includes(lang) || !gloss) return false;

  // Native dictionaries frequently expose redirects instead of a lexical
  // definition. They are useful for query aliases, but are not standalone
  // senses for the automatic four-language generation lane.
  if (/^(?:see|variant of|abbr\.?(?:eviation)? (?:for|of))\s+.+\[[A-Za-züÜ:0-9\s'-]+\]$/iu.test(gloss)) {
    return true;
  }

  // Require an explicit entity descriptor. This avoids excluding ordinary
  // words merely because their English gloss starts with a capital letter.
  if (/\b(?:city|prefecture|province|county|municipality|township|village|district|borough|capital)\b/iu.test(gloss) &&
      /(?:\([^)]*\b(?:city|prefecture|province|county|municipality|township|village|district|borough|capital)\b|\b(?:city|prefecture|province|county|municipality|township|village|district|borough|capital)\s+(?:in|of)\b)/iu.test(gloss)) {
    return true;
  }

  if (/\b(?:news agency|political party|communist party|university|college|corporation|company|organization|railway station|airport)\b/iu.test(gloss) &&
      /\p{Lu}[\p{L}\p{M}'’.&-]*(?:\s+\p{Lu}[\p{L}\p{M}'’.&-]*)+/u.test(gloss)) {
    return true;
  }

  if (/\b(?:people'?s republic|republic of|self-defense forces|democratic party|central television|consultative conference)\b/iu.test(gloss)) {
    return true;
  }

  if (/\b(?:dynasty of|dynasty \(of|emperor of)\b/iu.test(gloss) ||
      /\b\p{Lu}[\p{L}\p{M}'’.-]+(?:\s+\p{Lu}[\p{L}\p{M}'’.-]+)+\s*\(\d{3,4}[–-]\d{2,4}\)/u.test(gloss)) {
    return true;
  }

  if (/\([^)]*\b(?:main islands?|region)\s+of\s+(?:Japan|China|Korea)\b/iu.test(gloss)) {
    return true;
  }

  const compact = gloss
    .replace(/^the\s+/iu, '')
    .replace(/\s+\([A-Z][A-Za-z.-]{1,8}\)$/u, '')
    .trim();
  const titleTokens = compact.split(/\s+/u);
  if (
    titleTokens.length <= 6 &&
    titleTokens.every((token) =>
      /^(?:of|the|and|[IVXLCDM]+|(?:\p{Lu}|\p{Lt})[\p{L}\p{M}\d'’.:-]*)$/u.test(token)
    ) &&
    titleTokens.some((token) => /^(?:\p{Lu}|\p{Lt})[\p{L}\p{M}'’.-]*$/u.test(token))
  ) {
    return true;
  }

  return false;
}

function looksCapitalizedNameLike(word, lang, gloss) {
  if (!['en', 'pt-BR'].includes(lang) || !/^\p{Lu}[\p{Ll}\p{M}'’-]{2,}$/u.test(word)) return false;
  if (/\b(?:given name|family name|surname|personal name|prince|saint|city|province|region)\b/iu.test(gloss)) {
    return true;
  }
  const compactGloss = gloss.replace(/^(?:en|zh|ja|pt(?:-BR)?)\s*:\s*/iu, '').trim();
  return compactGloss.length <= 48 &&
    /^(?:\p{Lu}[\p{L}\p{M}'’.-]*)(?:[;|]\s*\p{Lu}[\p{L}\p{M}'’.-]*)*$/u.test(compactGloss);
}

function looksEnglishInflected(word, gloss) {
  const lower = word.toLocaleLowerCase();
  const commonLexemes = new Set([
    'business', 'class', 'dress', 'glass', 'grass', 'news', 'process', 'success',
    'address', 'access', 'analysis', 'basis', 'crisis', 'series', 'species', 'status'
  ]);
  if (commonLexemes.has(lower)) return false;
  const looksInflected = /(?:ing|ed|ies|sses|ches|shes|xes|zes)$/u.test(lower) ||
    (/s$/u.test(lower) && lower.length >= 5 && !/(?:ss|us|is)$/u.test(lower));
  if (!looksInflected) return false;
  // The general dictionary lane should publish the lemma and derive ordinary
  // English forms separately. Source-gap rows often carry a short translated
  // gloss that does not explicitly say "past participle", so requiring that
  // wording lets large groups of -ed/-ing forms consume LLM capacity.
  if (/(?:ing|ed)$/u.test(lower)) return true;
  return /(?:^|\n)[nv]\s+/u.test(gloss) || /\b(?:plural|past tense|participle|gerund|form of)\b/iu.test(gloss) || gloss.length > 100;
}

function looksMultiSenseDump(gloss) {
  if (!gloss) return false;
  const taggedLines = gloss.split(/\\n|\n/u).filter((line) => /^[nvar]\s+/iu.test(line.trim())).length;
  const languageSections = (gloss.match(/(?:^|\|)\s*(?:en|zh|ja|pt(?:-BR)?)\s*:/giu) || []).length;
  return taggedLines >= 4 || (gloss.length > 360 && languageSections < 2);
}

function looksSourceLanguageMismatch(word, lang, gloss) {
  if (lang === 'zh') return !/\p{Script=Han}/u.test(word);
  if (lang === 'ja') return !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(word);
  return false;
}

function reportRows(value) {
  if (Array.isArray(value?.selected)) return value.selected;
  if (Array.isArray(value?.candidates)) return value.candidates;
  return null;
}

function countBy(items, getter) {
  return items.reduce((counts, item) => {
    const key = getter(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function relative(filePath) { return path.relative(process.cwd(), filePath); }

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return parsed;
}
