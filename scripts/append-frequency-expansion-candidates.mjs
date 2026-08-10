import fs from 'node:fs';
import path from 'node:path';

const RAW_DIR = path.resolve('data/raw/frequency');
const OUT_FILE = path.resolve('data/processed/frequency_candidates.jsonl');
const REPORT_FILE = path.resolve('data/processed/frequency-expansion-report.json');
const LANG_ORDER = (process.env.EXPANSION_LANG_ORDER || 'zh,en,ja')
  .split(',')
  .map((lang) => lang.trim())
  .filter(Boolean);
const PER_LANG = Number(process.env.EXPANSION_PER_LANG || 2000);
const ROUND = process.env.EXPANSION_ROUND || `freq-expansion-${new Date().toISOString().slice(0, 10)}`;

const frequencyFiles = {
  zh: ['frequencywords-zh_50k.txt', 'wordfrequency-zh-CN.txt'],
  en: ['frequencywords-en_50k.txt', 'wordfrequency-en.txt'],
  ja: ['frequencywords-ja_50k.txt', 'wordfrequency-ja.txt']
};

if (!fs.existsSync(OUT_FILE)) throw new Error(`Candidate file not found: ${OUT_FILE}`);

const existingLines = fs.readFileSync(OUT_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
const seen = new Set();
for (const line of existingLines) {
  const row = JSON.parse(line);
  seen.add(makeKey(row.source_lang, row.normalized_headword || row.headword));
}

const appended = [];
const report = {
  generated_at: new Date().toISOString(),
  round: ROUND,
  out_file: path.relative(process.cwd(), OUT_FILE),
  existing_candidates: existingLines.length,
  per_lang_target: PER_LANG,
  lang_order: LANG_ORDER,
  by_lang: {}
};

for (const lang of LANG_ORDER) {
  const files = frequencyFiles[lang] || [];
  const selected = [];
  let scanned = 0;
  let duplicate = 0;
  let filtered = 0;

  for (const file of files) {
    const terms = readFrequencyTerms(path.join(RAW_DIR, file), lang);
    for (const { term, rank } of terms) {
      scanned += 1;
      if (!isGoodTerm(term, lang)) {
        filtered += 1;
        continue;
      }

      const headword = displayTerm(term, lang);
      const key = makeKey(lang, headword);
      if (seen.has(key)) {
        duplicate += 1;
        continue;
      }

      seen.add(key);
      selected.push({
        headword,
        normalized_headword: normalize(headword),
        source_lang: lang,
        source_id: `frequency-expansion-${lang}`,
        source_license: 'Verify upstream frequency list license before redistribution',
        source_ref: { frequency_term: term, frequency_source: file },
        hints: {},
        frequency_rank: rank,
        frequency_source: file,
        expansion_round: ROUND,
        batch_priority: selected.length + 1
      });

      if (selected.length >= PER_LANG) break;
    }
    if (selected.length >= PER_LANG) break;
  }

  appended.push(...selected);
  report.by_lang[lang] = {
    scanned,
    selected: selected.length,
    duplicate,
    filtered,
    first_20: selected.slice(0, 20).map((row) => row.headword)
  };
}

if (appended.length) {
  fs.appendFileSync(OUT_FILE, appended.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

report.appended = appended.length;
report.total_candidates = existingLines.length + appended.length;
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));

function readFrequencyTerms(file, lang) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => {
      const term = line.split(/\s+/)[0]?.trim();
      if (!term || isHeader(term, lang, index)) return [];
      return [{ term, rank: index + 1 }];
    });
}

function isHeader(term, lang, index) {
  if (index !== 0) return false;
  const lower = term.toLowerCase();
  return lower === lang.toLowerCase() || (lang === 'zh' && lower === 'zh-cn');
}

function makeKey(lang, term) {
  return `${lang}:${normalize(term)}`;
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function displayTerm(term, lang) {
  const normalized = term.normalize('NFKC').trim();
  return lang === 'en' ? normalized.toLocaleLowerCase() : normalized;
}

function isGoodTerm(term, lang) {
  const text = term.normalize('NFKC').trim();
  if (!text || /[0-9_/@#%&*=+()[\]{}<>]/.test(text)) return false;
  if (lang === 'zh') return /^[\u3400-\u9fff]{1,6}$/u.test(text);
  if (lang === 'ja') {
    return /[\u3041-\u3096\u30a1-\u30fa\u3400-\u9fff]/u.test(text) && !/^[a-z]+$/i.test(text) && text.length <= 12;
  }
  if (lang === 'en') {
    if (/^(don|doesn|didn|isn|aren|wasn|weren|can|couldn|wouldn|shouldn|won|haven|hasn|hadn|ain|let)$/i.test(text)) {
      return false;
    }
    return /^[a-z][a-z'-]{1,18}$/i.test(text);
  }
  return false;
}
