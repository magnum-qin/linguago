#!/usr/bin/env node

import fs from 'node:fs';

const report = JSON.parse(fs.readFileSync('logs/audit-japanese-readings-report.json', 'utf8'));

console.log('--- KANJI IN READING SAMPLES ---');
for (const item of report.samples.contains_kanji_in_reading) {
  console.log(`id:${item.id} headword:"${item.headword}" term:"${item.term}" reading:"${item.reading}"`);
}

console.log('\n--- LATIN IN READING SAMPLES ---');
for (const item of report.samples.contains_latin_in_reading) {
  console.log(`id:${item.id} headword:"${item.headword}" term:"${item.term}" reading:"${item.reading}"`);
}

console.log('\n--- PUNCTUATION/WHITESPACE SAMPLES ---');
for (const item of report.samples.contains_whitespace_or_punctuation.slice(0, 15)) {
  console.log(`id:${item.id} headword:"${item.headword}" term:"${item.term}" reading:"${item.reading}"`);
}
