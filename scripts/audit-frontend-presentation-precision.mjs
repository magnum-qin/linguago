#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const outPath = process.argv[3] || 'D:/linguago-runner/logs/audit-frontend-presentation-precision-report.json';

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('Auditing frontend presentation precision across all 5.9w publishable senses...');

// 1. Check all publishable senses and their localization count
const senseLanguageCounts = db.prepare(`
  SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.confidence,
         COUNT(pl.id) AS loc_count,
         group_concat(pl.lang) AS langs
  FROM product_senses ps
  LEFT JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
  GROUP BY ps.id
`).all();

const incompleteSenses = [];
const langCountDistribution = {};

for (const s of senseLanguageCounts) {
  langCountDistribution[s.loc_count] = (langCountDistribution[s.loc_count] || 0) + 1;
  if (s.loc_count !== 4) {
    incompleteSenses.push({
      sense_id: s.id,
      entry_id: s.product_entry_id,
      loc_count: s.loc_count,
      langs: s.langs
    });
  }
}

// 2. Check for empty fields, HTML tags, markdown, and raw artifacts in localizations
const allLocalizations = db.prepare(`
  SELECT pl.id, pl.product_sense_id, pl.lang, pl.term, pl.reading, pl.definition,
         pl.confidence, pl.needs_review, pl.source,
         ps.product_entry_id, pe.headword, pe.frequency_rank
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
`).all();

const emptyTerms = [];
const emptyDefinitions = [];
const htmlArtifacts = [];
const jsonArtifacts = [];
const suspiciousSymbols = [];
const needsReviewLocalizations = [];
const langCounts = { en: 0, zh: 0, ja: 0, 'pt-BR': 0 };

for (const loc of allLocalizations) {
  langCounts[loc.lang] = (langCounts[loc.lang] || 0) + 1;

  if (loc.needs_review === 1) {
    needsReviewLocalizations.push({
      id: loc.id,
      sense_id: loc.product_sense_id,
      lang: loc.lang,
      headword: loc.headword,
      term: loc.term
    });
  }

  // Check term
  if (!loc.term || !loc.term.trim()) {
    emptyTerms.push({ id: loc.id, sense_id: loc.product_sense_id, lang: loc.lang, headword: loc.headword });
  }

  // Check definition
  if (!loc.definition || !loc.definition.trim()) {
    emptyDefinitions.push({ id: loc.id, sense_id: loc.product_sense_id, lang: loc.lang, headword: loc.headword });
  } else {
    const def = loc.definition;
    // Check HTML
    if (/<[a-z/][\s\S]*>/i.test(def)) {
      htmlArtifacts.push({ id: loc.id, sense_id: loc.product_sense_id, lang: loc.lang, headword: loc.headword, def });
    }
    // Check JSON or code residue
    if (/^\s*[\{\[][\s\S]*[\}\]]\s*$/.test(def) || def.includes('"gloss":') || def.includes('"definition":')) {
      jsonArtifacts.push({ id: loc.id, sense_id: loc.product_sense_id, lang: loc.lang, headword: loc.headword, def });
    }
    // Check unescaped entities or suspicious escape sequences
    if (/&(?:amp|quot|lt|gt|#39);/.test(def) || def.includes('\\n') || def.includes('\\"')) {
      suspiciousSymbols.push({ id: loc.id, sense_id: loc.product_sense_id, lang: loc.lang, headword: loc.headword, def });
    }
  }
}

// 3. Check duplicate definitions across senses of the same entry
const duplicateSenseDefinitions = db.prepare(`
  SELECT ps.product_entry_id, pl.lang, pl.definition, COUNT(*) as cnt,
         group_concat(ps.id) as sense_ids
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  WHERE ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
    AND trim(pl.definition) <> ''
  GROUP BY ps.product_entry_id, pl.lang, lower(trim(pl.definition))
  HAVING COUNT(*) > 1
`).all();

const summary = {
  timestamp: new Date().toISOString(),
  database: dbPath,
  total_publishable_senses: senseLanguageCounts.length,
  total_localizations_audited: allLocalizations.length,
  localization_counts_by_lang: langCounts,
  sense_language_distribution: langCountDistribution,
  incomplete_senses_count: incompleteSenses.length,
  empty_terms_count: emptyTerms.length,
  empty_definitions_count: emptyDefinitions.length,
  html_artifacts_count: htmlArtifacts.length,
  json_artifacts_count: jsonArtifacts.length,
  suspicious_symbols_count: suspiciousSymbols.length,
  needs_review_localizations_count: needsReviewLocalizations.length,
  duplicate_sense_definitions_groups: duplicateSenseDefinitions.length,
  samples: {
    incomplete_senses: incompleteSenses.slice(0, 10),
    empty_terms: emptyTerms.slice(0, 10),
    empty_definitions: emptyDefinitions.slice(0, 10),
    html_artifacts: htmlArtifacts.slice(0, 10),
    json_artifacts: jsonArtifacts.slice(0, 10),
    suspicious_symbols: suspiciousSymbols.slice(0, 10),
    duplicate_definitions: duplicateSenseDefinitions.slice(0, 15)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

console.log('Frontend presentation precision audit complete:');
console.log(JSON.stringify({
  publishable_senses: summary.total_publishable_senses,
  total_localizations: summary.total_localizations_audited,
  incomplete_senses: summary.incomplete_senses_count,
  empty_terms: summary.empty_terms_count,
  empty_defs: summary.empty_definitions_count,
  html_artifacts: summary.html_artifacts_count,
  json_artifacts: summary.json_artifacts_count,
  suspicious_symbols: summary.suspicious_symbols_count,
  needs_review_count: summary.needs_review_localizations_count,
  duplicate_defs: summary.duplicate_sense_definitions_groups,
  outPath
}, null, 2));
