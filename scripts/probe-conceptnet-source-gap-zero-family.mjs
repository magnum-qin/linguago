import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';

const EXISTING_FAMILIES = new Set(['wiktionary', 'wordnet', 'jmdict', 'dbpedia', 'unknown']);

const args = parseArgs(process.argv.slice(2));
const assertionsPath = requiredPath(args.assertions, 'assertions');
const deficitsPath = requiredPath(args.deficits, 'deficits');
const evidencePath = requiredPath(args.evidence, 'evidence');
const outPath = path.resolve(args.out || 'logs/product-source-gap-conceptnet-zero-family-probe.json');
const deficits = JSON.parse(fs.readFileSync(deficitsPath, 'utf8'));
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
const validationByKey = new Map((evidence.validations || []).map((row) => [row.candidate_key, row]));
const candidatesByAnchorLang = new Map();

const deficitRows = Array.isArray(deficits.insufficient_targets)
  ? deficits.insufficient_targets
  : Array.isArray(deficits.selected)
    ? deficits.selected
    : [];

for (const deficit of deficitRows) {
  if ((deficit.observed_families || []).length || !['zh', 'ja', 'pt-BR'].includes(deficit.target_lang)) continue;
  const validation = validationByKey.get(deficit.candidate_key);
  const anchor = validation?.evidence?.anchor;
  if (!anchor) continue;
  for (const term of splitAnchor(anchor)) {
    const key = `${normalizeEnglish(term)}\0${deficit.target_lang}`;
    if (!candidatesByAnchorLang.has(key)) candidatesByAnchorLang.set(key, []);
    candidatesByAnchorLang.get(key).push({
      candidate_key: deficit.candidate_key,
      word: deficit.word,
      source_lang: deficit.source_lang,
      target_lang: deficit.target_lang,
      english_anchor: anchor,
      frequency_rank: validation.frequency_rank ?? null
    });
  }
}

let scanned = 0;
let synonymEdges = 0;
let crossLanguageEdges = 0;
const matches = [];
const input = fs.createReadStream(assertionsPath).pipe(zlib.createGunzip());
const lines = readline.createInterface({ input, crlfDelay: Infinity });

for await (const line of lines) {
  scanned += 1;
  const columns = line.split('\t');
  if (columns.length < 5 || columns[1] !== '/r/Synonym') continue;
  synonymEdges += 1;
  const left = parseConcept(columns[2]);
  const right = parseConcept(columns[3]);
  if (!left || !right) continue;
  const rightTargetLang = conceptNetTargetLang(right.lang);
  const leftTargetLang = conceptNetTargetLang(left.lang);
  const pair = left.lang === 'en' && rightTargetLang
    ? { english: left, target: right, target_lang: rightTargetLang }
    : right.lang === 'en' && leftTargetLang
      ? { english: right, target: left, target_lang: leftTargetLang }
      : null;
  if (!pair) continue;
  crossLanguageEdges += 1;
  const candidates = candidatesByAnchorLang.get(`${normalizeEnglish(pair.english.term)}\0${pair.target_lang}`);
  if (!candidates?.length) continue;
  const metadata = safeJson(columns[4]);
  const provenance = classifyProvenance(metadata);
  for (const candidate of candidates) {
    matches.push({
      ...candidate,
      target_term: pair.target.term,
      target_pos: pair.target.pos,
      conceptnet_uri: columns[0],
      weight: Number(metadata.weight) || null,
      dataset: metadata.dataset || null,
      license: metadata.license || null,
      source_uris: provenance.source_uris,
      source_families: provenance.families,
      has_potentially_new_family: provenance.families.some((family) => !EXISTING_FAMILIES.has(family))
    });
  }
}

const uniqueMatches = uniqueBy(matches, (row) =>
  `${row.candidate_key}\0${row.target_lang}\0${normalizeTerm(row.target_term)}\0${row.source_families.join(',')}`
);
const familyCounts = {};
for (const row of uniqueMatches) {
  for (const family of row.source_families) familyCounts[family] = (familyCounts[family] || 0) + 1;
}
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    exact_english_anchor_only: true,
    relation: 'Synonym',
    conceptnet_is_aggregator_not_family: true,
    production_publishable: false
  },
  summary: {
    candidate_anchor_language_keys: candidatesByAnchorLang.size,
    scanned_assertions: scanned,
    synonym_edges: synonymEdges,
    english_zh_ja_synonym_edges: crossLanguageEdges,
    matched_rows: uniqueMatches.length,
    matched_candidates: new Set(uniqueMatches.map((row) => row.candidate_key)).size,
    potentially_new_family_rows: uniqueMatches.filter((row) => row.has_potentially_new_family).length,
    source_family_counts: Object.fromEntries(Object.entries(familyCounts).sort((a, b) => b[1] - a[1]))
  },
  matches: uniqueMatches.sort((a, b) =>
    (a.frequency_rank ?? 1e9) - (b.frequency_rank ?? 1e9) || a.candidate_key.localeCompare(b.candidate_key)
  )
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(process.cwd(), outPath), ...output.summary }, null, 2));

function parseConcept(uri) {
  const match = String(uri || '').match(/^\/c\/([^/]+)\/([^/]+)(?:\/([^/]+))?/u);
  if (!match) return null;
  return { lang: match[1], term: decodeURIComponent(match[2]).replaceAll('_', ' '), pos: match[3] || null };
}
function conceptNetTargetLang(value) {
  if (value === 'zh' || value === 'ja') return value;
  if (value === 'pt') return 'pt-BR';
  return null;
}
function classifyProvenance(metadata) {
  const sourceUris = [];
  if (metadata.dataset) sourceUris.push(String(metadata.dataset));
  for (const source of metadata.sources || []) {
    for (const value of Object.values(source || {})) if (typeof value === 'string') sourceUris.push(value);
  }
  const families = new Set();
  for (const uri of sourceUris) {
    const value = uri.toLowerCase();
    if (value.startsWith('/s/process/')) continue;
    if (value.includes('wiktionary')) families.add('wiktionary');
    else if (value.includes('wordnet')) families.add('wordnet');
    else if (value.includes('jmdict') || value.includes('edict')) families.add('jmdict');
    else if (value.includes('dbpedia')) families.add('dbpedia');
    else if (value.includes('opencyc')) families.add('opencyc');
    else if (value.includes('globalmind')) families.add('globalmind');
    else if (value.includes('verbosity')) families.add('verbosity');
    else if (value.includes('nadya')) families.add('nadya-jp');
    else if (value.includes('/d/omcs') || value.includes('/s/activity/omcs')) families.add('omcs');
    else families.add(`unmapped:${value}`);
  }
  if (!families.size) families.add('unknown');
  return { source_uris: [...new Set(sourceUris)].sort(), families: [...families].sort() };
}
function splitAnchor(value) {
  return String(value || '').split(/[;|/]/u).map((term) => term.trim()).filter(Boolean);
}
function normalizeEnglish(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
}
function normalizeTerm(value) {
  return String(value || '').normalize('NFKC').toLowerCase().trim();
}
function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}
function uniqueBy(values, keyOf) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyOf(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const result = path.resolve(value);
  if (!fs.existsSync(result)) throw new Error(`File not found: ${result}`);
  return result;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else out[key] = true;
  }
  return out;
}
