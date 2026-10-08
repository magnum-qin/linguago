#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const outPath = process.argv[3] || 'D:/linguago-runner/logs/audit-top5000-isolation-risk-report.json';

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('Auditing localized sense isolation risk for Top 5,000 entries...');

const query = db.prepare(`
  WITH effective AS (
    SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.gloss_key
    FROM product_senses ps
    WHERE ps.status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
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
         ec.sense_count, f.lang AS query_lang, f.term AS query_term,
         f.normalized_term, f.matched_count, f.matched_ids
  FROM forms f
  JOIN entry_counts ec ON ec.product_entry_id = f.product_entry_id
  JOIN product_entries pe ON pe.id = f.product_entry_id
  WHERE f.matched_count < ec.sense_count
    AND pe.frequency_rank > 0 AND pe.frequency_rank <= 5000
  ORDER BY pe.frequency_rank ASC, ec.sense_count DESC, f.matched_count ASC
`);

const rows = query.all();

// Collect detailed senses for top risk candidates
const senseDetailStmt = db.prepare(`
  SELECT ps.id, ps.sense_order, ps.part_of_speech, ps.gloss_key,
         pl.lang, pl.term, pl.reading, pl.definition
  FROM product_senses ps
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.product_entry_id = ?
  ORDER BY ps.sense_order, pl.lang
`);

const byQueryLang = {};
const byPrimaryLang = {};
const bySenseCount = {};
const byRankBucket = { '1-500': 0, '501-1000': 0, '1001-2000': 0, '2001-5000': 0 };
const distinctEntries = new Set();
const severeRiskEntries = new Set(); // sense_count >= 3 and matched_count == 1

for (const r of rows) {
  distinctEntries.add(r.entry_id);
  byQueryLang[r.query_lang] = (byQueryLang[r.query_lang] || 0) + 1;
  byPrimaryLang[r.primary_lang] = (byPrimaryLang[r.primary_lang] || 0) + 1;
  bySenseCount[r.sense_count] = (bySenseCount[r.sense_count] || 0) + 1;
  
  if (r.sense_count >= 3 && r.matched_count === 1) {
    severeRiskEntries.add(r.entry_id);
  }

  const rank = r.frequency_rank;
  if (rank <= 500) byRankBucket['1-500']++;
  else if (rank <= 1000) byRankBucket['501-1000']++;
  else if (rank <= 2000) byRankBucket['1001-2000']++;
  else byRankBucket['2001-5000']++;
}

// Extract top 30 risk cases with rich sense context
const topSampleEntries = [];
const seenEntries = new Set();

for (const r of rows) {
  if (seenEntries.has(r.entry_id)) continue;
  seenEntries.add(r.entry_id);
  if (topSampleEntries.length >= 30) break;

  const sensesRaw = senseDetailStmt.all(r.entry_id);
  const sensesMap = new Map();
  for (const s of sensesRaw) {
    if (!sensesMap.has(s.id)) {
      sensesMap.set(s.id, {
        id: s.id,
        order: s.sense_order,
        pos: s.part_of_speech,
        gloss: s.gloss_key,
        localizations: {}
      });
    }
    sensesMap.get(s.id).localizations[s.lang] = {
      term: s.term,
      reading: s.reading,
      definition: s.definition
    };
  }

  topSampleEntries.push({
    entry_id: r.entry_id,
    headword: r.headword,
    primary_lang: r.primary_lang,
    frequency_rank: r.frequency_rank,
    sense_count: r.sense_count,
    query_form: {
      lang: r.query_lang,
      term: r.query_term,
      matched_count: r.matched_count,
      matched_sense_ids: r.matched_ids.split(',').map(Number)
    },
    senses: [...sensesMap.values()]
  });
}

const summary = {
  timestamp: new Date().toISOString(),
  database: dbPath,
  total_risk_query_forms: rows.length,
  distinct_entries_affected: distinctEntries.size,
  severe_risk_entries_count: severeRiskEntries.size,
  breakdown_by_query_lang: byQueryLang,
  breakdown_by_primary_lang: byPrimaryLang,
  breakdown_by_sense_count: bySenseCount,
  breakdown_by_rank_bucket: byRankBucket,
  top_samples: topSampleEntries
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

console.log('Isolation risk audit complete:');
console.log(JSON.stringify({
  total_risk_query_forms: summary.total_risk_query_forms,
  distinct_entries_affected: summary.distinct_entries_affected,
  severe_risk_entries_count: summary.severe_risk_entries_count,
  byQueryLang: summary.breakdown_by_query_lang,
  byRankBucket: summary.breakdown_by_rank_bucket,
  outPath
}, null, 2));
