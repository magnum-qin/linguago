#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const existingPath = requiredPath(args.existing, '--existing')
const insertedPath = requiredPath(args.inserted, '--inserted')
const outPath = path.resolve(required(args.out, '--out'))

const existing = readJson(existingPath)
const inserted = readJson(insertedPath)
const additiveStats = [
  'controlled_consensus_draft_write_count',
  'historical_existing_drafts_recovered',
  'entries_inserted',
  'entries_reused',
  'senses_inserted',
  'senses_reused',
  'localizations_upserted',
  'source_links_upserted',
  'examples_upserted',
  'example_localizations_upserted'
]
const stats = { ...(inserted.stats || {}) }
for (const key of additiveStats) {
  stats[key] = Number(existing?.stats?.[key] || 0) + Number(inserted?.stats?.[key] || 0)
}
stats.historical_mixed_replay = true

const output = {
  ...inserted,
  ok: existing.ok === true && inserted.ok === true,
  generated_at: new Date().toISOString(),
  stats,
  writes: [...rows(existing.writes), ...rows(inserted.writes)],
  skipped: [...rows(existing.skipped), ...rows(inserted.skipped)]
}
writeJson(outPath, output)
console.log(JSON.stringify({
  ok: output.ok,
  out: relative(outPath),
  writes: output.writes.length,
  senses_inserted: stats.senses_inserted,
  historical_existing_drafts_recovered: stats.historical_existing_drafts_recovered
}, null, 2))
if (!output.ok) process.exitCode = 2

function rows(value) { return Array.isArray(value) ? value : [] }
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')) }
function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
function required(value, name) {
  if (!value) throw new Error(`${name} is required`)
  return value
}
function requiredPath(value, name) {
  const resolved = path.resolve(required(value, name))
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`)
  return resolved
}
function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : true
  }
  return parsed
}
function relative(filePath) { return path.relative(process.cwd(), filePath) }
