#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const result = { inputs: [] }
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === '--input') {
      result.inputs.push(argv[index + 1])
      index += 1
    } else if (argv[index] === '--out') {
      result.out = argv[index + 1]
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
if (fs.existsSync(out)) fs.rmSync(out)
fs.copyFileSync(inputs[0], out)

const db = new Database(out)
db.pragma('journal_mode = WAL')
db.pragma('synchronous = NORMAL')
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
