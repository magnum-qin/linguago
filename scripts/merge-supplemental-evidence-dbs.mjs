#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const result = { inputs: [], replaceFamilies: [], compactBase: false, inPlace: false }
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--input') {
      result.inputs.push(argv[index + 1])
      index += 1
    } else if (argv[index] === '--out') {
      result.out = argv[index + 1]
      index += 1
    } else if (argv[index] === '--replace-family') {
      result.replaceFamilies.push(argv[index + 1])
      index += 1
    } else if (argv[index] === '--compact-base') {
      result.compactBase = argv[index + 1] === 'true'
      index += 1
    } else if (argv[index] === '--in-place') {
      result.inPlace = argv[index + 1] === 'true'
      index += 1
    }
  }
  return result
}

const args = parseArgs(process.argv)
if (!args.out || args.inputs.length < 2) {
  throw new Error('Usage: --input <db> --input <db> [--input <db>] --out <db>')
}
const inputs = args.inputs.map((value) => path.resolve(value))
for (const input of inputs) {
  if (!fs.existsSync(input)) throw new Error(`Input DB not found: ${input}`)
}
const out = path.resolve(args.out)
fs.mkdirSync(path.dirname(out), { recursive: true })
const isInPlace = args.inPlace && out === inputs[0]
if (args.inPlace && !isInPlace) {
  throw new Error('--in-place true requires --out to equal the first --input')
}
if (!isInPlace && fs.existsSync(out)) fs.rmSync(out)
if (!args.compactBase && !isInPlace) fs.copyFileSync(inputs[0], out)

const db = new Database(out)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
if (args.compactBase) {
  db.exec(`
    CREATE TABLE evidence_sources (
      source_key TEXT PRIMARY KEY, source_family TEXT NOT NULL, lang TEXT NOT NULL,
      lexicon_spec TEXT NOT NULL, license TEXT NOT NULL, metadata_json TEXT NOT NULL
    );
    CREATE TABLE lexical_evidence (
      id INTEGER PRIMARY KEY, source_key TEXT NOT NULL, source_family TEXT NOT NULL,
      lang TEXT NOT NULL, term TEXT NOT NULL, normalized_key TEXT NOT NULL,
      english_gloss TEXT NOT NULL, english_normalized_key TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      UNIQUE(source_key, lang, normalized_key, english_gloss, concept_id)
    );
    CREATE INDEX idx_lexical_evidence_lookup ON lexical_evidence(lang, normalized_key);
    CREATE INDEX idx_lexical_evidence_english ON lexical_evidence(lang, english_normalized_key);
  `)
  db.exec(`ATTACH DATABASE ${JSON.stringify(inputs[0])} AS compact_base`)
  const excluded = args.replaceFamilies.map(() => '?').join(', ')
  const sourceSql = excluded
    ? `SELECT source_key, source_family, lang, lexicon_spec, license, metadata_json
       FROM compact_base.evidence_sources WHERE source_family NOT IN (${excluded})`
    : `SELECT source_key, source_family, lang, lexicon_spec, license, metadata_json
       FROM compact_base.evidence_sources`
  const evidenceSql = excluded
    ? `SELECT source_key, source_family, lang, term, normalized_key,
              english_gloss, english_normalized_key, concept_id
       FROM compact_base.lexical_evidence WHERE source_family NOT IN (${excluded})`
    : `SELECT source_key, source_family, lang, term, normalized_key,
              english_gloss, english_normalized_key, concept_id
       FROM compact_base.lexical_evidence`
  db.prepare(`INSERT INTO evidence_sources ${sourceSql}`).run(...args.replaceFamilies)
  db.prepare(`INSERT INTO lexical_evidence
    (source_key, source_family, lang, term, normalized_key,
     english_gloss, english_normalized_key, concept_id) ${evidenceSql}`).run(...args.replaceFamilies)
  db.exec('DETACH DATABASE compact_base')
} else {
  for (const family of args.replaceFamilies) {
    db.prepare('DELETE FROM lexical_evidence WHERE source_family = ?').run(family)
    db.prepare('DELETE FROM evidence_sources WHERE source_family = ?').run(family)
  }
}
const additions = []
for (const [index, input] of inputs.slice(1).entries()) {
  const alias = `extra_${index}`
  db.exec(`ATTACH DATABASE ${JSON.stringify(input)} AS ${alias}`)
  const before = db.prepare('SELECT COUNT(*) AS count FROM lexical_evidence').get().count
  db.exec(`
    INSERT OR IGNORE INTO evidence_sources
      (source_key, source_family, lang, lexicon_spec, license, metadata_json)
    SELECT source_key, source_family, lang, lexicon_spec, license, metadata_json
    FROM ${alias}.evidence_sources;
    INSERT OR IGNORE INTO lexical_evidence
      (source_key, source_family, lang, term, normalized_key,
       english_gloss, english_normalized_key, concept_id)
    SELECT source_key, source_family, lang, term, normalized_key,
           english_gloss, english_normalized_key, concept_id
    FROM ${alias}.lexical_evidence;
  `)
  const after = db.prepare('SELECT COUNT(*) AS count FROM lexical_evidence').get().count
  additions.push({ input, added: after - before })
  db.exec(`DETACH DATABASE ${alias}`)
}
db.pragma('journal_mode = DELETE')
const integrity = db.pragma('integrity_check', { simple: true })
const rows = db.prepare('SELECT COUNT(*) AS count FROM lexical_evidence').get().count
const sources = db.prepare('SELECT source_family, COUNT(*) AS rows FROM lexical_evidence GROUP BY source_family ORDER BY source_family').all()
db.close()
console.log(JSON.stringify({ ok: integrity === 'ok', integrity, rows, sources, additions, out }, null, 2))
