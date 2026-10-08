#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function normalizeJapaneseKanaReading(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s・.]+/gu, '')
    .replace(/[ァ-ヶ]/gu, (character) => String.fromCodePoint(character.codePointAt(0) - 0x60));
}

function isValidJapaneseKanaReading(value) {
  const reading = normalizeJapaneseKanaReading(value);
  return Boolean(reading) && !reading.includes('\uFFFD') && /^[\p{Script=Hiragana}ー]+$/u.test(reading);
}

const dbPath = process.argv[2] || 'D:/linguago-runner/data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const outPath = process.argv[3] || 'D:/linguago-runner/logs/audit-japanese-readings-report.json';

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('Auditing Japanese readings across 5.9w senses...');

// Query all Japanese localizations in publishable senses
const jaLocalizations = db.prepare(`
  SELECT pl.id, pl.product_sense_id, pl.term, pl.reading, pl.reading_system,
         pl.pronunciation, pl.pronunciation_system, pl.definition, pl.source,
         ps.product_entry_id, pe.headword, pe.frequency_rank, pe.primary_lang
  FROM product_localizations pl
  JOIN product_senses ps ON ps.id = pl.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  WHERE pl.lang = 'ja'
    AND ps.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks pb WHERE pb.product_sense_id = ps.id
    )
`).all();

const issues = {
  missing_reading: [],
  mojibake_replacement_char: [],
  invalid_kana_characters: [],
  contains_kanji_in_reading: [],
  contains_latin_in_reading: [],
  contains_whitespace_or_punctuation: [],
  katakana_not_normalized: [],
  reading_system_missing: [],
  kana_term_reading_mismatch: [],
  empty_term: [],
  empty_definition: []
};

for (const row of jaLocalizations) {
  const { id, product_sense_id, term, reading, reading_system, definition, headword, frequency_rank } = row;

  if (!term || !term.trim()) {
    issues.empty_term.push({ id, sense_id: product_sense_id, headword, rank: frequency_rank });
    continue;
  }

  if (!definition || !definition.trim()) {
    issues.empty_definition.push({ id, sense_id: product_sense_id, headword, rank: frequency_rank });
  }

  if (!reading || !reading.trim()) {
    issues.missing_reading.push({ id, sense_id: product_sense_id, headword, term, rank: frequency_rank });
    continue;
  }

  const rawReading = String(reading);

  // Check mojibake
  if (rawReading.includes('\uFFFD') || rawReading.includes('\u0000')) {
    issues.mojibake_replacement_char.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading, rank: frequency_rank
    });
  }

  // Check Kanji in reading
  if (/[\p{Script=Han}]/u.test(rawReading)) {
    issues.contains_kanji_in_reading.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading, rank: frequency_rank
    });
  }

  // Check Latin in reading
  if (/[a-zA-Z]/u.test(rawReading)) {
    issues.contains_latin_in_reading.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading, rank: frequency_rank
    });
  }

  // Check whitespace / punctuation
  if (/[\s・.,/\\_—–-]/u.test(rawReading)) {
    issues.contains_whitespace_or_punctuation.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading, rank: frequency_rank
    });
  }

  // Check reading system
  if (!reading_system) {
    issues.reading_system_missing.push({ id, sense_id: product_sense_id, headword, term, reading: rawReading });
  }

  // Check valid Japanese kana reading
  if (!isValidJapaneseKanaReading(rawReading)) {
    issues.invalid_kana_characters.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading, rank: frequency_rank
    });
  }

  // Check if Katakana exists in reading when reading_system is hiragana
  if (/[ァ-ヶ]/u.test(rawReading)) {
    issues.katakana_not_normalized.push({
      id, sense_id: product_sense_id, headword, term, reading: rawReading,
      normalized: normalizeJapaneseKanaReading(rawReading),
      system: reading_system
    });
  }

  // If term is purely kana, does reading match normalized term?
  const cleanTerm = term.trim();
  if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u.test(cleanTerm)) {
    const normTerm = normalizeJapaneseKanaReading(cleanTerm);
    const normReading = normalizeJapaneseKanaReading(rawReading);
    if (normTerm !== normReading) {
      issues.kana_term_reading_mismatch.push({
        id, sense_id: product_sense_id, headword, term: cleanTerm, reading: rawReading,
        normTerm, normReading, rank: frequency_rank
      });
    }
  }
}

const summary = {
  timestamp: new Date().toISOString(),
  database: dbPath,
  total_ja_localizations_audited: jaLocalizations.length,
  issues_summary: {
    missing_reading: issues.missing_reading.length,
    mojibake_replacement_char: issues.mojibake_replacement_char.length,
    invalid_kana_characters: issues.invalid_kana_characters.length,
    contains_kanji_in_reading: issues.contains_kanji_in_reading.length,
    contains_latin_in_reading: issues.contains_latin_in_reading.length,
    contains_whitespace_or_punctuation: issues.contains_whitespace_or_punctuation.length,
    katakana_not_normalized: issues.katakana_not_normalized.length,
    reading_system_missing: issues.reading_system_missing.length,
    kana_term_reading_mismatch: issues.kana_term_reading_mismatch.length,
    empty_term: issues.empty_term.length,
    empty_definition: issues.empty_definition.length
  },
  samples: {
    missing_reading: issues.missing_reading.slice(0, 30),
    mojibake_replacement_char: issues.mojibake_replacement_char.slice(0, 30),
    invalid_kana_characters: issues.invalid_kana_characters.slice(0, 30),
    contains_kanji_in_reading: issues.contains_kanji_in_reading.slice(0, 30),
    contains_latin_in_reading: issues.contains_latin_in_reading.slice(0, 30),
    contains_whitespace_or_punctuation: issues.contains_whitespace_or_punctuation.slice(0, 30),
    katakana_not_normalized: issues.katakana_not_normalized.slice(0, 30),
    kana_term_reading_mismatch: issues.kana_term_reading_mismatch.slice(0, 30)
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

console.log('Japanese reading audit complete:');
console.log(JSON.stringify({
  total_audited: summary.total_ja_localizations_audited,
  issues: summary.issues_summary,
  outPath
}, null, 2));
