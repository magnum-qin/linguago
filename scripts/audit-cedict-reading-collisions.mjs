import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const [inputArg, sandboxArg, reportArg] = process.argv.slice(2);
if (!inputArg || !sandboxArg || !reportArg) throw new Error('Usage: raw.gz NEW-sandbox report.json');
const input = path.resolve(inputArg), sandbox = path.resolve(sandboxArg), report = path.resolve(reportArg);
if (fs.existsSync(sandbox)) throw new Error('Sandbox must not exist; never reuse a production database');
if (fs.existsSync(report)) throw new Error('Report already exists');
const bytes = fs.readFileSync(input);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const oldSlots = new Map(), newSlots = new Map(), forms = new Map();
let lines = 0;
for (const line of zlib.gunzipSync(bytes).toString('utf8').split(/\r?\n/u)) {
  if (!line || line.startsWith('#')) continue;
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/u);
  if (!m) throw new Error(`Unparsed non-comment line: ${line.slice(0, 100)}`);
  const [traditional, simplified, reading] = m.slice(1, 4);
  const definitions = m[4].split('/').map(x => x.replace(/\s+/gu, ' ').trim()).filter(Boolean);
  const oldKey = `${traditional}|${simplified}`;
  const newKey = `cedict-v2:${JSON.stringify([traditional, simplified, reading.trim().replace(/\s+/gu, ' ')])}`;
  if (!forms.has(oldKey)) forms.set(oldKey, new Set());
  forms.get(oldKey).add(reading);
  definitions.forEach((gloss, i) => {
    const row = { traditional, simplified, reading, gloss, order: i + 1 };
    if (!oldSlots.has(`${oldKey}:${i + 1}`)) oldSlots.set(`${oldKey}:${i + 1}`, row);
    if (!newSlots.has(`${newKey}:${i + 1}`)) newSlots.set(`${newKey}:${i + 1}`, row);
  });
  lines++;
}
fs.mkdirSync(path.join(sandbox, 'data/raw'), { recursive: true });
fs.copyFileSync(input, path.join(sandbox, 'data/raw/CC-CEDICT.txt.gz'));
const dbPath = path.join(sandbox, 'staging.db');
let db = new Database(dbPath);
db.exec(fs.readFileSync(path.join(root, 'data/schema/dictionary-v2.sql'), 'utf8'));
db.pragma('journal_mode = WAL');
db.close();
const importer = path.join(root, 'scripts/import-dictionary-sources-v2.mjs');
const run = spawnSync(process.execPath, [importer, '--db', dbPath, '--sources', 'cedict'], {
  cwd: sandbox, encoding: 'utf8', timeout: 900000, maxBuffer: 2 * 1024 * 1024
});
assert.equal(run.error, undefined);
assert.equal(run.status, 0, run.stderr);
db = new Database(dbPath, { readonly: true });
const rows = db.prepare('SELECT source_sense_key, gloss, raw_json FROM source_senses').all();
assert.equal(rows.length, newSlots.size);
for (const row of rows) {
  const expected = newSlots.get(row.source_sense_key);
  assert(expected, 'Unexpected source identity');
  assert.equal(row.gloss, expected.gloss);
  assert.equal(JSON.parse(row.raw_json).pinyin, expected.reading);
}
const quickCheck = db.pragma('quick_check', { simple: true });
assert.equal(quickCheck, 'ok');
db.close();
const affected = [...forms].filter(([, readings]) => readings.size > 1);
const lost = [...newSlots.values()].filter(row => {
  const retained = oldSlots.get(`${row.traditional}|${row.simplified}:${row.order}`);
  return retained.reading !== row.reading || retained.gloss !== row.gloss;
});
const result = {
  scope: 'current_snapshot_isolated_import_comparison_not_historical_damage_count',
  raw_sha256: hash(bytes), importer_sha256: hash(fs.readFileSync(importer)),
  input, sandbox, source_lines: lines, homograph_forms: affected.length,
  old_identity_senses: oldSlots.size, new_identity_senses: newSlots.size,
  additional_preserved_senses: newSlots.size - oldSlots.size,
  new_records_not_retained_by_old_slot: lost.length,
  actual_new_import_verified: true, quick_check: quickCheck,
  automatic_publication: false,
  affected_forms: affected.map(([form, readings]) => ({ form, readings: [...readings] })),
  affected_senses: lost
};
fs.mkdirSync(path.dirname(report), { recursive: true });
fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n');
const { affected_forms, affected_senses, ...summary } = result;
console.log(JSON.stringify(summary, null, 2));
