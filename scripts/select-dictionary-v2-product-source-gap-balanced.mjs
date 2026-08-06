#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, token, index, values) => {
  if (token.startsWith('--')) pairs.push([token.slice(2), values[index + 1]])
  return pairs
}, []))
if (!args.report || !args.out || !args.targets) {
  throw new Error('Usage: --report <json> --out <json> --targets en=40,ja=25,pt-BR=25,zh=10')
}
const report = JSON.parse(fs.readFileSync(args.report, 'utf8'))
const excludedEntryIds = new Set()
const excludedCandidateKeys = new Set()
const excludeAll = args['exclude-all'] === 'true'
const excludeReports = String(args['exclude-reports'] || args['exclude-report'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
for (const excludeReport of excludeReports) {
  const excluded = JSON.parse(fs.readFileSync(excludeReport, 'utf8'))
  for (const row of excluded.reviews ?? excluded.selected ?? excluded.generated ?? []) {
    if (!excludeAll && row.consensus_accepted === true) continue
    if (row.source_entry_id != null) excludedEntryIds.add(String(row.source_entry_id))
    const key = candidateKey(row)
    if (key) excludedCandidateKeys.add(key)
  }
}
const uniqueEntry = args['unique-entry'] === 'true'
const excludeByEntry = args['exclude-by-entry'] === 'true'
const seenCandidateKeys = new Set()
const rows = (report.selected ?? []).filter((row) => {
  const key = candidateKey(row)
  if (!key || seenCandidateKeys.has(key)) return false
  seenCandidateKeys.add(key)
  return (
    !excludedCandidateKeys.has(key) &&
    (!excludeByEntry || !excludedEntryIds.has(String(row.source_entry_id)))
  )
})
const targets = new Map(String(args.targets).split(',').map((item) => {
  const separator = item.lastIndexOf('=')
  return [item.slice(0, separator), Number(item.slice(separator + 1))]
}))
const selected = []
for (const [lang, count] of targets) {
  const seenEntries = new Set()
  const languageRows = []
  for (const row of rows.filter((item) => item.source_lang === lang)) {
    const entryId = String(row.source_entry_id)
    if (uniqueEntry && seenEntries.has(entryId)) continue
    seenEntries.add(entryId)
    languageRows.push(row)
    if (languageRows.length >= count) break
  }
  selected.push(...languageRows)
}
selected.sort((left, right) => Number(left.frequency_rank ?? Infinity) - Number(right.frequency_rank ?? Infinity))
const output = {
  ...report,
  generated_at: new Date().toISOString(),
  source_report: path.resolve(args.report),
  selected_count: selected.length,
  selected,
  selection_policy: {
    language_targets: Object.fromEntries(targets),
    order: 'frequency_rank',
    unique_entry: uniqueEntry,
    exclude_all: excludeAll,
    exclude_by_entry: excludeByEntry,
    exclude_reports: excludeReports.map((value) => path.resolve(value)),
    excluded_entry_count: excludedEntryIds.size,
    excluded_candidate_count: excludedCandidateKeys.size,
    deduplicated_candidate_count: (report.selected ?? []).length - seenCandidateKeys.size
  },
}
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true })
fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ selected: selected.length, by_lang: Object.fromEntries([...targets].map(([lang]) => [lang, selected.filter((row) => row.source_lang === lang).length])), out: path.resolve(args.out) }, null, 2))

function candidateKey(row) {
  if (/^\d+:\d+$/.test(String(row?.candidate_key || ''))) return String(row.candidate_key)
  const entryId = Number(row?.source_entry_id)
  const senseId = Number(
    row?.source_sense_id ??
      row?.output?.source_sense_id ??
      row?.sense_alignment?.aligned_sense_id ??
      row?.first_sense_id
  )
  if (Number.isInteger(entryId) && Number.isInteger(senseId)) return `${entryId}:${senseId}`
  return null
}
