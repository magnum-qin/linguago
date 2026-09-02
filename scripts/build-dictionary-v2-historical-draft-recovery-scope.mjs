#!/usr/bin/env node

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const dbPath = requiredPath(args.db, '--db')
const controlledPath = requiredPath(args.controlled, '--controlled')
const scopePath = path.resolve(required(args.out, '--out'))
const applyPath = path.resolve(required(args['apply-out'], '--apply-out'))
const idempotentPath = path.resolve(required(args['idempotent-out'], '--idempotent-out'))
const newControlledPath = args['new-controlled-out']
  ? path.resolve(args['new-controlled-out'])
  : null

const controlled = readJson(controlledPath)
const selected = rows(controlled.selected)
const generated = rows(controlled.generated)
const generatedBySense = new Map(generated.map((row) => [sourceSenseId(row), row]))
const db = new Database(dbPath, { readonly: true, fileMustExist: true })
db.pragma('query_only = ON')
const mappingsForSourceSense = db.prepare(`
  SELECT DISTINCT
    l.source_entry_id,
    l.source_sense_id,
    ps.id AS product_sense_id,
    ps.product_entry_id,
    ps.status AS sense_status,
    pe.status AS entry_status,
    COUNT(DISTINCT pl.lang) AS localization_count
  FROM product_sense_source_links l
  JOIN product_senses ps ON ps.id = l.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  LEFT JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE l.source_sense_id = ?
  GROUP BY l.source_entry_id, l.source_sense_id, ps.id, ps.product_entry_id, ps.status, pe.status
  ORDER BY ps.id
`)

const recovered = []
const newDraftCandidates = []
const skipped = []
for (const row of selected) {
  const senseId = sourceSenseId(row)
  const generatedRow = generatedBySense.get(senseId)
  if (!generatedRow) throw new Error(`Controlled generation missing source sense: ${senseId}`)
  const mappings = mappingsForSourceSense.all(senseId)
  const drafts = mappings.filter((mapping) => mapping.sense_status === 'draft_single_source')
  const accepted = mappings.filter((mapping) => mapping.sense_status === 'accepted')
  if (accepted.length) {
    skipped.push({ source_sense_id: senseId, reason: 'already_accepted', mappings })
    continue
  }
  if (!drafts.length) {
    newDraftCandidates.push({ selected: row, generated: generatedRow, mappings })
    continue
  }
  if (drafts.length !== 1) {
    throw new Error(`Ambiguous existing drafts for source sense ${senseId}: ${drafts.length}`)
  }
  if (Number(drafts[0].localization_count) !== 4) {
    throw new Error(`Existing draft does not have four localizations: ${senseId}`)
  }
  recovered.push({ selected: row, generated: generatedRow, mapping: drafts[0] })
}
db.close()

const recoveredIds = new Set(recovered.map((row) => sourceSenseId(row.selected)))
const newDraftIds = new Set(newDraftCandidates.map((row) => sourceSenseId(row.selected)))
const scope = {
  ...controlled,
  generated_at: new Date().toISOString(),
  selection_policy: {
    ...(controlled.selection_policy || {}),
    historical_existing_draft_recovery: true,
    restricted_to_unique_existing_drafts: true
  },
  summary: {
    ...(controlled.summary || {}),
    reviewed_rows: selected.length,
    selected_rows: recovered.length,
    rejected_rows: skipped.length
  },
  selected_count: recovered.length,
  selected: selected.filter((row) => recoveredIds.has(sourceSenseId(row))),
  generated: generated.filter((row) => recoveredIds.has(sourceSenseId(row))),
  rejected: skipped
}

const writes = recovered.map(({ selected: row, mapping }) => ({
  source_entry_id: Number(row.source_entry_id),
  source_sense_id: sourceSenseId(row),
  product_entry_id: Number(mapping.product_entry_id),
  product_sense_id: Number(mapping.product_sense_id),
  recovery: 'existing_draft'
}))
const applyReport = {
  ok: true,
  generated_at: new Date().toISOString(),
  stats: {
    db: path.relative(process.cwd(), dbPath),
    controlled_consensus_draft_write: true,
    controlled_consensus_draft_write_count: recovered.length,
    historical_existing_drafts_recovered: recovered.length,
    entries_inserted: 0,
    entries_reused: recovered.length,
    senses_inserted: 0,
    senses_reused: recovered.length,
    localizations_upserted: 0,
    source_links_upserted: 0,
    examples_upserted: 0,
    example_localizations_upserted: 0
  },
  writes,
  skipped
}
const idempotentReport = {
  ...applyReport,
  generated_at: new Date().toISOString(),
  stats: {
    ...applyReport.stats,
    historical_existing_drafts_recovered: 0,
    entries_reused: 0,
    senses_reused: 0
  },
  writes: []
}

writeJson(scopePath, scope)
writeJson(applyPath, applyReport)
writeJson(idempotentPath, idempotentReport)
if (newControlledPath) {
  writeJson(newControlledPath, {
    ...controlled,
    generated_at: new Date().toISOString(),
    selection_policy: {
      ...(controlled.selection_policy || {}),
      historical_new_draft_replay: true,
      restricted_to_missing_drafts: true
    },
    summary: {
      ...(controlled.summary || {}),
      reviewed_rows: selected.length,
      selected_rows: newDraftCandidates.length,
      rejected_rows: skipped.length
    },
    selected_count: newDraftCandidates.length,
    selected: selected.filter((row) => newDraftIds.has(sourceSenseId(row))),
    generated: generated.filter((row) => newDraftIds.has(sourceSenseId(row))),
    rejected: skipped
  })
}
console.log(JSON.stringify({
  ok: true,
  scope: relative(scopePath),
  apply: relative(applyPath),
  input: selected.length,
  recovered_existing_drafts: recovered.length,
  new_draft_candidates: newDraftCandidates.length,
  skipped: skipped.length,
  skipped_by_reason: countBy(skipped, (row) => row.reason)
}, null, 2))

function sourceSenseId(row) {
  return Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id)
}

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
function countBy(items, keyFn) {
  const counts = {}
  for (const item of items) {
    const key = keyFn(item)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}
function relative(filePath) { return path.relative(process.cwd(), filePath) }
