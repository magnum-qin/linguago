#!/usr/bin/env node

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const runsDir = path.resolve(args['runs-dir'] || 'runs')
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
)
const runPrefix = String(args['run-prefix'] || 'v201-historical-accepted-recovery').trim()
const batchSize = positiveInteger(args['batch-size'], 50)
const limit = positiveInteger(args.limit, 1000000)
const minimumConfidence = boundedNumber(args['minimum-confidence'], 0.9, 0, 1)
const manifestPath = path.resolve(
  args.out || path.join('logs', `${runPrefix}-manifest.json`)
)

for (const filePath of [runsDir, dbPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required path not found: ${filePath}`)
}
if (!/^[a-zA-Z0-9._-]+$/u.test(runPrefix)) throw new Error('Invalid --run-prefix')

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
db.pragma('query_only = ON')
const sourceLinkColumns = new Set(
  db.prepare('PRAGMA table_info(product_sense_source_links)').all().map((row) => row.name)
)
const linkedSourceKeys = loadLinkedSourceKeys(db, sourceLinkColumns)
const sourceEntryColumn = ['source_entry_id', 'entry_id'].find((name) => sourceLinkColumns.has(name))
const currentEntriesBySourceEntry = sourceEntryColumn
  ? db.prepare(`
      SELECT DISTINCT e.id, e.headword, e.primary_lang, e.status
      FROM product_sense_source_links l
      JOIN product_senses s ON s.id = l.product_sense_id
      JOIN product_entries e ON e.id = s.product_entry_id
      WHERE l.${sourceEntryColumn} = ?
        AND e.status IN ('accepted', 'draft_single_source')
    `)
  : null
const currentEntriesByHeadword = db.prepare(`
  SELECT id, headword, primary_lang, status
  FROM product_entries
  WHERE primary_lang = ?
    AND lower(trim(headword)) = lower(trim(?))
    AND status IN ('accepted', 'draft_single_source')
`)
const candidates = collectCandidates()
  .filter((row) => !linkedSourceKeys.has(row.candidate_key))
  .sort(compareCandidates)
  .slice(0, limit)

const layers = partitionByEntry(candidates)
const batches = []
for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
  const layer = layers[layerIndex]
  for (let offset = 0; offset < layer.length; offset += batchSize) {
    const rows = layer.slice(offset, offset + batchSize)
    const batchIndex = Math.floor(offset / batchSize) + 1
    const runId = `${runPrefix}-l${layerIndex + 1}-b${batchIndex}`
    const runDir = path.join(runsDir, runId)
    if (fs.existsSync(runDir)) throw new Error(`Recovery run already exists: ${runDir}`)
    fs.mkdirSync(runDir, { recursive: false })
    writeRecoveryRun(runDir, runId, rows)
    batches.push({
      run_id: runId,
      layer: layerIndex + 1,
      batch: batchIndex,
      candidate_count: rows.length,
      source_langs: countBy(rows, (row) => row.reviewRow.source_lang || 'unknown'),
      candidate_keys: rows.map((row) => row.candidate_key)
    })
  }
}

const manifest = {
  ok: true,
  generated_at: new Date().toISOString(),
  policy: {
    historical_reports_are_not_publication_evidence: true,
    only_current_complete_chain_included: true,
    require_source_reverse_evidence: true,
    require_independent_model_families: true,
    require_no_corrections: true,
    require_unlinked_source_sense: true,
    at_most_one_sense_per_source_entry_per_layer: true,
    automatic_database_writes: 0
  },
  db: relative(dbPath),
  run_prefix: runPrefix,
  candidates: candidates.length,
  layers: layers.length,
  batches: batches.length,
  batch_size: batchSize,
  by_source_lang: countBy(candidates, (row) => row.reviewRow.source_lang || 'unknown'),
  runs: batches
}
fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, out: relative(manifestPath), candidates: candidates.length, layers: layers.length, batches: batches.length, by_source_lang: manifest.by_source_lang }, null, 2))

function collectCandidates() {
  const bestByKey = new Map()
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const runDir = path.join(runsDir, entry.name)
    const finalPath = findFirstExisting(runDir, ['07-final-gemma-accepted.json', '07-final-gemma.json'])
    if (!finalPath || releaseWasCommitted(runDir)) continue
    const finalReport = readOptionalJson(finalPath)
    if (
      !finalReport ||
      finalReport?.policy?.independent_model_families !== true ||
      finalReport?.policy?.automatic_promotion !== false
    ) continue

    const generationPath = resolveReportPath(runDir, finalReport.generation_report, ['05-qwen-generation.json'])
    const evidencePath = resolveReportPath(runDir, finalReport.evidence_report, ['06-reverse-evidence.json'])
    const reviewPath = resolveHistoricalReviewPath(runDir, finalReport.source_report)
    const generationReport = readOptionalJson(generationPath)
    const evidenceReport = readOptionalJson(evidencePath)
    const reviewReport = readOptionalJson(reviewPath)
    if (
      !generationReport ||
      !evidenceReport ||
      !reviewReport ||
      evidenceReport?.policy?.require_source_reverse_evidence !== true
    ) continue

    const generationByKey = indexByCandidateKey(rowsFrom(generationReport, ['generated', 'replayed']))
    const evidenceByKey = indexByCandidateKey(rowsFrom(evidenceReport, ['validations']))
    const reviewByKey = indexByCandidateKey(rowsFrom(reviewReport, ['selected']))
    for (const finalRow of rowsFrom(finalReport, ['reviews'])) {
      if (!finalAccepted(finalRow)) continue
      const key = candidateKey(finalRow)
      const generationRow = generationByKey.get(key)
      const evidenceRow = evidenceByKey.get(key)
      const reviewRow = reviewByKey.get(key)
      if (!key || !generationRow || !evidenceRow || !reviewRow) continue
      if (generationRow.valid !== true || evidenceRow.decision !== 'supported') continue
      if (reviewRow?.candidate_evidence_review?.decision !== 'accept') continue
      if (Number(reviewRow?.candidate_evidence_review?.confidence || 0) < 0.95) continue
      const currentProductEntryId = resolveCurrentProductEntryId(reviewRow)
      if (
        reviewRow.candidate_lane === 'additional_unlinked_source_sense' &&
        !Number.isInteger(currentProductEntryId)
      ) continue
      const candidate = {
        candidate_key: key,
        source_run_id: entry.name,
        reviewRow: Number.isInteger(currentProductEntryId)
          ? { ...reviewRow, product_entry_id: currentProductEntryId }
          : reviewRow,
        generationRow: Number.isInteger(currentProductEntryId)
          ? rebindProductEntryId(generationRow, currentProductEntryId)
          : generationRow,
        evidenceRow,
        finalRow
      }
      const current = bestByKey.get(key)
      if (!current || scoreCandidate(candidate) > scoreCandidate(current)) bestByKey.set(key, candidate)
    }
  }
  return [...bestByKey.values()]
}

function rebindProductEntryId(row, productEntryId) {
  const rebound = { ...row, product_entry_id: productEntryId }
  for (const field of ['output', 'entry', 'result']) {
    if (row?.[field] && typeof row[field] === 'object' && !Array.isArray(row[field])) {
      rebound[field] = { ...row[field], product_entry_id: productEntryId }
    }
  }
  return rebound
}

function resolveCurrentProductEntryId(row) {
  const sourceEntryId = Number(row?.source_entry_id)
  const sourceLang = String(row?.source_lang || '')
  const headword = String(row?.word || '').trim()
  const linked = Number.isInteger(sourceEntryId) && currentEntriesBySourceEntry
    ? currentEntriesBySourceEntry.all(sourceEntryId)
    : []
  const exactLinked = linked.filter(
    (entry) => entry.primary_lang === sourceLang && normalize(entry.headword) === normalize(headword)
  )
  if (exactLinked.length === 1) return Number(exactLinked[0].id)
  const exact = headword && sourceLang ? currentEntriesByHeadword.all(sourceLang, headword) : []
  if (exact.length === 1) return Number(exact[0].id)
  return null
}

function writeRecoveryRun(runDir, runId, rows) {
  const createdAt = new Date().toISOString()
  const reviewRows = rows.map((row) => row.reviewRow)
  const generationRows = rows.map((row) => row.generationRow)
  const evidenceRows = rows.map((row) => row.evidenceRow)
  const finalRows = rows.map((row) => row.finalRow)
  const sourceRuns = [...new Set(rows.map((row) => row.source_run_id))].sort()

  writeJson(path.join(runDir, '04f-generation-ready-candidates.json'), {
    ok: true,
    generated_at: createdAt,
    selection_policy: {
      lane: 'historical_current-contract_recovery',
      automatic_promotion: false,
      source_runs: sourceRuns
    },
    summary: {
      reviewed_rows: reviewRows.length,
      selected_rows: reviewRows.length,
      rejected_rows: 0,
      selected_by_lang: countBy(reviewRows, (row) => row.source_lang || 'unknown')
    },
    selected_count: reviewRows.length,
    selected: reviewRows,
    rejected: []
  })

  writeJson(path.join(runDir, '05-qwen-generation.json'), {
    ok: true,
    generated_at: createdAt,
    stats: {
      input: generationRows.length,
      generated: generationRows.length,
      accepted: generationRows.length,
      rejected: 0,
      infrastructure_rejected: 0,
      chunk_size: Math.min(50, generationRows.length)
    },
    generated: generationRows,
    recovery_provenance: { source_runs: sourceRuns }
  })

  const checkpointItems = {}
  for (let index = 0; index < generationRows.length; index += 1) {
    const row = generationRows[index]
    const key = candidateKey(row)
    const commitGroup = Math.floor(index / 50)
    checkpointItems[key] = {
      source_entry_id: Number(row.source_entry_id),
      source_sense_id: Number(row.source_sense_id ?? row.output?.source_sense_id),
      completed_at: new Date(Date.parse(createdAt) + commitGroup).toISOString(),
      generated_item: row
    }
  }
  writeJson(path.join(runDir, '05-qwen-generation.checkpoint.json'), {
    run_id: runId,
    generated_at: createdAt,
    config: { chunk_size: Math.min(50, generationRows.length) },
    items: checkpointItems
  })

  writeJson(path.join(runDir, '06-reverse-evidence.json'), {
    ok: true,
    generated_at: createdAt,
    policy: {
      require_source_reverse_evidence: true,
      evidence_family_policy: 'wiktionary',
      historical_current_contract_recovery: true
    },
    summary: {
      input: evidenceRows.length,
      supported: evidenceRows.length,
      rejected: 0
    },
    validations: evidenceRows
  })

  writeJson(path.join(runDir, '07-final-gemma.json'), {
    ok: true,
    generated_at: createdAt,
    generation_report: path.join(runDir, '05-qwen-generation.json'),
    evidence_report: path.join(runDir, '06-reverse-evidence.json'),
    source_report: path.join(runDir, '04f-generation-ready-candidates.json'),
    policy: {
      independent_model_families: true,
      automatic_promotion: false,
      confidence_threshold: minimumConfidence,
      require_no_corrections: true,
      historical_current_contract_recovery: true
    },
    summary: {
      input: finalRows.length,
      accepted: finalRows.length,
      rejected: 0
    },
    reviews: finalRows
  })

  writeJson(path.join(runDir, 'summary.json'), {
    ok: true,
    run_id: runId,
    generated_at: createdAt,
    summary: {
      input: rows.length,
      jmdict_generation_ready: rows.length,
      generated_valid: rows.length,
      reverse_supported: rows.length,
      final_accepted: rows.length,
      final_rejected: 0,
      automatic_database_writes: 0
    },
    recovery_provenance: { source_runs: sourceRuns }
  })
}

function loadLinkedSourceKeys(database, columns) {
  const entryColumn = ['source_entry_id', 'entry_id'].find((name) => columns.has(name))
  const senseColumn = ['source_sense_id', 'sense_id'].find((name) => columns.has(name))
  if (!entryColumn || !senseColumn) return new Set()
  return new Set(
    database.prepare(`
      SELECT DISTINCT l.${entryColumn} AS source_entry_id, l.${senseColumn} AS source_sense_id
      FROM product_sense_source_links l
      JOIN product_senses s ON s.id = l.product_sense_id
      WHERE s.status = 'accepted'
    `).all().map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`)
  )
}

function partitionByEntry(rows) {
  const layers = []
  for (const row of rows) {
    const entryId = Number(row.reviewRow.source_entry_id)
    let placed = false
    for (const layer of layers) {
      if (layer.some((item) => Number(item.reviewRow.source_entry_id) === entryId)) continue
      layer.push(row)
      placed = true
      break
    }
    if (!placed) layers.push([row])
  }
  return layers
}

function finalAccepted(row) {
  return row?.valid === true &&
    row?.decision === 'accept' &&
    row?.consensus_accepted === true &&
    Number(row?.confidence || 0) >= minimumConfidence &&
    Array.isArray(row?.corrections) &&
    row.corrections.length === 0
}

function releaseWasCommitted(runDir) {
  const releasePath = path.join(runDir, 'release-controller.json')
  const release = readOptionalJson(releasePath)
  return Boolean(release && (
    release.committed ||
    release.product_db_committed ||
    release.status === 'committed' ||
    release.stage === 'committed' ||
    release.status === 'candidate_exhausted' ||
    release.candidate_exhausted === true ||
    (release.ok === true && release.commit === true && release.main_replaced === true)
  ))
}

function resolveHistoricalReviewPath(runDir, declaredPath) {
  const direct = resolveReportPath(runDir, declaredPath, [
    '04f-generation-ready-candidates.json',
    '04b-source-consensus-reverse-supported.json',
    '04-source-consensus.json'
  ])
  if (direct) return direct

  const manifest = readOptionalJson(path.join(runDir, 'manifest.json'))
  const sourceRunDir = String(manifest?.source_run_dir || '').trim()
  if (!sourceRunDir) return null
  const resolvedSourceDir = [
    path.resolve(sourceRunDir),
    path.resolve(process.cwd(), sourceRunDir),
    path.resolve(path.dirname(runsDir), sourceRunDir)
  ].find((candidate) => fs.existsSync(candidate))
  if (!resolvedSourceDir) return null
  return findFirstExisting(resolvedSourceDir, [
    '04f-generation-ready-candidates.json',
    '04b-source-consensus-reverse-supported.json',
    '04-source-consensus.json'
  ])
}

function resolveReportPath(runDir, declaredPath, fallbacks) {
  const declared = String(declaredPath || '').trim()
  if (declared) {
    const found = [path.resolve(declared), path.resolve(process.cwd(), declared), path.resolve(runDir, declared)]
      .find((candidate) => fs.existsSync(candidate))
    if (found) return found
  }
  return findFirstExisting(runDir, fallbacks)
}

function findFirstExisting(baseDir, names) {
  return names.map((name) => path.join(baseDir, name)).find((candidate) => fs.existsSync(candidate)) || null
}

function readOptionalJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')) } catch { return null }
}

function rowsFrom(report, keys) {
  for (const key of keys) if (Array.isArray(report?.[key])) return report[key]
  return []
}

function indexByCandidateKey(rows) {
  const index = new Map()
  for (const row of rows) {
    const key = candidateKey(row)
    if (key && !index.has(key)) index.set(key, row)
  }
  return index
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id)
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id)
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null
  return `${entryId}:${senseId}`
}

function normalize(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase()
}

function scoreCandidate(row) {
  return Number(row.finalRow.confidence || 0) + Number(row.evidenceRow.confidence || 0) / 10
}

function compareCandidates(left, right) {
  const leftRank = Number(left.reviewRow.frequency_rank || Number.MAX_SAFE_INTEGER)
  const rightRank = Number(right.reviewRow.frequency_rank || Number.MAX_SAFE_INTEGER)
  return leftRank - rightRank ||
    Number(left.reviewRow.source_entry_id) - Number(right.reviewRow.source_entry_id) ||
    Number(left.reviewRow.first_sense_id) - Number(right.reviewRow.first_sense_id)
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function countBy(rows, getKey) {
  return rows.reduce((counts, row) => {
    const key = String(getKey(row))
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function relative(filePath) { return path.relative(process.cwd(), filePath) }
function positiveInteger(value, fallback) {
  const number = Number.parseInt(value ?? fallback, 10)
  if (!Number.isInteger(number) || number < 1) throw new Error(`Expected positive integer, got ${value}`)
  return number
}
function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}
function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue
    const key = argv[index].slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true'
  }
  return parsed
}
