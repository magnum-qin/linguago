#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const dbPath = process.argv[2] || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const outPath = process.argv[3] || 'D:/linguago-runner/logs/audit-opencc-simplified-chinese-report.json';

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Convert Traditional (Taiwan/HK) to Simplified (Mainland China)
const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });

console.log('Auditing Chinese Simplified/Traditional forms across 5.9w senses...');

// 1. Audit Chinese headwords in product_entries
const zhEntries = db.prepare(`
  SELECT id, headword, frequency_rank, source_count
  FROM product_entries
  WHERE primary_lang = 'zh'
`).all();

const entryMismatches = [];
for (const entry of zhEntries) {
  const simplified = converter(entry.headword);
  if (simplified !== entry.headword) {
    entryMismatches.push({
      entry_id: entry.id,
      headword: entry.headword,
      simplified,
      frequency_rank: entry.frequency_rank,
      diff_chars: findDiffChars(entry.headword, simplified)
    });
  }
}

// 2. Audit Chinese localizations in publishable product_senses
const zhLocalizations = db.prepare(`
  SELECT pl.id, pl.product_sense_id, pl.term, pl.reading, pl.definition,
         ps.product_entry_id, pe.frequency_rank, pe.headword
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pl.lang = 'zh'
    AND ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
`).all();

const termMismatches = [];
const defMismatches = [];
const charFreqMap = {};

for (const loc of zhLocalizations) {
  // Check term
  if (loc.term) {
    const simplifiedTerm = converter(loc.term);
    if (simplifiedTerm !== loc.term) {
      const diffs = findDiffChars(loc.term, simplifiedTerm);
      for (const [trad, simp] of Object.entries(diffs)) {
        charFreqMap[trad] = (charFreqMap[trad] || 0) + 1;
      }
      termMismatches.push({
        localization_id: loc.id,
        sense_id: loc.product_sense_id,
        entry_id: loc.product_entry_id,
        headword: loc.headword,
        rank: loc.frequency_rank,
        original_term: loc.term,
        simplified_term: simplifiedTerm,
        diff_chars: diffs
      });
    }
  }

  // Check definition
  if (loc.definition) {
    const simplifiedDef = converter(loc.definition);
    if (simplifiedDef !== loc.definition) {
      defMismatches.push({
        localization_id: loc.id,
        sense_id: loc.product_sense_id,
        entry_id: loc.product_entry_id,
        headword: loc.headword,
        original_def: loc.definition.length > 80 ? loc.definition.slice(0, 80) + '...' : loc.definition,
        simplified_def: simplifiedDef.length > 80 ? simplifiedDef.slice(0, 80) + '...' : simplifiedDef,
        diff_chars: findDiffChars(loc.definition, simplifiedDef)
      });
    }
  }
}

// 3. Audit Examples
const zhExamples = db.prepare(`
  SELECT id, source_text
  FROM product_examples
  WHERE source_lang = 'zh'
`).all();

const exampleMismatches = [];
for (const ex of zhExamples) {
  if (ex.source_text) {
    const simplified = converter(ex.source_text);
    if (simplified !== ex.source_text) {
      exampleMismatches.push({
        id: ex.id,
        original: ex.source_text,
        simplified
      });
    }
  }
}

const zhExampleLocs = db.prepare(`
  SELECT id, text, reading
  FROM product_example_localizations
  WHERE lang = 'zh'
`).all();

const exampleLocMismatches = [];
for (const exLoc of zhExampleLocs) {
  if (exLoc.text) {
    const simplified = converter(exLoc.text);
    if (simplified !== exLoc.text) {
      exampleLocMismatches.push({
        id: exLoc.id,
        original: exLoc.text,
        simplified
      });
    }
  }
}

function findDiffChars(original, simplified) {
  const diffs = {};
  const origChars = [...original];
  const simpChars = [...simplified];
  const len = Math.min(origChars.length, simpChars.length);
  for (let i = 0; i < len; i++) {
    if (origChars[i] !== simpChars[i]) {
      diffs[origChars[i]] = simpChars[i];
    }
  }
  return diffs;
}

// Sort most common traditional characters found
const topTraditionalChars = Object.entries(charFreqMap)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50)
  .map(([char, count]) => ({ char, simplified: converter(char), count }));

const summary = {
  timestamp: new Date().toISOString(),
  database: dbPath,
  total_zh_entries_audited: zhEntries.length,
  zh_entry_headword_mismatches: entryMismatches.length,
  total_zh_publishable_localizations_audited: zhLocalizations.length,
  zh_term_traditional_mismatches: termMismatches.length,
  zh_definition_traditional_mismatches: defMismatches.length,
  total_zh_examples_audited: zhExamples.length,
  zh_example_mismatches: exampleMismatches.length,
  total_zh_example_localizations_audited: zhExampleLocs.length,
  zh_example_loc_mismatches: exampleLocMismatches.length,
  top_traditional_characters: topTraditionalChars,
  sample_entry_mismatches: entryMismatches.slice(0, 30),
  sample_term_mismatches: termMismatches.slice(0, 30),
  sample_def_mismatches: defMismatches.slice(0, 30)
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

console.log('OpenCC Chinese audit complete:');
console.log(JSON.stringify({
  total_zh_entries: summary.total_zh_entries_audited,
  zh_entry_mismatches: summary.zh_entry_headword_mismatches,
  total_zh_localizations: summary.total_zh_publishable_localizations_audited,
  zh_term_mismatches: summary.zh_term_traditional_mismatches,
  zh_def_mismatches: summary.zh_definition_traditional_mismatches,
  zh_example_mismatches: summary.zh_example_mismatches,
  zh_example_loc_mismatches: summary.zh_example_loc_mismatches,
  top_traditional_chars: topTraditionalChars.slice(0, 10),
  outPath
}, null, 2));
