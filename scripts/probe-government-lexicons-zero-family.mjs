import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

const args = parseArgs(process.argv.slice(2));
const intersectionsPath = requiredPath(
  args.intersections || 'logs/product-source-gap-v95-target-deficit-intersections.json'
);
const zhManifestPath = args['zh-manifest'] === 'none'
  ? null
  : requiredPath(args['zh-manifest'] || 'data/raw/government-lexicons/naer/manifest.json');
const zhPath = zhManifestPath
  ? null
  : requiredPath(args.zh || 'data/raw/government-lexicons/naer-computer-terms.csv');
const jaPath = requiredPath(
  args.ja || 'data/raw/government-lexicons/japan-legal-terms-v19.csv'
);
const outPath = path.resolve(
  args.out || 'logs/product-source-gap-v95-government-lexicons-zero-family-probe.json'
);

const intersections = readJson(intersectionsPath);
const evidencePath = requiredPath(intersections?.source_reports?.evidence);
const evidence = readJson(evidencePath);
const evidenceByKey = new Map(
  (evidence.validations || []).map((row) => [row.candidate_key, row])
);
const candidates = (intersections.candidates || []).filter(
  (row) => row.repair_tier === 'zero_family_only'
);

const zhDatasets = zhManifestPath
  ? loadZhDatasets(zhManifestPath)
  : [{
      dataset_id: '15275',
      title: 'NAER computer terminology',
      source_url: 'https://data.gov.tw/dataset/15275',
      rows: parseCsv(stripBom(fs.readFileSync(zhPath, 'utf8')))
    }];
const jaRows = parseCsv(stripBom(fs.readFileSync(jaPath, 'utf8')));
const zhIndex = buildZhIndex(zhDatasets);
const jaIndex = buildJaIndex(jaRows);
const matches = [];

for (const candidate of candidates) {
  const validation = evidenceByKey.get(candidate.candidate_key);
  const anchor = normalizeEnglish(validation?.evidence?.anchor);
  if (!anchor) continue;
  for (const target of candidate.targets || []) {
    if (target.family_count !== 0) continue;
    const rows = target.lang === 'zh'
      ? zhIndex.get(anchor) || []
      : target.lang === 'ja'
        ? jaIndex.get(anchor) || []
        : [];
    if (!rows.length) continue;
    const preferred = target.lang === 'zh' ? preferMainlandChinese(rows) : { rows, terms: unique(rows.flatMap((row) => row.terms)), region: null };
    if (!preferred.terms.length) continue;
    matches.push({
      candidate_key: candidate.candidate_key,
      source_entry_id: Number(candidate.candidate_key.split(':')[0]),
      source_sense_id: Number(candidate.candidate_key.split(':')[1]),
      word: candidate.word,
      source_lang: candidate.source_lang,
      frequency_rank: candidate.frequency_rank,
      target_lang: target.lang,
      english_anchor: validation?.evidence?.anchor || anchor,
      source_family: target.lang === 'zh' ? 'naer_government_terms' : 'japan_moj_legal_terms',
      publication_evidence: true,
      domain_limited: true,
      terms: preferred.terms,
      term_region: preferred.region,
      records: preferred.rows.slice(0, 10)
    });
  }
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    exact_english_anchor_only: true,
    independent_government_source_families: true,
    domain_limited_evidence_requires_final_roundtrip: true,
    automatic_promotion: false,
    chinese_term_precedence: 'mainland_only_when_available_else_simplified_taiwan_fallback'
  },
  inputs: {
    intersections: relative(intersectionsPath),
    evidence: relative(evidencePath),
    zh: zhManifestPath ? relative(zhManifestPath) : relative(zhPath),
    ja: relative(jaPath)
  },
  sources: {
    naer_government_terms: {
      authority: 'National Academy for Educational Research, Taiwan',
      license: 'Open Government Data License 1.0',
      domain: 'academic and government terminology',
      datasets: zhDatasets.length,
      rows: zhDatasets.reduce((sum, dataset) => sum + Math.max(0, dataset.rows.length - 1), 0)
    },
    japan_moj_legal_terms: {
      authority: 'Ministry of Justice, Japan',
      license: 'Public Data License 1.0',
      domain: 'legal terminology',
      rows: Math.max(0, jaRows.length - 1)
    }
  },
  summary: {
    zero_family_candidates: candidates.length,
    matched_candidate_target_pairs: matches.length,
    matched_candidates: new Set(matches.map((row) => row.candidate_key)).size,
    by_target_lang: countBy(matches, (row) => row.target_lang),
    by_source_lang: countBy(matches, (row) => row.source_lang),
    unique_terms: unique(matches.flatMap((row) => row.terms)).length
  },
  validations: matches.map((row) => ({
    candidate_key: row.candidate_key,
    target_lang: row.target_lang,
    decision: 'accept',
    existing_terms: [],
    accepted_terms: row.terms.map((term) => ({
      term,
      families: [row.source_family],
      domain_limited: true,
      ...(row.term_region ? { region: row.term_region } : {})
    }))
  })),
  matches
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ...output.summary }, null, 2));

function buildZhIndex(datasets) {
  const index = new Map();
  for (const dataset of datasets) {
    const [header, ...body] = dataset.rows;
    const columns = columnMap(header);
    const englishColumn = firstColumn(columns, ['英文名稱', '英文名詞', '英文詞彙', '英文']);
    const chineseColumn = firstColumn(columns, ['中文名稱', '中文名詞', '中文詞彙', '中文']);
    const mainlandColumn = firstColumn(columns, ['中國大陸譯名', '大陆译名', '大陸譯名']);
    if (englishColumn === null || (chineseColumn === null && mainlandColumn === null)) continue;
    for (const row of body) {
      const english = row[englishColumn] || '';
      const taiwan = splitTerms(chineseColumn === null ? '' : row[chineseColumn] || '');
      const mainland = splitTerms(mainlandColumn === null ? '' : row[mainlandColumn] || '')
        .map((term) => term.replace(/【[^】]*】/gu, '').trim())
        .filter(Boolean);
      const terms = unique([...mainland, ...taiwan]);
      if (!terms.length) continue;
      for (const anchor of splitEnglishTerms(english)) {
        addIndex(index, anchor, {
          terms,
          english,
          taiwan_terms: taiwan,
          mainland_terms: mainland,
          dataset_id: dataset.dataset_id,
          dataset_title: dataset.title,
          source_url: dataset.source_url
        });
      }
    }
  }
  return index;
}

function preferMainlandChinese(rows) {
  const mainlandTerms = unique(rows.flatMap((row) => row.mainland_terms || []))
    .map(toSimplifiedChinese)
    .filter(Boolean);
  if (mainlandTerms.length) {
    return {
      rows: rows.filter((row) => (row.mainland_terms || []).length > 0),
      terms: unique(mainlandTerms),
      region: 'mainland'
    };
  }
  return {
    rows,
    terms: unique(rows.flatMap((row) => row.taiwan_terms || []).map(toSimplifiedChinese).filter(Boolean)),
    region: 'taiwan_fallback'
  };
}

function toSimplifiedChinese(value) {
  return traditionalToSimplified(String(value || '').normalize('NFKC').trim());
}

function loadZhDatasets(manifestPath) {
  const manifest = readJson(manifestPath);
  return (manifest.datasets || [])
    .filter((row) => row.status !== 'failed' && row.file && fs.existsSync(path.resolve(row.file)))
    .map((row) => ({
      dataset_id: row.dataset_id,
      title: row.title,
      source_url: row.source_url,
      rows: parseCsv(stripBom(fs.readFileSync(path.resolve(row.file), 'utf8')))
    }));
}

function buildJaIndex(rows) {
  const [header, ...body] = rows;
  const columns = columnMap(header);
  const index = new Map();
  for (const row of body) {
    const term = String(row[columns.get('用語')] || '').trim();
    const translation = String(row[columns.get('訳語候補')] || '').trim();
    if (!term || !translation) continue;
    for (const anchor of splitEnglishTerms(translation)) {
      addIndex(index, anchor, {
        terms: [term],
        translation,
        reading: row[columns.get('読み')] || null,
        translation_number: row[columns.get('訳語候補番号')] || null,
        usage_standard: row[columns.get('使い分け基準')] || null,
        note: row[columns.get('注釈1')] || row[columns.get('注釈2')] || null
      });
    }
  }
  return index;
}

function splitEnglishTerms(value) {
  return unique(
    String(value || '')
      .replace(/^\([^)]*\)\s*[;:]?\s*/u, '')
      .split(/\s*(?:;|\/|\||\bor\b)\s*/iu)
      .map((term) => normalizeEnglish(term))
      .filter(Boolean)
  );
}

function splitTerms(value) {
  return unique(
    String(value || '')
      .split(/[;；、，,\/]/u)
      .map((term) => term.trim())
      .filter(Boolean)
  );
}

function normalizeEnglish(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"']/gu, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s,.;:()\[\]-]+|[\s,.;:()\[\]-]+$/gu, '')
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/u, ''));
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/u, ''));
    rows.push(row);
  }
  return rows;
}

function columnMap(header = []) {
  return new Map(header.map((name, index) => [String(name).trim(), index]));
}

function firstColumn(columns, names) {
  for (const name of names) if (columns.has(name)) return columns.get(name);
  return null;
}

function addIndex(index, key, value) {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stripBom(value) {
  return value.replace(/^\uFEFF/u, '');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value) {
  if (!value) throw new Error('Missing required path');
  const resolved = path.resolve(String(value));
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  return resolved;
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      i += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
