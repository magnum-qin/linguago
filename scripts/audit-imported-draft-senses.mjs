#!/usr/bin/env node

import Database from 'better-sqlite3';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const SOURCE = 'unsloth:source-gap-controlled-consensus';
const KANA_RE = /^[\u3040-\u309F\u30A0-\u30FF\s・ー]+$/u;
const PINYIN_RE = /^[a-zA-Zāáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜü\s,'·]+$/u;

const dbPath = path.resolve(process.argv[2] || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db');
console.log(`[Audit] Auditing candidate DB: ${dbPath}`);

const db = new Database(dbPath, { readonly: true });

const auditReport = {
  ok: true,
  senses_found: 0,
  entries_found: 0,
  localizations_checked: 0,
  source_links_checked: 0,
  verifications_checked: 0,
  violations: []
};

function recordViolation(type, id, details) {
  auditReport.ok = false;
  auditReport.violations.push({ type, id, details });
}

// 1. Fetch all imported senses
const importedSenses = db.prepare(`
  SELECT ps.id, ps.product_entry_id, ps.sense_order, ps.part_of_speech, ps.gloss_key, ps.status,
         pe.headword, pe.primary_lang
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE ps.id IN (
    SELECT DISTINCT product_sense_id
    FROM product_localizations
    WHERE source = ?
  )
  ORDER BY ps.id
`).all(SOURCE);

auditReport.senses_found = importedSenses.length;
const entryIds = new Set(importedSenses.map(s => s.product_entry_id));
auditReport.entries_found = entryIds.size;

console.log(`[Audit] Found ${importedSenses.length} senses across ${entryIds.size} entries.`);

// 2. Validate each sense
const getLocs = db.prepare('SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system, definition FROM product_localizations WHERE product_sense_id = ?');
const getLinks = db.prepare('SELECT source_entry_id, source_sense_id, source_lang, source_word FROM product_sense_source_links WHERE product_sense_id = ?');
const getVerif = db.prepare('SELECT verification_level, review_model FROM product_sense_verification WHERE product_sense_id = ?');

const samples = [];

for (const sense of importedSenses) {
  // Check sense status
  if (sense.status !== 'draft_single_source') {
    recordViolation('unexpected_sense_status', sense.id, { expected: 'draft_single_source', actual: sense.status });
  }

  // Check localizations
  const locs = getLocs.all(sense.id);
  auditReport.localizations_checked += locs.length;

  if (locs.length !== 4) {
    recordViolation('incomplete_languages', sense.id, { count: locs.length, headword: sense.headword });
  }

  const locMap = new Map(locs.map(l => [l.lang, l]));
  for (const lang of LANGS) {
    const loc = locMap.get(lang);
    if (!loc) {
      recordViolation('missing_language', sense.id, { missing_lang: lang, headword: sense.headword });
      continue;
    }

    // Check whitespace/newline artifacts
    if (/[\r\n\t]/u.test(loc.term) || /[\r\n\t]/u.test(loc.definition)) {
      recordViolation('newline_artifact', sense.id, { lang, term: loc.term, headword: sense.headword });
    }

    // Check HTML/entities
    if (/<[^>]+>|&(?:amp|lt|gt|quot|#\d+);/u.test(loc.definition) || /<[^>]+>/u.test(loc.term)) {
      recordViolation('html_artifact', sense.id, { lang, term: loc.term, headword: sense.headword });
    }

    // Check Mojibake
    if (/[\uFFFD]|Ã[\x80-\xBF]|Â[\x80-\xBF]/u.test(loc.term) || /[\uFFFD]/u.test(loc.definition)) {
      recordViolation('mojibake_artifact', sense.id, { lang, term: loc.term, headword: sense.headword });
    }

    // Language-specific checks
    if (lang === 'ja') {
      if (!loc.reading || !KANA_RE.test(loc.reading.trim())) {
        recordViolation('invalid_ja_reading', sense.id, { reading: loc.reading, headword: sense.headword });
      }
    }

    if (lang === 'zh') {
      if (!loc.reading || !PINYIN_RE.test(loc.reading.trim())) {
        recordViolation('invalid_zh_reading', sense.id, { reading: loc.reading, headword: sense.headword });
      }
    }

    if (lang === 'pt-BR') {
      if (!loc.pronunciation || !loc.pronunciation.includes('/')) {
        recordViolation('missing_pt_ipa', sense.id, { pronunciation: loc.pronunciation, headword: sense.headword });
      }
    }

    if (lang === 'en') {
      if (!loc.pronunciation || !loc.pronunciation.includes('/')) {
        recordViolation('missing_en_phonetic', sense.id, { pronunciation: loc.pronunciation, headword: sense.headword });
      }
    }
  }

  // Check source links
  const links = getLinks.all(sense.id);
  auditReport.source_links_checked += links.length;
  if (links.length === 0) {
    recordViolation('missing_source_link', sense.id, { headword: sense.headword });
  }

  // Check verification
  const verif = getVerif.get(sense.id);
  if (verif) auditReport.verifications_checked++;

  if (samples.length < 5) {
    samples.push({
      headword: sense.headword,
      primary_lang: sense.primary_lang,
      pos: sense.part_of_speech,
      gloss_key: sense.gloss_key,
      zh_reading: locMap.get('zh')?.reading,
      ja_reading: locMap.get('ja')?.reading,
      en_pron: locMap.get('en')?.pronunciation,
      pt_pron: locMap.get('pt-BR')?.pronunciation,
      definitions: Object.fromEntries([...locMap.entries()].map(([k, v]) => [k, v.definition]))
    });
  }
}

db.close();

console.log('\n=== AUDIT VERIFICATION RESULTS ===');
console.log(`Status: ${auditReport.ok ? 'PASSED (0 VIOLATIONS)' : 'FAILED'}`);
console.log(`Total Senses: ${auditReport.senses_found}`);
console.log(`Total Entries: ${auditReport.entries_found}`);
console.log(`Total Localizations: ${auditReport.localizations_checked}`);
console.log(`Total Source Links: ${auditReport.source_links_checked}`);
console.log(`Total Verifications: ${auditReport.verifications_checked}`);
console.log(`Violations Count: ${auditReport.violations.length}`);

if (auditReport.violations.length > 0) {
  console.log('Sample Violations:', JSON.stringify(auditReport.violations.slice(0, 5), null, 2));
}

console.log('\n=== SAMPLE IMPORTED ENTRIES ===');
console.log(JSON.stringify(samples, null, 2));

if (!auditReport.ok) {
  process.exit(1);
}
