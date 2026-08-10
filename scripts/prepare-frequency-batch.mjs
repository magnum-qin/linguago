import fs from 'node:fs';
import path from 'node:path';

const CANDIDATES_FILE = path.resolve('data/processed/candidate_terms.jsonl');
const FREQ_DIR = path.resolve('data/raw/frequency');
const OUT_DIR = path.resolve('data/processed');
const CANDIDATES_OUT = path.join(OUT_DIR, 'frequency_candidates.jsonl');
const BATCH_OUT = path.join(OUT_DIR, 'generation_batch_frequency_400.txt');
const BATCH_JSONL_OUT = path.join(OUT_DIR, 'generation_batch_frequency_400.jsonl');
const REPORT_OUT = path.join(OUT_DIR, 'frequency-batch-report.json');
const BATCH_PER_LANG = Number(process.env.BATCH_PER_LANG || 100);

const frequencyFiles = {
  en: 'frequencywords-en_50k.txt',
  zh: 'frequencywords-zh_50k.txt',
  ja: 'frequencywords-ja_50k.txt',
  'pt-BR': 'frequencywords-pt_br_50k.txt'
};

const candidates = fs
  .readFileSync(CANDIDATES_FILE, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const byLangAndTerm = new Map();
for (const row of candidates) {
  const key = makeKey(row.source_lang, row.normalized_headword || row.headword);
  if (!byLangAndTerm.has(key)) byLangAndTerm.set(key, row);
}

const frequencyCandidates = [];
const selected = [];
const selectedKeys = new Set();
const report = {
  generated_at: new Date().toISOString(),
  candidate_file: path.relative(process.cwd(), CANDIDATES_FILE),
  frequency_dir: path.relative(process.cwd(), FREQ_DIR),
  frequency_candidates_file: path.relative(process.cwd(), CANDIDATES_OUT),
  batch_file: path.relative(process.cwd(), BATCH_OUT),
  batch_jsonl_file: path.relative(process.cwd(), BATCH_JSONL_OUT),
  batch_per_lang_target: BATCH_PER_LANG,
  by_lang: {}
};

for (const [lang, file] of Object.entries(frequencyFiles)) {
  const freqPath = path.join(FREQ_DIR, file);
  const terms = readFrequencyTerms(freqPath, lang);
  const langRows = [];
  const seen = new Set();
  let filteredByShape = 0;
  let missingFromDictionary = 0;

  for (const { term, rank } of terms) {
    if (!isGoodFirstPassTerm(term, lang)) {
      filteredByShape += 1;
      continue;
    }

    const key = makeKey(lang, term);
    if (seen.has(key)) continue;
    seen.add(key);

    const candidate = byLangAndTerm.get(key);
    if (!candidate) {
      missingFromDictionary += 1;
      continue;
    }
    if (!isGoodDictionaryMatch(term, candidate, lang)) {
      missingFromDictionary += 1;
      continue;
    }

    const row = {
      ...candidate,
      // Prefer the frequency-list surface form for generation. Some dictionaries
      // store entries such as "IT", but the daily word we want is "it".
      headword: displayTerm(term, lang),
      normalized_headword: normalize(term),
      frequency_rank: rank,
      frequency_source: file,
      batch_priority: langRows.length + 1
    };
    langRows.push(row);
    frequencyCandidates.push(row);
  }

  const fallbackRows = candidates
    .filter((candidate) => candidate.source_lang === lang)
    .sort((a, b) => String(a.normalized_headword).localeCompare(String(b.normalized_headword)));
  const langSelected = takeBatchRows([...langRows, ...fallbackRows], lang, BATCH_PER_LANG);
  selected.push(...langSelected);

  report.by_lang[lang] = {
    frequency_terms: terms.length,
    matched_candidates: langRows.length,
    selected: langSelected.length,
    filled_from_fallback: Math.max(0, langSelected.length - Math.min(langRows.length, BATCH_PER_LANG)),
    filtered_by_shape: filteredByShape,
    missing_from_dictionary: missingFromDictionary,
    top_20: langRows.slice(0, 20).map((row) => ({
      rank: row.frequency_rank,
      headword: row.headword,
      source_id: row.source_id
    }))
  };
}

fs.writeFileSync(CANDIDATES_OUT, frequencyCandidates.map((row) => JSON.stringify(row)).join('\n') + '\n');
fs.writeFileSync(BATCH_OUT, selected.map((row) => row.headword).join('\n') + '\n');
fs.writeFileSync(BATCH_JSONL_OUT, selected.map((row) => JSON.stringify(row)).join('\n') + '\n');

report.total = {
  frequency_candidates: frequencyCandidates.length,
  selected: selected.length,
  selected_by_lang: countBy(selected, 'source_lang')
};

fs.writeFileSync(REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`);

console.log(`[done] frequency candidates=${frequencyCandidates.length}`);
console.log(`[done] selected batch=${selected.length}`);
console.log(`[done] wrote ${path.relative(process.cwd(), BATCH_OUT)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), BATCH_JSONL_OUT)}`);
console.log(`[done] wrote ${path.relative(process.cwd(), REPORT_OUT)}`);

function readFrequencyTerms(file, lang) {
  const lines = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const out = [];
  for (const [index, line] of lines.entries()) {
    if (index === 0 && line.toLowerCase() === lang.toLowerCase()) continue;
    if (index === 0 && lang === 'zh' && line.toLowerCase() === 'zh-cn') continue;
    if (index === 0 && lang === 'pt-BR' && line.toLowerCase() === 'pt') continue;
    if (index === 0 && lang === 'ja' && line.toLowerCase() === 'ja') continue;

    const term = line.split(/\s+/)[0]?.trim();
    if (!term) continue;
    out.push({ term, rank: index });
  }
  return out;
}

function makeKey(lang, term) {
  return `${lang}:${normalize(term)}`;
}

function normalize(term) {
  return term.normalize('NFKC').trim().toLocaleLowerCase();
}

function displayTerm(term, lang) {
  const normalized = term.normalize('NFKC').trim();
  if (lang === 'en' || lang === 'pt-BR') return normalized.toLocaleLowerCase();
  return normalized;
}

function isGoodFirstPassTerm(term, lang) {
  const text = term.trim();
  if (!text) return false;
  if (/[0-9_/@#%&*=+()[\]{}<>]/.test(text)) return false;
  if (text.length > 24) return false;

  if (lang === 'zh') {
    return /^[\u3400-\u9fff]{1,6}$/u.test(text);
  }
  if (lang === 'ja') {
    return /[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]/u.test(text) && !/^[a-z]+$/i.test(text);
  }
  if (lang === 'en') {
    if (isContractionFragment(text)) return false;
    return /^[a-z][a-z'-]{1,18}$/i.test(text);
  }
  if (lang === 'pt-BR') {
    if (isContractionFragment(text)) return false;
    return /^[\p{Script=Latin}][\p{Script=Latin}'-]{1,18}$/u.test(text);
  }
  return true;
}

function isContractionFragment(text) {
  return /^(don|doesn|didn|isn|aren|wasn|weren|can|couldn|wouldn|shouldn|won|haven|hasn|hadn|ain|let)$/i.test(text);
}

function isGoodDictionaryMatch(term, candidate, lang) {
  const sourceHeadword = String(candidate.headword || '');
  if ((lang === 'en' || lang === 'pt-BR') && /^[a-z]/.test(term) && /^[A-Z]{2,}$/.test(sourceHeadword)) {
    return false;
  }
  return true;
}

function takeBatchRows(rows, lang, target) {
  const out = [];
  for (const row of rows) {
    const headword = displayTerm(row.headword || row.normalized_headword, lang);
    const key = normalize(headword);
    if (!headword || selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    out.push({
      ...row,
      headword,
      normalized_headword: normalize(headword),
      batch_priority: out.length + 1
    });
    if (out.length >= target) break;
  }
  return out;
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] || 0) + 1;
    return acc;
  }, {});
}
