import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-target-repair-'));
const reportPath = path.join(tempDir, 'report.json');
const repairsPath = path.join(tempDir, 'repairs.json');
const outPath = path.join(tempDir, 'out.json');

fs.writeFileSync(reportPath, JSON.stringify({ selected: [{ candidate_key: '1:2', generation_hints: { en: { terms: ['leave'] } } }] }));
fs.writeFileSync(repairsPath, JSON.stringify({ validations: [{
  candidate_key: '1:2',
  decision: 'accept',
  target_lang: 'pt-BR',
  existing_terms: ['ir embora'],
  accepted_terms: [{ term: 'partir', families: ['dicionario-aberto', 'wiktionary'], region: 'BR' }]
}] }));

const result = spawnSync(process.execPath, [
  path.resolve('scripts/apply-dictionary-v2-product-target-term-repair-report.mjs'),
  '--report', reportPath,
  '--repairs', repairsPath,
  '--out', outPath
], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr || result.stdout);

const output = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const row = output.selected[0];
assert.deepEqual(row.generation_hints.en.terms, ['leave']);
assert.deepEqual(row.generation_hints['pt-BR'].terms, ['partir']);
assert.deepEqual(row.generation_hints['pt-BR'].evidence_families, ['dicionario-aberto', 'wiktionary']);
assert.equal(row.generation_hints['pt-BR'].provenance, 'dictionary_validated_target_repair');

console.log('target-term repair report tests passed');
