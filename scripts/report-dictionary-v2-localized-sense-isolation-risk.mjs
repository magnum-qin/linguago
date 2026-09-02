import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const outPath = path.resolve(args.out || 'logs/product-localized-sense-isolation-risk.json');
const limit = boundedInteger(args.limit, 5000, 1);
const offset = boundedInteger(args.offset, 0, 0);
const maxFormsPerEntry = boundedInteger(args['max-forms-per-entry'], 8, 1);
const queryLang = optionalLanguage(args['query-lang']);
const primaryLang = optionalLanguage(args['primary-lang']);
const maxRank = optionalInteger(args['max-rank'], 1);
const minSenses = boundedInteger(args['min-senses'], 2, 2);
const excludeArtifacts = args['exclude-artifacts'] === 'true';
if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  WITH effective AS (
    SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
           ps.confidence
    FROM product_senses ps
    WHERE ps.status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM product_sense_publication_blocks pb
        WHERE pb.product_sense_id = ps.id
      )
  ), entry_counts AS (
    SELECT product_entry_id, COUNT(*) AS sense_count
    FROM effective GROUP BY product_entry_id HAVING COUNT(*) > 1
  ), forms AS (
    SELECT e.product_entry_id, pl.lang, lower(trim(pl.term)) AS normalized_term,
           MIN(pl.term) AS term, COUNT(DISTINCT pl.product_sense_id) AS matched_count,
           group_concat(DISTINCT pl.product_sense_id) AS matched_ids
    FROM effective e
    JOIN product_localizations pl ON pl.product_sense_id = e.id
    WHERE trim(pl.term) <> ''
    GROUP BY e.product_entry_id, pl.lang, lower(trim(pl.term))
  )
  SELECT pe.id AS entry_id, pe.headword, pe.primary_lang, pe.frequency_rank,
         pe.group_method, pe.source_count, ec.sense_count,
         f.lang AS query_lang, f.term AS query_term, f.normalized_term,
         f.matched_count, f.matched_ids
  FROM forms f
  JOIN entry_counts ec ON ec.product_entry_id = f.product_entry_id
  JOIN product_entries pe ON pe.id = f.product_entry_id
  WHERE f.matched_count < ec.sense_count
  ORDER BY COALESCE(NULLIF(pe.frequency_rank, 0), 2147483647), ec.sense_count DESC,
           f.matched_count ASC, pe.id, f.lang, f.normalized_term
`).all();

const sensesByEntry = new Map();
const senseRows = db.prepare(`
  SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         ps.confidence, pl.lang, pl.term, pl.reading, pl.reading_system,
         pl.pronunciation, pl.pronunciation_system, pl.definition, pl.source
  FROM product_senses ps
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
  ORDER BY ps.product_entry_id, ps.sense_order, pl.lang
`).iterate();
for (const row of senseRows) {
  if (!sensesByEntry.has(row.product_entry_id)) sensesByEntry.set(row.product_entry_id, new Map());
  const senses = sensesByEntry.get(row.product_entry_id);
  if (!senses.has(row.id)) {
    senses.set(row.id, {
      id: row.id,
      sense_order: row.sense_order,
      part_of_speech: row.part_of_speech,
      gloss_key: row.gloss_key,
      confidence: row.confidence,
      localizations: {}
    });
  }
  senses.get(row.id).localizations[row.lang] = {
    term: row.term,
    reading: row.reading,
    reading_system: row.reading_system,
    pronunciation: row.pronunciation,
    pronunciation_system: row.pronunciation_system,
    definition: row.definition,
    source: row.source
  };
}

const filteredRows = rows.filter((row) => {
  if (queryLang && row.query_lang !== queryLang) return false;
  if (primaryLang && row.primary_lang !== primaryLang) return false;
  if (maxRank != null) {
    const rank = Number(row.frequency_rank);
    if (!Number.isInteger(rank) || rank <= 0 || rank > maxRank) return false;
  }
  return Number(row.sense_count) >= minSenses;
});
const deterministicExclusions = excludeArtifacts
  ? filteredRows.map((row) => ({ row, reason: queryArtifactReason(row.query_term) })).filter((item) => item.reason)
  : [];
const excludedIds = new Set(deterministicExclusions.map((item) => rowKey(item.row)));
const eligibleRows = filteredRows.filter((row) => !excludedIds.has(rowKey(row))).sort((left, right) => {
  const leftUnmatched = Number(left.sense_count) - Number(left.matched_count);
  const rightUnmatched = Number(right.sense_count) - Number(right.matched_count);
  return riskPriority(right, rightUnmatched) - riskPriority(left, leftUnmatched)
    || normalizedRank(left.frequency_rank) - normalizedRank(right.frequency_rank)
    || Number(left.entry_id) - Number(right.entry_id)
    || String(left.query_lang).localeCompare(String(right.query_lang))
    || String(left.normalized_term).localeCompare(String(right.normalized_term));
});
const formCounts = new Map();
const candidates = [];
let eligiblePosition = 0;
for (const row of eligibleRows) {
  const count = formCounts.get(row.entry_id) || 0;
  if (count >= maxFormsPerEntry) continue;
  formCounts.set(row.entry_id, count + 1);
  if (eligiblePosition++ < offset) continue;
  if (candidates.length >= limit) break;
  const matchedIds = new Set(String(row.matched_ids).split(',').map(Number));
  const senses = [...(sensesByEntry.get(row.entry_id)?.values() || [])];
  const unmatchedCount = row.sense_count - row.matched_count;
  candidates.push({
    candidate_id: `${row.entry_id}:${row.query_lang}:${row.normalized_term}`,
    entry: {
      id: row.entry_id,
      headword: row.headword,
      primary_lang: row.primary_lang,
      frequency_rank: row.frequency_rank,
      group_method: row.group_method,
      source_count: row.source_count
    },
    query_form: {
      lang: row.query_lang,
      term: row.query_term,
      normalized_term: row.normalized_term
    },
    risk: {
      type: 'localized_term_matches_subset_of_senses',
      sense_count: row.sense_count,
      matched_count: row.matched_count,
      unmatched_count: unmatchedCount,
      priority_score: riskPriority(row, unmatchedCount)
    },
    deterministic_matched_sense_ids: [...matchedIds].sort((a, b) => a - b),
    senses
  });
}
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  policy: 'read_only_localized_term_subset_risk',
  filters: {
    query_lang: queryLang,
    primary_lang: primaryLang,
    max_rank: maxRank,
    min_senses: minSenses,
    exclude_artifacts: excludeArtifacts
  },
  summary: {
    raw_risk_forms: rows.length,
    filtered_risk_forms: filteredRows.length,
    deterministic_exclusions: deterministicExclusions.length,
    deterministic_exclusion_reasons: countBy(deterministicExclusions, (item) => item.reason),
    eligible_risk_forms: eligibleRows.length,
    selected: candidates.length,
    offset,
    distinct_entries: new Set(candidates.map((row) => row.entry.id)).size,
    max_forms_per_entry: maxFormsPerEntry
  },
  deterministic_exclusions: deterministicExclusions.map(({ row, reason }) => ({
    candidate_id: `${row.entry_id}:${row.query_lang}:${row.normalized_term}`,
    entry_id: row.entry_id,
    headword: row.headword,
    query_lang: row.query_lang,
    query_term: row.query_term,
    reason
  })),
  candidates
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
function boundedInteger(value, fallback, minimum) {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}
function optionalInteger(value, minimum) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}
function optionalLanguage(value) {
  if (value == null || value === '' || value === 'all') return null;
  const normalized = value === 'pt' ? 'pt-BR' : value;
  if (!['en', 'pt-BR', 'zh', 'ja'].includes(normalized)) throw new Error(`Invalid language: ${value}`);
  return normalized;
}
function riskPriority(row, unmatchedCount) {
  const rank = Number(row.frequency_rank);
  const frequency = Number.isInteger(rank) && rank > 0 ? Math.max(0, 100_000 - rank) / 100_000 : 0;
  const coverageGap = unmatchedCount / Math.max(1, Number(row.sense_count));
  const breadth = Math.min(1, (Number(row.sense_count) - 1) / 8);
  return Number((frequency * 5 + coverageGap * 3 + breadth * 2).toFixed(4));
}
function normalizedRank(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank > 0 ? rank : Number.MAX_SAFE_INTEGER;
}
function queryArtifactReason(value) {
  const text = String(value || '').trim();
  if (!text) return 'empty_query_term';
  if (/其他含义|其它含义|拆分|待补|占位|unknown|other meanings?/iu.test(text)) return 'placeholder_query_term';
  if (/[\/｜|]/u.test(text)) return 'composite_query_term';
  return null;
}
function rowKey(row) {
  return `${row.entry_id}:${row.query_lang}:${row.normalized_term}`;
}
function countBy(rows, getter) {
  const output = {};
  for (const row of rows) {
    const key = getter(row) || 'unknown';
    output[key] = (output[key] || 0) + 1;
  }
  return output;
}
