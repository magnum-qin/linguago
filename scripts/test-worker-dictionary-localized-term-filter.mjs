import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { build } from 'esbuild';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-localized-hit-'));
const dbPath = path.join(root, 'fixture.db');
const bundlePath = path.join(root, 'dictionary.mjs');
const db = new Database(dbPath);
db.exec(`
  CREATE TABLE v2_entries (id INTEGER PRIMARY KEY, word TEXT, normalized_key TEXT, source_lang TEXT, frequency_rank INTEGER, status TEXT);
  CREATE TABLE v2_entry_forms (id INTEGER PRIMARY KEY, entry_id INTEGER, lang TEXT, form TEXT, form_type TEXT, normalized_form TEXT, source TEXT, confidence REAL);
  CREATE TABLE v2_pronunciation_groups (id INTEGER PRIMARY KEY, entry_id INTEGER, lang TEXT, reading TEXT, reading_key TEXT, reading_system TEXT, display_order INTEGER, source TEXT, confidence REAL);
  CREATE TABLE v2_senses (id INTEGER PRIMARY KEY, entry_id INTEGER, pronunciation_group_id INTEGER, sense_order INTEGER, part_of_speech TEXT, domain TEXT, register_label TEXT, gloss_key TEXT, source TEXT, confidence REAL, verification_level TEXT, review_model TEXT, evidence_families_json TEXT);
  CREATE TABLE v2_sense_localizations (id INTEGER PRIMARY KEY, sense_id INTEGER, lang TEXT, term TEXT, normalized_term TEXT, reading TEXT, reading_system TEXT, pronunciation TEXT, pronunciation_system TEXT, definition TEXT, usage_note TEXT, source TEXT, confidence REAL);
  CREATE TABLE v2_examples (id INTEGER PRIMARY KEY, sense_id INTEGER, example_order INTEGER, source_lang TEXT, source_text TEXT, source_reading TEXT, difficulty TEXT, register_label TEXT, source TEXT, confidence REAL);
  CREATE TABLE v2_example_localizations (id INTEGER PRIMARY KEY, example_id INTEGER, lang TEXT, text TEXT, reading TEXT, source TEXT, confidence REAL);
  INSERT INTO v2_entries VALUES (1,'春','春','ja',1,'accepted');
  INSERT INTO v2_entries VALUES (2,'节日','节日','zh',2,'accepted');
  INSERT INTO v2_entries VALUES (3,'節日','節日','zh',3,'accepted');
  INSERT INTO v2_entry_forms VALUES (1,2,'zh','節日','traditional_alias','節日','fixture',1);
  INSERT INTO v2_pronunciation_groups VALUES (1,1,'ja','はる','はる','kana',1,'fixture',1),(2,1,'ja','しゅんせつ','しゅんせつ','kana',2,'fixture',1);
  INSERT INTO v2_senses VALUES
    (1,1,1,1,'noun',NULL,NULL,'prime of life','fixture',1,'verified',NULL,'[]'),
    (2,1,2,2,'noun',NULL,NULL,'Spring Festival; Chinese New Year','fixture',1,'verified',NULL,'[]'),
    (3,2,NULL,1,'noun',NULL,NULL,'festival; holiday','fixture',1,'verified',NULL,'[]'),
    (4,3,NULL,1,'noun',NULL,NULL,'legacy traditional entry','fixture',1,'verified',NULL,'[]');
`);
insertLocalizationSet(db, 1, { en: 'youth', zh: '青春', ja: '青春', 'pt-BR': 'juventude' });
insertLocalizationSet(db, 2, { en: 'Spring Festival', zh: '春节', ja: '春節', 'pt-BR': 'Festival da Primavera' });
insertLocalizationSet(db, 3, { en: 'festival', zh: '节日', ja: '祭日', 'pt-BR': 'festival' });
insertLocalizationSet(db, 4, { en: 'legacy entry', zh: '節日', ja: '旧項目', 'pt-BR': 'entrada antiga' });
db.close();

await build({
  entryPoints: [path.resolve('worker/dictionary.ts')], outfile: bundlePath,
  bundle: true, format: 'esm', platform: 'node', target: 'node22', logLevel: 'silent'
});
const fixture = new Database(dbPath, { readonly: true });
try {
  const { CloudflareD1V2Adapter } = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
  const response = await new CloudflareD1V2Adapter().lookup({
    env: { DB: d1Facade(fixture) }, text: '春节', targetLang: 'en', sourceLang: 'auto'
  });
  assert.ok(response);
  assert.equal(response.detected_source_lang, 'zh');
  assert.equal(response.senses.length, 1);
  assert.equal(response.senses[0].localizations.zh.term, '春节');
  assert.equal(response.senses[0].localizations.en.term, 'Spring Festival');
  assert.equal(response.senses.some((sense) => sense.localizations?.zh?.term === '青春'), false);
  const traditionalAliasResponse = await new CloudflareD1V2Adapter().lookup({
    env: { DB: d1Facade(fixture) }, text: '節日', targetLang: 'en', sourceLang: 'auto'
  });
  assert.ok(traditionalAliasResponse);
  assert.equal(traditionalAliasResponse.senses[0].localizations.zh.term, '节日');
  assert.equal(traditionalAliasResponse.senses[0].localizations.en.term, 'festival');
  assert.equal(traditionalAliasResponse.senses.some((sense) => sense.localizations?.en?.term === 'legacy entry'), false);
  console.log(JSON.stringify({
    ok: true,
    localizedTerm: { query: '春节', senses: response.senses.length, translation: response.translation },
    traditionalAlias: { query: '節日', canonical: traditionalAliasResponse.senses[0].localizations.zh.term, translation: traditionalAliasResponse.translation }
  }, null, 2));
} finally {
  fixture.close();
}

function insertLocalizationSet(database, senseId, terms) {
  const insert = database.prepare(`INSERT INTO v2_sense_localizations
    (sense_id,lang,term,normalized_term,reading,reading_system,pronunciation,pronunciation_system,definition,usage_note,source,confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [lang, term] of Object.entries(terms)) {
    insert.run(senseId, lang, term, term.toLocaleLowerCase(), lang === 'zh' ? 'chūn jié' : null,
      lang === 'zh' ? 'pinyin' : null, ['en', 'pt-BR'].includes(lang) ? '/fixture/' : null,
      ['en', 'pt-BR'].includes(lang) ? 'IPA' : null, `${term} definition`, null, 'fixture', 1);
  }
}
function d1Facade(database) {
  return { prepare(sql) { return { bind(...params) { return { async first() { return database.prepare(sql).get(...params) ?? null; } }; } }; } };
}
