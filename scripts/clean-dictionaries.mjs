import fs from 'node:fs';
import path from 'node:path';

const RAW_DIR = path.resolve('data/raw');
const OUT_DIR = path.resolve('data/processed');
const CANDIDATES_FILE = path.join(OUT_DIR, 'candidate_terms.jsonl');
const REPORT_FILE = path.join(OUT_DIR, 'clean-report.json');

const MAX_PER_SOURCE = Number(process.env.MAX_PER_SOURCE || 25_000);
const LANGS = new Set(['zh', 'en', 'pt-BR', 'ja']);

fs.mkdirSync(OUT_DIR, { recursive: true });

const manifest = readJson(path.join(RAW_DIR, 'manifest.json'), { sources: [] });
const sourceMeta = new Map(manifest.sources.map((source) => [source.id, source]));
const candidates = [];
const seen = new Map();
const report = {
  generated_at: new Date().toISOString(),
  input_sources: manifest.sources.map(({ id, file, bytes, license }) => ({ id, file, bytes, license })),
  parsed: {},
  filters: {
    duplicates: 0,
    invalid: 0,
    mojibake: 0,
    too_long: 0,
    not_word_like: 0
  },
  output: {}
};

parseCedict();
parseJmdict();
parseFreeDict('freedict-eng-por', 'en', 'pt-BR');
parseFreeDict('freedict-por-eng', 'pt-BR', 'en');

candidates.sort((a, b) => {
  const byLang = a.source_lang.localeCompare(b.source_lang);
  if (byLang) return byLang;
  return a.normalized_headword.localeCompare(b.normalized_headword);
});

fs.writeFileSync(CANDIDATES_FILE, candidates.map((row) => JSON.stringify(row)).join('\n') + '\n');

report.output = {
  file: path.relative(process.cwd(), CANDIDATES_FILE),
  count: candidates.length,
  by_lang: countBy(candidates, 'source_lang'),
  by_source: countBy(candidates, 'source_id')
};

fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[done] candidates=${candidates.length}`);
console.log(`[done] wrote ${path.relative(process.cwd(), CANDIDATES_FILE)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), REPORT_FILE)}`);

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function readRaw(sourceId) {
  const meta = sourceMeta.get(sourceId);
  if (!meta) return '';
  const file = path.join(RAW_DIR, meta.file);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function parseCedict() {
  const sourceId = 'cc-cedict';
  const text = readRaw(sourceId);
  let parsed = 0;

  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)]\s+\/(.+)\/$/);
    if (!match) continue;

    const [, traditional, simplified, pinyin, defs] = match;
    const definitions = defs.split('/').map(cleanText).filter(Boolean).slice(0, 6);
    const headword = cleanText(simplified || traditional);
    const candidate = {
      headword,
      normalized_headword: normalize(headword, 'zh'),
      source_lang: 'zh',
      source_id: sourceId,
      source_license: licenseOf(sourceId),
      source_ref: { traditional, simplified, pinyin, definitions },
      hints: {
        zh: { word: headword, phonetic: pinyin },
        en: { definition: definitions.join('; ') }
      }
    };

    if (addCandidate(candidate)) parsed += 1;
    if (parsed >= MAX_PER_SOURCE) break;
  }

  report.parsed[sourceId] = parsed;
}

function parseJmdict() {
  const sourceId = 'jmdict';
  const xml = readRaw(sourceId);
  let parsed = 0;
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];

  for (const entry of entries) {
    const keb = first(entry, /<keb>([\s\S]*?)<\/keb>/);
    const reb = first(entry, /<reb>([\s\S]*?)<\/reb>/);
    const headword = cleanText(keb || reb);
    if (!headword) continue;

    const glosses = [...entry.matchAll(/<gloss(?:\s+[^>]*)?>([\s\S]*?)<\/gloss>/g)]
      .map((match) => cleanText(decodeXml(match[1])))
      .filter(Boolean)
      .slice(0, 8);
    const pos = [...entry.matchAll(/<pos>&([^;]+);<\/pos>/g)].map((match) => match[1]).slice(0, 5);

    const candidate = {
      headword,
      normalized_headword: normalize(headword, 'ja'),
      source_lang: 'ja',
      source_id: sourceId,
      source_license: licenseOf(sourceId),
      source_ref: { kanji: keb, reading: reb, glosses, pos },
      hints: {
        ja: { word: headword, phonetic: reb || headword },
        en: { definition: glosses.join('; ') }
      }
    };

    if (addCandidate(candidate)) parsed += 1;
    if (parsed >= MAX_PER_SOURCE) break;
  }

  report.parsed[sourceId] = parsed;
}

function parseFreeDict(sourceId, sourceLang, targetLang) {
  const tei = readRaw(sourceId);
  let parsed = 0;
  const entries = tei.match(/<entry[\s\S]*?<\/entry>/g) || [];

  for (const entry of entries) {
    const orth = first(entry, /<orth[^>]*>([\s\S]*?)<\/orth>/);
    const headword = cleanText(decodeXml(stripTags(orth || '')));
    if (!headword) continue;

    const translations = [...entry.matchAll(/<cit[^>]*type=["']trans["'][\s\S]*?<\/cit>/g)]
      .flatMap((match) => [...match[0].matchAll(/<quote[^>]*>([\s\S]*?)<\/quote>/g)])
      .map((match) => cleanText(decodeXml(stripTags(match[1]))))
      .filter(Boolean)
      .slice(0, 8);

    if (!translations.length) continue;

    const candidate = {
      headword,
      normalized_headword: normalize(headword, sourceLang),
      source_lang: sourceLang,
      source_id: sourceId,
      source_license: licenseOf(sourceId),
      source_ref: { translations },
      hints: {
        [sourceLang]: { word: headword },
        [targetLang]: { word: translations[0], alternatives: translations.slice(1) }
      }
    };

    if (addCandidate(candidate)) parsed += 1;
    if (parsed >= MAX_PER_SOURCE) break;
  }

  report.parsed[sourceId] = parsed;
}

function addCandidate(candidate) {
  const errors = validateCandidate(candidate);
  if (errors.length) {
    for (const error of errors) report.filters[error] = (report.filters[error] || 0) + 1;
    return false;
  }

  const key = `${candidate.source_lang}:${candidate.normalized_headword}`;
  if (seen.has(key)) {
    mergeCandidate(seen.get(key), candidate);
    report.filters.duplicates += 1;
    return false;
  }
  const row = {
    ...candidate,
    status: 'candidate',
    created_at: new Date().toISOString()
  };
  seen.set(key, row);
  candidates.push(row);
  return true;
}

function mergeCandidate(existing, incoming) {
  existing.source_ref = mergeSourceRef(existing.source_ref, incoming.source_ref);
  existing.hints = mergeHints(existing.hints, incoming.hints);
}

function mergeSourceRef(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      merged[key] = unique([...(Array.isArray(merged[key]) ? merged[key] : []), ...value]);
    } else if (typeof value === 'object') {
      merged[key] = mergeSourceRef(merged[key], value);
    } else if (merged[key] && merged[key] !== value) {
      merged[`${key}_variants`] = unique([
        ...(Array.isArray(merged[`${key}_variants`]) ? merged[`${key}_variants`] : [merged[key]]),
        value
      ]);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function mergeHints(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [lang, hint] of Object.entries(incoming)) {
    merged[lang] = mergeSourceRef(merged[lang], hint);
  }
  return merged;
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ''))];
}

function validateCandidate(candidate) {
  const errors = [];
  if (!LANGS.has(candidate.source_lang) || !candidate.headword || !candidate.normalized_headword) {
    errors.push('invalid');
  }
  if (isTooLong(candidate.headword, candidate.source_lang)) {
    errors.push('too_long');
  }
  if (looksMojibake(candidate.headword)) {
    errors.push('mojibake');
  }
  if (!isWordLike(candidate.headword, candidate.source_lang)) {
    errors.push('not_word_like');
  }
  return errors;
}

function normalize(text, lang) {
  const cleaned = cleanText(text).normalize('NFKC');
  if (lang === 'en' || lang === 'pt-BR') return cleaned.toLocaleLowerCase();
  return cleaned;
}

function cleanText(value) {
  return decodeXml(stripTags(String(value || '')))
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, '');
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function first(text, regex) {
  const match = text.match(regex);
  return match ? match[1] : '';
}

function licenseOf(sourceId) {
  return sourceMeta.get(sourceId)?.license || 'unknown';
}

function isTooLong(text, lang) {
  if (lang === 'zh' || lang === 'ja') return [...text].length > 12;
  return text.split(/\s+/).length > 4 || text.length > 48;
}

function looksMojibake(text) {
  const value = String(text || '');
  if (!value) return false;
  if (/[\uFFFD]/u.test(value)) return true;
  if (/[ÃÂ][\u0080-\u00ff]?|â[€™€œ€]|å[^\s]?|ã[^\s]?/u.test(value)) return true;
  return /锟|鎴|浣|銇|莽|谩|铆|贸|煤|脿|芒|茫|聽/u.test(value);
}

function isWordLike(text, lang) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (/^[々〻〡〢〣ゝゞヽヾ〃]+$/u.test(value)) return false;
  if (/^[-‐‑‒–—]|[-‐‑‒–—]$/.test(value)) return false;
  if (/^[\p{P}\p{S}\d\s]+$/u.test(value)) return false;

  if (lang === 'zh') {
    return /[\u3400-\u9fff]/u.test(value);
  }
  if (lang === 'ja') {
    return /[\u3400-\u9fff\u3041-\u3096\u30a1-\u30fa]/u.test(value);
  }
  if (lang === 'en') {
    return /^[a-z]+(?:[ '-][a-z]+){0,3}$/i.test(value);
  }
  if (lang === 'pt-BR') {
    return /^[\p{Script=Latin}]+(?:[ '-][\p{Script=Latin}]+){0,3}$/u.test(value);
  }
  return true;
}

function countBy(rows, field) {
  return rows.reduce((acc, row) => {
    acc[row[field]] = (acc[row[field]] || 0) + 1;
    return acc;
  }, {});
}
