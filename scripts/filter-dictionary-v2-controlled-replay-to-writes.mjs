#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const controlledPath = requiredPath(args.controlled, '--controlled')
const applyPath = requiredPath(args.apply, '--apply')
const outPath = path.resolve(args.out || 'logs/controlled-promote-scope.json')
const controlled = readJson(controlledPath)
const apply = readJson(applyPath)
const writes = Array.isArray(apply.writes) ? apply.writes : []
const sourceSenseIds = new Set(
  writes.map((row) => Number(row.source_sense_id)).filter(Number.isInteger)
)

const expectedWrites =
  Number(apply?.stats?.senses_inserted || 0) +
  Number(apply?.stats?.historical_existing_drafts_recovered || 0)
if (sourceSenseIds.size !== expectedWrites) {
  throw new Error('Apply writes do not provide one source_sense_id per inserted or recovered sense')
}

const selected = (controlled.selected || []).filter((row) =>
  sourceSenseIds.has(sourceSenseId(row))
)
const generated = (controlled.generated || []).filter((row) =>
  sourceSenseIds.has(sourceSenseId(row))
)
const selectedIds = new Set(selected.map(sourceSenseId))
const generatedIds = new Set(generated.map(sourceSenseId))
for (const sourceSenseId of sourceSenseIds) {
  if (!selectedIds.has(sourceSenseId)) {
    throw new Error(`Inserted source sense missing from controlled selection: ${sourceSenseId}`)
  }
  if (!generatedIds.has(sourceSenseId)) {
    throw new Error(`Inserted source sense missing from controlled generation: ${sourceSenseId}`)
  }
}

const out = {
  ...controlled,
  generated_at: new Date().toISOString(),
  source_report: relative(controlledPath),
  selection_policy: {
    ...(controlled.selection_policy || {}),
    restricted_to_current_apply_writes: true
  },
  summary: {
    ...(controlled.summary || {}),
    reviewed_rows: selected.length,
    selected_rows: selected.length,
    rejected_rows: 0
  },
  selected_count: selected.length,
  selected,
  rejected: [],
  generated
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({
  ok: true,
  out: relative(outPath),
  inserted_senses: sourceSenseIds.size,
  selected: selected.length,
  generated: generated.length
}, null, 2))

function sourceSenseId(row) {
  return Number(row?.first_sense_id ?? row?.source_sense_id ?? row?.output?.source_sense_id)
}

function requiredPath(value, name) {
  if (!value) throw new Error(`${name} is required`)
  const resolved = path.resolve(value)
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`)
  return resolved
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function relative(filePath) {
  return path.relative(process.cwd(), filePath)
}
