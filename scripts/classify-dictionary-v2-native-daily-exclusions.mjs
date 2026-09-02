#!/usr/bin/env node

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const productDbPath = path.resolve(args['product-db'] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const exclusionsPath = path.resolve(args.exclusions || 'state/native-daily-source-entry-exclusions.json');
const outPath = path.resolve(args.out || 'logs/native-daily-exclusion-classification.json');
const blockedOutPath = args['blocked-out'] ? path.resolve(args['blocked-out']) : null;
const attemptPath = path.resolve(args['attempt-index'] || 'state/additional-sense-attempt-index.json');
const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

for (const file of [sourceDbPath, productDbPath, exclusionsPath, attemptPath]) {
  if (!fs.existsSync(file)) throw new Error(`Required input not found: ${file}`);
}
const exclusionReport = readJson(exclusionsPath);
const attempted = new Set((readJson(attemptPath).selected || []).map((row) => `${row.source_entry_id}:${row.source_sense_id}`));
const ids = (exclusionReport.selected || []).map((row) => Number(row.source_entry_id)).filter((id) => Number.isInteger(id) && id > 0);
const productDb = new Database(productDbPath, { readonly: true, fileMustExist: true });
productDb.pragma('query_only = ON');
const coverage = new Set();
for (const row of productDb.prepare('SELECT primary_lang AS lang, normalized_key AS term FROM product_entries WHERE status = \'accepted\'').iterate()) addCoverage(row);
for (const row of productDb.prepare(`
  SELECT pl.lang, pl.term
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  WHERE ps.status = 'accepted' AND pl.needs_review = 0
`).iterate()) addCoverage(row);
productDb.close();

const sourceDb = new Database(sourceDbPath, { readonly: true, fileMustExist: true });
sourceDb.pragma('query_only = ON');
sourceDb.pragma('busy_timeout = 30000');
const selectEntry = sourceDb.prepare(`
  SELECT e.id AS source_entry_id, e.word, e.normalized_key, e.source_lang, e.frequency_rank,
         (SELECT s.gloss_key FROM senses s WHERE s.entry_id=e.id AND s.needs_review=0 ORDER BY s.sense_order, s.id LIMIT 1) AS gloss
  FROM entries e WHERE e.id=?
`);
const selectSenses = sourceDb.prepare('SELECT id, source, gloss_key FROM senses WHERE entry_id=? AND needs_review=0');
const classified = [];
for (let index = 0; index < ids.length; index += 1) {
  const row = selectEntry.get(ids[index]);
  if (!row) continue;
  classified.push({ ...row, ...classify(row) });
  if ((index + 1) % 10000 === 0) process.stderr.write(`classified=${index + 1}/${ids.length}\n`);
}
sourceDb.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    mainland_simplified_primary: true,
    traditional_only_as_alias_or_when_no_simplified_form_exists: true,
    low_value_candidates_not_requeued: true,
    automatic_publication: false
  },
  summary: {
    input_exclusions: ids.length,
    classified: classified.length,
    by_disposition: countBy(classified, (row) => row.disposition),
    retryable_or_gap: classified.filter((row) => row.requeue_eligible).length
  },
  selected_count: classified.filter((row) => row.requeue_eligible).length,
  selected: classified.filter((row) => row.requeue_eligible),
  classified
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (blockedOutPath) {
  const blocked = classified.filter((row) => !row.requeue_eligible);
  fs.mkdirSync(path.dirname(blockedOutPath), { recursive: true });
  fs.writeFileSync(blockedOutPath, `${JSON.stringify({
    ok: true,
    generated_at: output.generated_at,
    source_report: relative(outPath),
    selected_count: blocked.length,
    selected: blocked.map((row) => ({ source_entry_id: row.source_entry_id, disposition: row.disposition }))
  }, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function classify(row) {
  const lang = String(row.source_lang || '');
  const sourceWord = String(row.word || '').trim();
  const simplified = lang === 'zh' ? traditionalToSimplified(sourceWord) : sourceWord;
  const exactCovered = coverage.has(key(lang, sourceWord)) || coverage.has(key(lang, row.normalized_key));
  const simplifiedCovered = lang === 'zh' && coverage.has(key('zh', simplified));
  if (exactCovered) return disposition('published_or_semantic_duplicate', false, simplified, sourceWord);
  if (sourceWord !== simplified && simplifiedCovered) return disposition('traditional_form_of_existing_simplified', false, simplified, sourceWord);
  if (lowValue(row, simplified)) return disposition('low_value_proper_or_variant', false, simplified, sourceWord);
  const freshSenses = selectSenses.all(row.source_entry_id).filter((sense) =>
    !attempted.has(`${row.source_entry_id}:${sense.id}`) &&
    /cc-cedict|jmdict|freedict|ecdict/i.test(String(sense.source || '')) &&
    String(sense.gloss_key || '').trim().length > 1
  );
  if (!freshSenses.length) return disposition('manual_review_no_unattempted_native_sense', false, simplified, sourceWord);
  const rank = Number(row.frequency_rank || Number.MAX_SAFE_INTEGER);
  if (rank <= 50000) return disposition('high_frequency_gap_pending_evidence', true, simplified, sourceWord);
  // A frequency rank alone cannot establish that a historical rejection was
  // repaired. Defer lower-value and previously judged senses for explicit review.
  if (rank <= 200000) return disposition('previous_failure_requires_repair_evidence', false, simplified, sourceWord);
  return disposition('low_value_proper_or_variant', false, simplified, sourceWord);
}

function disposition(value, eligible, canonical, source) {
  return {
    disposition: value,
    requeue_eligible: eligible,
    canonical_word: canonical,
    traditional_alias: canonical !== source ? source : null
  };
}

function lowValue(row, word) {
  const lang = String(row.source_lang || '');
  const gloss = String(row.gloss || '');
  if (lang === 'zh' && ([...word].length < 2 || [...word].length > 8)) return true;
  if (lang === 'ja' && [...word].length > 12) return true;
  if (['en', 'pt-BR'].includes(lang) && (/^[A-Z]/u.test(word) || word.length < 3 || /^[A-Z.]+$/u.test(word))) return true;
  return /\b(?:surname|given name|place name|province|prefecture|chemical|enzyme|protein|species|genus|archaic|obsolete)\b/iu.test(gloss);
}

function addCoverage(row) { const normalized = normalize(row.term); if (normalized) coverage.add(`${row.lang}\0${normalized}`); }
function key(lang, value) { return `${lang}\0${normalize(value)}`; }
function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
function countBy(rows, selector) { const result = {}; for (const row of rows) { const key = selector(row); result[key] = (result[key] || 0) + 1; } return result; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(value) { return path.relative(process.cwd(), value); }
function parseArgs(argv) { const out = {}; for (let i=0;i<argv.length;i+=1) { if (!argv[i].startsWith('--')) continue; const key=argv[i].slice(2); const next=argv[i+1]; if (next && !next.startsWith('--')) { out[key]=next; i+=1; } else out[key]='true'; } return out; }
