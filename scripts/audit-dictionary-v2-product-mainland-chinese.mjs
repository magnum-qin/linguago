import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/product-mainland-chinese-audit.json');
const sampleLimit = integer(args['sample-limit'], 30, 1);
const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const entryWords = new Set(db.prepare('SELECT headword FROM product_entries').pluck().all());
const entries = db.prepare(`
  SELECT id, headword, primary_lang, frequency_rank
  FROM product_entries
  WHERE primary_lang='zh'
  ORDER BY COALESCE(frequency_rank, 2147483647), id
`).all();
const localizations = db.prepare(`
  SELECT l.id, l.product_sense_id AS sense_id, s.status, e.headword,
         l.term, l.definition, l.source, l.needs_review
  FROM product_localizations l
  JOIN product_senses s ON s.id=l.product_sense_id
  JOIN product_entries e ON e.id=s.product_entry_id
  WHERE l.lang='zh'
  ORDER BY l.id
`).all();
const sourceExamples = db.prepare(`
  SELECT id, product_sense_id AS sense_id, source_text AS text, source
  FROM product_examples
  WHERE source_lang='zh'
  ORDER BY id
`).all();
const localizedExamples = db.prepare(`
  SELECT id, product_example_id AS example_id, text, source, needs_review
  FROM product_example_localizations
  WHERE lang='zh'
  ORDER BY id
`).all();

const entryFindings = entries.map((row) => finding(row, 'headword')).filter(Boolean)
  .map((row) => ({ ...row, simplified_entry_exists: entryWords.has(row.simplified) }));
const termFindings = localizations.map((row) => finding(row, 'term')).filter(Boolean);
const definitionFindings = localizations.map((row) => finding(row, 'definition')).filter(Boolean);
const sourceExampleFindings = sourceExamples.map((row) => finding(row, 'text')).filter(Boolean);
const localizedExampleFindings = localizedExamples.map((row) => finding(row, 'text')).filter(Boolean);

const output = {
  ok: true,
  created_at: new Date().toISOString(),
  database_write: false,
  database: path.relative(process.cwd(), dbPath),
  policy: {
    target: 'neutral Mainland Simplified Chinese',
    detector: 'opencc traditional-script-to-mainland-simplified difference',
    warning: 'A detected difference is a review candidate, not an automatic replacement authorization.'
  },
  summary: {
    zh_entries: entries.length,
    traditional_zh_headwords: entryFindings.length,
    traditional_headwords_with_simplified_entry: entryFindings.filter((row) => row.simplified_entry_exists).length,
    zh_localizations: localizations.length,
    accepted_zh_localizations: localizations.filter((row) => row.status === 'accepted').length,
    traditional_zh_terms: termFindings.length,
    accepted_traditional_zh_terms: termFindings.filter((row) => row.status === 'accepted').length,
    traditional_zh_definitions: definitionFindings.length,
    accepted_traditional_zh_definitions: definitionFindings.filter((row) => row.status === 'accepted').length,
    zh_source_examples: sourceExamples.length,
    traditional_zh_source_examples: sourceExampleFindings.length,
    zh_example_localizations: localizedExamples.length,
    traditional_zh_example_localizations: localizedExampleFindings.length
  },
  breakdown: {
    accepted_traditional_terms_by_source: countBySource(termFindings.filter((row) => row.status === 'accepted')),
    accepted_traditional_definitions_by_source: countBySource(definitionFindings.filter((row) => row.status === 'accepted')),
    traditional_headwords_by_simplified_entry_presence: {
      with_simplified_entry: entryFindings.filter((row) => row.simplified_entry_exists).length,
      without_simplified_entry: entryFindings.filter((row) => !row.simplified_entry_exists).length
    }
  },
  samples: {
    headwords: entryFindings.slice(0, sampleLimit),
    terms: termFindings.slice(0, sampleLimit),
    definitions: definitionFindings.slice(0, sampleLimit),
    source_examples: sourceExampleFindings.slice(0, sampleLimit),
    localized_examples: localizedExampleFindings.slice(0, sampleLimit)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
db.close();

function finding(row, field) {
  const original = String(row[field] || '').normalize('NFKC').trim();
  if (!original) return null;
  const simplified = toSimplified(original);
  if (simplified === original) return null;
  return { ...row, field, original, simplified };
}
function countBySource(rows) {
  const counts = new Map();
  for (const row of rows) {
    const source = String(row.source || 'unknown').split('+')[0];
    counts.set(source, (counts.get(source) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) => right[1] - left[1]));
}
function integer(value, fallback, minimum) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Expected integer >= ${minimum}`);
  return parsed;
}
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return out;
}
