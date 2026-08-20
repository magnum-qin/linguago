import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import Database from 'better-sqlite3';
import { build } from 'esbuild';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || path.join(os.tmpdir(), 'linguago-v122-d1-export', 'audit-import.db')
);
const expectedModel = String(args['expected-model'] || 'unsloth/gemma-4-31B-it-qat-GGUF');
const bundlePath = path.join(os.tmpdir(), `linguago-worker-dictionary-${process.pid}.mjs`);

assert.ok(fs.existsSync(dbPath), `D1 audit database not found: ${dbPath}`);

await build({
  entryPoints: [path.resolve('worker/dictionary.ts')],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  logLevel: 'silent'
});

const database = new Database(dbPath, { readonly: true, fileMustExist: true });
try {
  const fixture = selectFixture(database, args.word, args['source-lang']);
  const word = fixture.word;
  const { CloudflareD1V2Adapter } = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
  const adapter = new CloudflareD1V2Adapter();
  const response = await adapter.lookup({
    env: { DB: createD1Facade(database) },
    text: word,
    targetLang: 'en',
    sourceLang: fixture.source_lang
  });

  assert.ok(response, `Worker adapter did not find ${word}`);
  assert.equal(response.provider, 'dictionary');
  assert.equal(response.model, 'cloudflare-d1-v2');
  assert.ok(Array.isArray(response.senses) && response.senses.length > 0, 'response has no senses');

  const reviewed = response.senses.find((sense) => sense.verification_level === 'ai_reviewed');
  assert.ok(reviewed, 'response has no ai_reviewed sense');
  assert.equal(reviewed.review_model, expectedModel);
  assert.deepEqual(
    [...reviewed.evidence_families].sort(),
    ['gemma-independent-review', 'locked-local-dictionary-evidence', 'qwen-generation'].sort()
  );
  assert.ok(reviewed.examples.length > 0, 'ai_reviewed sense has no examples');
  for (const example of reviewed.examples) {
    assert.equal(example.source_lang, 'zh');
    assert.ok(example.sentence, 'example source sentence is empty');
    for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
      assert.ok(example.localizations?.[lang]?.text, `example missing ${lang}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    db: dbPath,
    word,
    verification_level: reviewed.verification_level,
    review_model: reviewed.review_model,
    evidence_families: reviewed.evidence_families,
    examples: reviewed.examples.length
  }, null, 2));
} finally {
  database.close();
  fs.rmSync(bundlePath, { force: true });
}

function selectFixture(database, requestedWord, requestedSourceLang) {
  const filters = ["s.verification_level = 'ai_reviewed'"];
  const params = [];
  if (requestedWord) {
    filters.push('e.word = ?');
    params.push(String(requestedWord));
  }
  if (requestedSourceLang) {
    filters.push('e.source_lang = ?');
    params.push(String(requestedSourceLang));
  }
  const fixture = database.prepare(`
    SELECT e.word, e.source_lang
    FROM v2_senses s
    JOIN v2_entries e ON e.id = s.entry_id
    WHERE ${filters.join(' AND ')}
    ORDER BY e.id, s.id
    LIMIT 1
  `).get(...params);
  assert.ok(fixture, 'D1 audit database has no matching ai_reviewed fixture');
  return fixture;
}

function createD1Facade(database) {
  return {
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              return database.prepare(sql).get(...params) ?? null;
            }
          };
        }
      };
    }
  };
}

function parseArgs(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    output[key] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return output;
}
