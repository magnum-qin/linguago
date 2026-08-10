#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const result = {}
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    result[argv[index].slice(2)] = argv[index + 1]
    index += 1
  }
  return result
}

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('und').replace(/\s+/g, ' ').trim()
}

function clean(value) {
  const text = String(value ?? '').normalize('NFKC').trim()
  if (!text || text.toLowerCase() === 'missing gloss' || /\uFFFD|<[^>]+>/u.test(text)) return ''
  return text
}

const args = parseArgs(process.argv)
if (!args.report || !args['source-db'] || !args.out) {
  throw new Error('Usage: --report <coverage.json> --source-db <db> --out <expanded.json>')
}
const input = JSON.parse(fs.readFileSync(args.report, 'utf8'))
const inputRows = input.selected ?? input.rows ?? input
const sourceDbPath = path.resolve(args['source-db'])
const db = new Database(sourceDbPath, { readonly: true, fileMustExist: true })
db.pragma('query_only = ON')
const senses = db.prepare(`
  SELECT id, sense_order, part_of_speech, gloss_key, source, confidence, needs_review
  FROM senses
  WHERE entry_id = ?
    AND needs_review = 0
    AND NULLIF(TRIM(gloss_key), '') IS NOT NULL
    AND lower(TRIM(gloss_key)) <> 'missing gloss'
  ORDER BY sense_order, id
`)
const localizations = db.prepare(`
  SELECT lang, term, reading, reading_system, pronunciation, pronunciation_system,
         definition, source, confidence, needs_review
  FROM sense_localizations
  WHERE sense_id = ?
  ORDER BY needs_review, lang
`)
const examples = db.prepare(`
  SELECT id, example_order, source_lang, source_text, source_reading, source, confidence, needs_review
  FROM examples
  WHERE sense_id = ? AND needs_review = 0
  ORDER BY example_order, id
  LIMIT 2
`)
const exampleLocalizations = db.prepare(`
  SELECT lang, text, reading, source, confidence, needs_review
  FROM example_localizations
  WHERE example_id = ?
  ORDER BY needs_review, lang
`)

const expanded = []
let skippedDuplicateGloss = 0
let skippedNoCleanLocalization = 0
for (const row of inputRows) {
  const seenGlosses = new Set()
  for (const sense of senses.all(row.source_entry_id)) {
    const gloss = clean(sense.gloss_key)
    const glossKey = normalize(gloss)
    if (!glossKey) continue
    if (seenGlosses.has(glossKey)) {
      skippedDuplicateGloss += 1
      continue
    }
    seenGlosses.add(glossKey)
    const locs = localizations.all(sense.id)
    const cleanLangs = [...new Set(locs.filter((item) => !item.needs_review && clean(item.term) && clean(item.definition)).map((item) => item.lang))]
    if (!cleanLangs.length) {
      skippedNoCleanLocalization += 1
      continue
    }
    expanded.push({
      ...row,
      candidate_key: `${row.source_entry_id}:${sense.id}`,
      first_sense_id: sense.id,
      first_sense_order: sense.sense_order,
      part_of_speech: clean(sense.part_of_speech) || null,
      gloss_key: gloss,
      gloss_preview: gloss.slice(0, 180),
      first_sense_clean_localization_langs: cleanLangs,
      first_sense_clean_localization_lang_count: cleanLangs.length,
      first_sense_localizations: locs,
      example_samples: examples.all(sense.id).map((example) => ({
        ...example,
        localizations: exampleLocalizations.all(example.id),
      })),
      sense_expansion: {
        source_report_first_sense_id: row.first_sense_id,
        expanded: sense.id !== row.first_sense_id,
        source: sense.source,
        confidence: sense.confidence,
      },
    })
  }
}
db.close()
expanded.sort((left, right) =>
  Number(left.frequency_rank ?? Infinity) - Number(right.frequency_rank ?? Infinity)
  || String(left.source_lang).localeCompare(String(right.source_lang))
  || Number(left.source_entry_id) - Number(right.source_entry_id)
  || Number(left.first_sense_order) - Number(right.first_sense_order)
)
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.resolve(args.report),
  source_db: sourceDbPath,
  policy: {
    granularity: 'source_sense',
    require_sense_needs_review_zero: true,
    deduplicate_normalized_gloss_within_entry: true,
    require_at_least_one_clean_localization: true,
  },
  summary: {
    input_entries: inputRows.length,
    expanded_senses: expanded.length,
    additional_senses: expanded.filter((row) => row.sense_expansion.expanded).length,
    skipped_duplicate_gloss: skippedDuplicateGloss,
    skipped_no_clean_localization: skippedNoCleanLocalization,
  },
  selected_count: expanded.length,
  selected: expanded,
}
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ...output.summary, out: path.resolve(args.out) }, null, 2))
