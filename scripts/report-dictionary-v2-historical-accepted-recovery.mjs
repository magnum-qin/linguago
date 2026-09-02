#!/usr/bin/env node

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const args = parseArgs(process.argv.slice(2))
const runsDir = path.resolve(args['runs-dir'] || 'runs')
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
)
const outPath = path.resolve(args.out || 'logs/historical-accepted-recovery-capacity.json')
const minimumConfidence = boundedNumber(args['minimum-confidence'], 0.9, 0, 1)

for (const filePath of [runsDir, dbPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required path not found: ${filePath}`)
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true })
db.pragma('query_only = ON')
const sourceLinkColumns = new Set(
  db.prepare('PRAGMA table_info(product_sense_source_links)').all().map((row) => row.name)
)
const linkedSourceKeys = loadLinkedSourceKeys(db, sourceLinkColumns)
const acceptedSenseCount = db
  .prepare("SELECT COUNT(*) AS count FROM product_senses WHERE status = 'accepted'")
  .get().count

const reportRows = []
const rejectedReports = []

for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const runDir = path.join(runsDir, entry.name)
  const finalPath = findFirstExisting(runDir, [
    '07-final-gemma-accepted.json',
    '07-final-gemma.json'
  ])
  if (!finalPath) continue

  let finalReport
  try {
    finalReport = readJson(finalPath)
  } catch (error) {
    rejectedReports.push({ run_id: entry.name, reason: 'invalid_final_json', error: error.message })
    continue
  }

  if (releaseWasCommitted(runDir)) continue
  const finalAccepted = (finalReport.reviews || []).filter(
    (row) =>
      row?.valid === true &&
      row?.decision === 'accept' &&
      row?.consensus_accepted === true &&
      Number(row?.confidence || 0) >= minimumConfidence &&
      Array.isArray(row?.corrections) &&
      row.corrections.length === 0
  )
  if (!finalAccepted.length) continue

  const generationPath = resolveReportPath(
    runDir,
    finalReport.generation_report,
    ['05-qwen-generation.json']
  )
  const evidencePath = resolveReportPath(
    runDir,
    finalReport.evidence_report,
    ['06-reverse-evidence.json']
  )
  const reviewPath = resolveHistoricalReviewPath(runDir, finalReport.source_report)
  const generation = readOptionalJson(generationPath)
  const evidence = readOptionalJson(evidencePath)
  const review = readOptionalJson(reviewPath)

  const generationByKey = indexByCandidateKey(
    Array.isArray(generation?.generated)
      ? generation.generated
      : Array.isArray(generation?.replayed)
        ? generation.replayed
        : []
  )
  const evidenceByKey = indexByCandidateKey(evidence?.validations || [])
  const reviewByKey = indexByCandidateKey(review?.selected || [])

  for (const finalRow of finalAccepted) {
    const key = candidateKey(finalRow)
    if (!key) continue
    const generationRow = generationByKey.get(key) || null
    const evidenceRow = evidenceByKey.get(key) || null
    const reviewRow = reviewByKey.get(key) || null
    reportRows.push({
      candidate_key: key,
      source_entry_id: Number(finalRow.source_entry_id),
      source_sense_id: Number(finalRow.source_sense_id),
      word: finalRow.word || generationRow?.word || reviewRow?.word || null,
      source_lang: finalRow.source_lang || generationRow?.source_lang || reviewRow?.source_lang || null,
      run_id: entry.name,
      final_path: relative(finalPath),
      generation_path: generationPath ? relative(generationPath) : null,
      evidence_path: evidencePath ? relative(evidencePath) : null,
      review_path: reviewPath ? relative(reviewPath) : null,
      final_confidence: Number(finalRow.confidence || 0),
      final_policy_current:
        finalReport?.policy?.independent_model_families === true &&
        finalReport?.policy?.automatic_promotion === false,
      generation_present: Boolean(generationRow),
      generation_valid: generationRow?.valid === true,
      evidence_present: Boolean(evidenceRow),
      evidence_supported: evidenceRow?.decision === 'supported',
      evidence_policy_current: evidence?.policy?.require_source_reverse_evidence === true,
      review_present: Boolean(reviewRow),
      already_linked_in_product: linkedSourceKeys.has(key),
      recoverable_with_existing_chain:
        Boolean(reviewRow) &&
        generationRow?.valid === true &&
        evidenceRow?.decision === 'supported' &&
        evidence?.policy?.require_source_reverse_evidence === true &&
        finalReport?.policy?.independent_model_families === true &&
        finalReport?.policy?.automatic_promotion === false
    })
  }
}

const deduplicated = deduplicateCandidates(reportRows)
const unlinked = deduplicated.filter((row) => !row.already_linked_in_product)
const recoverableExistingChain = unlinked.filter((row) => row.recoverable_with_existing_chain)
const needsCurrentRevalidation = unlinked.filter(
  (row) =>
    row.review_present &&
    row.generation_valid &&
    !row.recoverable_with_existing_chain
)

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: relative(dbPath),
  runs_dir: relative(runsDir),
  policy: {
    read_only: true,
    minimum_final_confidence: minimumConfidence,
    require_no_corrections: true,
    existing_chain_requires_current_reverse_evidence_policy: true,
    existing_chain_requires_independent_model_families: true,
    existing_chain_requires_automatic_promotion_false: true
  },
  product: {
    accepted_senses: acceptedSenseCount,
    target_accepted_senses: 56738,
    remaining_to_target: Math.max(0, 56738 - acceptedSenseCount),
    linked_source_keys: linkedSourceKeys.size
  },
  summary: {
    historical_accepted_rows: reportRows.length,
    unique_historical_candidates: deduplicated.length,
    unique_unlinked_candidates: unlinked.length,
    recoverable_with_existing_chain: recoverableExistingChain.length,
    requires_current_revalidation: needsCurrentRevalidation.length,
    missing_review_or_generation: unlinked.length - recoverableExistingChain.length - needsCurrentRevalidation.length,
    by_source_lang: countBy(unlinked, (row) => row.source_lang || 'unknown'),
    duplicate_rows_removed: reportRows.length - deduplicated.length,
    rejected_report_count: rejectedReports.length
  },
  recoverable_with_existing_chain: recoverableExistingChain,
  requires_current_revalidation: needsCurrentRevalidation,
  incomplete: unlinked.filter(
    (row) => !row.recoverable_with_existing_chain && !(row.review_present && row.generation_valid)
  ),
  rejected_reports: rejectedReports
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, out: relative(outPath), product: output.product, summary: output.summary }, null, 2))

function loadLinkedSourceKeys(database, columns) {
  const entryColumn = ['source_entry_id', 'entry_id'].find((name) => columns.has(name))
  const senseColumn = ['source_sense_id', 'sense_id'].find((name) => columns.has(name))
  if (!entryColumn || !senseColumn) return new Set()
  return new Set(
    database
      .prepare(`
        SELECT DISTINCT l.${entryColumn} AS source_entry_id, l.${senseColumn} AS source_sense_id
        FROM product_sense_source_links l
        JOIN product_senses s ON s.id = l.product_sense_id
        WHERE s.status = 'accepted'
      `)
      .all()
      .map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`)
  )
}

function releaseWasCommitted(runDir) {
  const releasePath = path.join(runDir, 'release-controller.json')
  if (!fs.existsSync(releasePath)) return false
  try {
    const release = readJson(releasePath)
    return Boolean(
      release.committed ||
      release.product_db_committed ||
      release.status === 'committed' ||
      release.stage === 'committed' ||
      release.status === 'candidate_exhausted' ||
      release.candidate_exhausted === true ||
      (release.ok === true && release.commit === true && release.main_replaced === true)
    )
  } catch {
    return false
  }
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
    const candidates = [
      path.resolve(declared),
      path.resolve(process.cwd(), declared),
      path.resolve(runDir, declared)
    ]
    const found = candidates.find((candidate) => fs.existsSync(candidate))
    if (found) return found
  }
  return findFirstExisting(runDir, fallbacks)
}

function findFirstExisting(baseDir, names) {
  for (const name of names) {
    const candidate = path.join(baseDir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function readOptionalJson(filePath) {
  if (!filePath) return null
  try {
    return readJson(filePath)
  } catch {
    return null
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
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

function deduplicateCandidates(rows) {
  const byKey = new Map()
  for (const row of rows) {
    const current = byKey.get(row.candidate_key)
    if (!current || candidateScore(row) > candidateScore(current)) byKey.set(row.candidate_key, row)
  }
  return [...byKey.values()].sort((left, right) =>
    left.source_entry_id - right.source_entry_id || left.source_sense_id - right.source_sense_id
  )
}

function candidateScore(row) {
  return Number(row.recoverable_with_existing_chain) * 1000 +
    Number(row.review_present) * 100 +
    Number(row.generation_valid) * 50 +
    Number(row.evidence_supported) * 20 +
    Number(row.final_confidence || 0)
}

function countBy(rows, getKey) {
  return rows.reduce((counts, row) => {
    const key = String(getKey(row))
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath)
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(maximum, Math.max(minimum, number))
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next && !next.startsWith('--')) {
      parsed[key] = next
      index += 1
    } else {
      parsed[key] = 'true'
    }
  }
  return parsed
}
