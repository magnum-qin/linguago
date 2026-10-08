#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
const aliasPath = path.resolve(args.aliases || 'D:/linguago-runner/config/dictionary-overrides/product-entry-form-aliases.json');
const outReportPath = path.resolve(args.out || 'D:/linguago-runner/logs/merge-traditional-split-entries-report.json');
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);

const db = new Database(dbPath, { readonly: !apply });
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });

console.log(`Auditing traditional/simplified split pairs (apply=${apply})...`);

const zhEntries = db.prepare(`
  SELECT id, headword, normalized_key, primary_lang, frequency_rank, status, source_count, lang_count
  FROM product_entries
  WHERE primary_lang = 'zh'
  ORDER BY id
`).all();

const entryByHeadword = new Map();
for (const entry of zhEntries) {
  entryByHeadword.set(entry.headword, entry);
}

const pairs = [];
for (const source of zhEntries) {
  const simplified = converter(source.headword);
  if (simplified !== source.headword && entryByHeadword.has(simplified)) {
    const target = entryByHeadword.get(simplified);
    if (target.id !== source.id) {
      pairs.push({ source, target });
    }
  }
}

console.log(`Found ${pairs.length} traditional/simplified split pairs.`);

const getSenses = db.prepare(`SELECT id, sense_order, status, gloss_key FROM product_senses WHERE product_entry_id = ? ORDER BY sense_order, id`);
const moveSenses = db.prepare(`UPDATE product_senses SET product_entry_id = ? WHERE product_entry_id = ?`);
const moveFusionReviews = db.prepare(`UPDATE product_fusion_reviews SET product_entry_id = ? WHERE product_entry_id = ?`);
const moveFusionPlans = db.prepare(`UPDATE product_fusion_split_plans SET product_entry_id = ? WHERE product_entry_id = ?`);
const deleteEntry = db.prepare(`DELETE FROM product_entries WHERE id = ?`);
const setTempSenseOrder = db.prepare(`UPDATE product_senses SET sense_order = -id WHERE product_entry_id = ?`);
const setSenseOrder = db.prepare(`UPDATE product_senses SET sense_order = ? WHERE id = ?`);
const updateEntryStatus = db.prepare(`UPDATE product_entries SET status = ?, source_count = ?, lang_count = ? WHERE id = ?`);

const getDistinctLangs = db.prepare(`
  SELECT COUNT(DISTINCT pl.lang) as count
  FROM product_senses ps
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.product_entry_id = ?
`);

const stats = {
  apply,
  pairs_found: pairs.length,
  pairs_merged: 0,
  senses_moved: 0,
  entries_deleted: 0,
  aliases_created: 0,
  sample_pairs: []
};

const newAliases = [];

if (apply) {
  const transaction = db.transaction(() => {
    for (const { source, target } of pairs) {
      const sourceSenses = getSenses.all(source.id);
      const targetSenses = getSenses.all(target.id);
      
      // Set negative temporary sense_order on both source and target to avoid UNIQUE(product_entry_id, sense_order) collision
      setTempSenseOrder.run(source.id);
      setTempSenseOrder.run(target.id);

      // Move senses from source to target
      if (sourceSenses.length > 0) {
        moveSenses.run(target.id, source.id);
        stats.senses_moved += sourceSenses.length;
      }

      // Move reviews & plans if any
      moveFusionReviews.run(target.id, source.id);
      moveFusionPlans.run(target.id, source.id);

      // Delete traditional entry
      deleteEntry.run(source.id);
      stats.entries_deleted++;

      // Renumber senses under target
      setTempSenseOrder.run(target.id);
      const allTargetSenses = db.prepare(`SELECT id FROM product_senses WHERE product_entry_id = ? ORDER BY id`).all(target.id);
      allTargetSenses.forEach((s, idx) => {
        setSenseOrder.run(idx + 1, s.id);
      });

      // Update target entry metadata
      const distinctLangs = getDistinctLangs.get(target.id)?.count || 4;
      updateEntryStatus.run(
        target.status || 'accepted',
        Math.max(Number(target.source_count) || 1, Number(source.source_count) || 1),
        distinctLangs,
        target.id
      );

      // Create traditional alias
      newAliases.push({
        entry_id: target.id,
        headword: target.headword,
        lang: 'zh',
        form: source.headword,
        form_type: 'traditional_alias',
        source: 'deterministic:mainland-simplified-alias',
        confidence: 1,
        source_entry_id: source.id,
        note: `Traditional query alias merged from entry ${source.id} (${source.headword}) into canonical ${target.headword}.`
      });
      stats.aliases_created++;
      stats.pairs_merged++;

      if (stats.sample_pairs.length < 25) {
        stats.sample_pairs.push({
          traditional_id: source.id,
          traditional_headword: source.headword,
          traditional_senses_count: sourceSenses.length,
          simplified_id: target.id,
          simplified_headword: target.headword,
          simplified_senses_before: targetSenses.length,
          simplified_senses_after: allTargetSenses.length
        });
      }
    }
  });

  transaction();

  // Save aliases to config file
  if (fs.existsSync(aliasPath)) {
    const aliasData = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
    const existingKeys = new Set(aliasData.aliases.map(a => `${a.entry_id}:${a.form}:${a.form_type}`));
    let addedCount = 0;
    for (const alias of newAliases) {
      const key = `${alias.entry_id}:${alias.form}:${alias.form_type}`;
      if (!existingKeys.has(key)) {
        aliasData.aliases.push(alias);
        existingKeys.add(key);
        addedCount++;
      }
    }
    fs.writeFileSync(aliasPath, JSON.stringify(aliasData, null, 2), 'utf8');
    console.log(`Appended ${addedCount} new traditional aliases to ${aliasPath}`);
  }
} else {
  // Dry run
  for (const { source, target } of pairs) {
    const sourceSenses = getSenses.all(source.id);
    const targetSenses = getSenses.all(target.id);
    stats.senses_moved += sourceSenses.length;
    stats.pairs_merged++;
    if (stats.sample_pairs.length < 25) {
      stats.sample_pairs.push({
        traditional_id: source.id,
        traditional_headword: source.headword,
        traditional_senses_count: sourceSenses.length,
        simplified_id: target.id,
        simplified_headword: target.headword,
        simplified_senses_before: targetSenses.length
      });
    }
  }
}

fs.mkdirSync(path.dirname(outReportPath), { recursive: true });
fs.writeFileSync(outReportPath, JSON.stringify(stats, null, 2), 'utf8');

db.close();

console.log('Traditional split entries merge complete:');
console.log(JSON.stringify({
  pairs_found: stats.pairs_found,
  pairs_merged: stats.pairs_merged,
  senses_moved: stats.senses_moved,
  entries_deleted: stats.entries_deleted,
  aliases_created: stats.aliases_created,
  apply,
  outReportPath
}, null, 2));

function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}
