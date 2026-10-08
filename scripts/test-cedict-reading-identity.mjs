import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-cedict-reading-'));
const dbPath = path.join(temp, 'staging.db');
const run = () => spawnSync(process.execPath, [
  path.join(root, 'scripts/import-dictionary-sources-v2.mjs'), '--db', dbPath, '--sources', 'cedict'
], { cwd: temp, encoding: 'utf8', timeout: 15000 });
try {
  fs.mkdirSync(path.join(temp, 'data/raw'), { recursive: true });
  const word = '\u843d\u7a7a';
  const lines = [
    `${word} ${word} [la4 kong4] /to omit/to miss a chance/`,
    `${word} ${word} [lao4 kong1] /to be fruitless/`,
    `${word} ${word} [luo4 kong1] /to fail/to fall through/`
  ];
  fs.writeFileSync(path.join(temp, 'data/raw/CC-CEDICT.txt.gz'), zlib.gzipSync(lines.join('\n')));
  let db = new Database(dbPath);
  db.exec(fs.readFileSync(path.join(root, 'data/schema/dictionary-v2.sql'), 'utf8'));
  db.close();
  for (let i = 0; i < 2; i++) {
    const result = run();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    db = new Database(dbPath);
    assert.equal(db.prepare('SELECT count(*) n FROM source_entries').get().n, 3);
    const senses = db.prepare('SELECT gloss, raw_json FROM source_senses ORDER BY id').all();
    assert.equal(senses.length, 5);
    assert.equal(JSON.parse(senses.find(s => s.gloss === 'to omit').raw_json).pinyin, 'la4 kong4');
    assert.equal(JSON.parse(senses.find(s => s.gloss === 'to fall through').raw_json).pinyin, 'luo4 kong1');
    db.close();
  }
  db = new Database(dbPath);
  db.prepare("UPDATE source_entries SET source_entry_key='legacy|word' WHERE id=1").run();
  db.close();
  const rejected = run();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Legacy CC-CEDICT identities omit readings/);
  db = new Database(dbPath);
  assert.equal(db.prepare('SELECT count(*) n FROM source_senses').get().n, 5);
  db.close();
  console.log('CC-CEDICT homograph reading identities, idempotency and legacy guard passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
