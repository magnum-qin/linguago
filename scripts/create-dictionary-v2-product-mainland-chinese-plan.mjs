import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/product-mainland-chinese-plan.json');
const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' });
const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');
const hasPublicationBlocks = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_sense_publication_blocks'").get());
const blockWhere = hasPublicationBlocks
  ? 'AND NOT EXISTS (SELECT 1 FROM product_sense_publication_blocks b WHERE b.product_sense_id=s.id)'
  : '';
const publishableEntryIds = new Set(db.prepare(`
  SELECT DISTINCT s.product_entry_id
  FROM product_senses s
  WHERE s.status='accepted'
    ${blockWhere}
    AND s.id IN (
      SELECT product_sense_id
      FROM product_localizations
      WHERE needs_review=0 AND NULLIF(TRIM(term),'') IS NOT NULL AND NULLIF(TRIM(definition),'') IS NOT NULL
      GROUP BY product_sense_id
      HAVING COUNT(DISTINCT lang)=4
    )
`).pluck().all());

const entries = db.prepare(`
  SELECT e.id, e.headword, e.primary_lang, e.frequency_rank, e.status,
         SUM(CASE WHEN s.status='accepted' THEN 1 ELSE 0 END) AS accepted_senses
  FROM product_entries e
  LEFT JOIN product_senses s ON s.product_entry_id=e.id
  WHERE e.primary_lang='zh'
  GROUP BY e.id
  ORDER BY COALESCE(e.frequency_rank, 2147483647), e.id
`).all();
const entryByHeadword = new Map(entries.map((row) => [row.headword, row]));
const localizations = db.prepare(`
  SELECT l.id, l.product_sense_id AS sense_id, l.term, l.definition, l.source,
         l.needs_review, s.status AS sense_status, e.id AS entry_id, e.headword
  FROM product_localizations l
  JOIN product_senses s ON s.id=l.product_sense_id
  JOIN product_entries e ON e.id=s.product_entry_id
  WHERE l.lang='zh'
  ORDER BY l.id
`).all();

const aliases = [];
const headwordRepairs = [];
const headwordReview = [];
for (const entry of entries) {
  const simplified = convert(entry.headword);
  if (!simplified) continue;
  const target = entryByHeadword.get(simplified);
  if (!target) {
    headwordRepairs.push({
      entry_id: entry.id,
      before: entry.headword,
      after: simplified,
      frequency_rank: entry.frequency_rank,
      reason: 'canonicalize_unique_traditional_headword'
    });
    if (publishableEntryIds.has(entry.id)) {
      aliases.push({
        entry_id: entry.id,
        headword: simplified,
        lang: 'zh',
        form: entry.headword,
        form_type: 'traditional_alias',
        source: 'deterministic:mainland-simplified-alias',
        confidence: 1,
        source_entry_id: entry.id,
        note: `Traditional query alias retained after canonicalizing ${entry.headword} to ${simplified}.`
      });
    } else {
      headwordReview.push({
        entry_id: entry.id,
        headword: entry.headword,
        suggested_simplified: simplified,
        frequency_rank: entry.frequency_rank,
        reason: 'canonicalized_but_alias_deferred_until_publishable'
      });
    }
    continue;
  }
  if (!publishableEntryIds.has(target.id)) {
    headwordReview.push({
      entry_id: entry.id,
      headword: entry.headword,
      suggested_simplified: simplified,
      target_entry_id: target.id,
      frequency_rank: entry.frequency_rank,
      reason: 'simplified_entry_not_publishable'
    });
    continue;
  }
  aliases.push({
    entry_id: target.id,
    headword: target.headword,
    lang: 'zh',
    form: entry.headword,
    form_type: 'traditional_alias',
    source: 'deterministic:mainland-simplified-alias',
    confidence: 1,
    source_entry_id: entry.id,
    note: `Traditional query alias for Mainland canonical headword ${target.headword}.`
  });
}

const localizationRepairs = [];
for (const row of localizations) {
  const changes = {};
  const termChange = scriptChange(row.term);
  const definitionChange = scriptChange(row.definition);
  if (termChange) changes.term = termChange;
  if (definitionChange) changes.definition = definitionChange;
  if (!Object.keys(changes).length) continue;
  localizationRepairs.push({
    localization_id: row.id,
    sense_id: row.sense_id,
    entry_id: row.entry_id,
    headword: row.headword,
    sense_status: row.sense_status,
    needs_review: row.needs_review,
    source: row.source,
    changes
  });
}

const output = {
  version: 'v1-mainland-simplified',
  created_at: new Date().toISOString(),
  database: path.relative(process.cwd(), dbPath),
  policy: {
    display: 'Mainland Simplified Chinese',
    lookup: 'retain Traditional Chinese as controlled aliases',
    semantic_repairs: 'not authorized by script conversion; handled by independent evidence review'
  },
  summary: {
    traditional_aliases: aliases.length,
    canonical_headword_repairs: headwordRepairs.length,
    headwords_manual_review: headwordReview.length,
    localization_repairs: localizationRepairs.length,
    accepted_localization_repairs: localizationRepairs.filter((row) => row.sense_status === 'accepted').length,
    term_repairs: localizationRepairs.filter((row) => row.changes.term).length,
    definition_repairs: localizationRepairs.filter((row) => row.changes.definition).length
  },
  aliases,
  headword_repairs: headwordRepairs,
  localization_repairs: localizationRepairs,
  manual_review: {
    headwords: headwordReview,
    semantic_examples: [
      {
        headword: '春节',
        incorrect_term: '青春',
        reason: 'semantic sense mismatch; never repair with OpenCC',
        required_evidence: ['cc-cedict-or-mainland-source', 'independent-source-family', 'model-review']
      }
    ]
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));
db.close();

function convert(value) {
  const original = String(value || '').normalize('NFKC').trim();
  if (!original) return null;
  const simplified = toSimplified(original);
  return simplified === original ? null : simplified;
}
function scriptChange(value) {
  const before = String(value || '');
  const normalized = before.normalize('NFKC').trim();
  if (!normalized) return null;
  const after = toSimplified(normalized);
  if (after === normalized) return null;
  return { before, after };
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
