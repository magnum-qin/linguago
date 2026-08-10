#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const LANGS = ['en', 'pt-BR', 'zh', 'ja']
const args = parseArgs(process.argv.slice(2))
const candidatesPath = path.resolve(required(args.candidates, 'candidates'))
const evidencePath = path.resolve(required(args.evidence, 'evidence'))
const attemptsPath = path.resolve(required(args['attempt-index'], 'attempt-index'))
const outPath = path.resolve(required(args.out, 'out'))
const limit = boundedInteger(args.limit, 20, 1)
const minimumFamilies = boundedInteger(args['minimum-source-families'], 2, 2)
const minimumMatchRatio = boundedNumber(args['minimum-match-ratio'], 1, 0, 1)
const requireUnambiguousOmw = args['require-unambiguous-omw'] !== 'false'
const minimumTargetHints = boundedInteger(args['minimum-target-hints'], 3, 1)
if (minimumTargetHints > 3) throw new Error(`Invalid --minimum-target-hints: ${minimumTargetHints}`)
const maximumTargetHints = boundedInteger(args['maximum-target-hints'], 3, 1)
if (maximumTargetHints > 3 || maximumTargetHints < minimumTargetHints) {
  throw new Error(`Invalid --maximum-target-hints: ${maximumTargetHints}`)
}

const candidateReport = readJson(candidatesPath)
const evidenceReport = readJson(evidencePath)
const attemptReport = readJson(attemptsPath)
const candidateRows = candidateReport.selected || []
const candidateBySense = new Map(
  candidateRows.map((row) => [`${Number(row.source_entry_id)}:${Number(row.first_sense_id)}`, row])
)
const candidatesByEntry = new Map()
for (const row of candidateRows) {
  const entryId = Number(row.source_entry_id)
  if (!candidatesByEntry.has(entryId)) candidatesByEntry.set(entryId, [])
  candidatesByEntry.get(entryId).push(row)
}
const attempted = new Set()
for (const row of attemptReport.selected || []) {
  attempted.add(`${Number(row.source_entry_id)}:${row.source_sense_id ? Number(row.source_sense_id) : '*'}`)
}

const rejectionCounts = new Map()
const eligible = []
for (const validation of evidenceReport.validations || []) {
  const result = inspect(validation)
  if (!result.ok) {
    rejectionCounts.set(result.reason, (rejectionCounts.get(result.reason) || 0) + 1)
    continue
  }
  eligible.push(result.row)
}

eligible.sort(
  (left, right) =>
    Number(left.frequency_rank ?? Number.MAX_SAFE_INTEGER) -
      Number(right.frequency_rank ?? Number.MAX_SAFE_INTEGER) ||
    String(left.source_lang).localeCompare(String(right.source_lang)) ||
    Number(left.source_entry_id) - Number(right.source_entry_id)
)
const selected = eligible.slice(0, limit)
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), candidatesPath),
  source_evidence: path.relative(process.cwd(), evidencePath),
  attempt_index: path.relative(process.cwd(), attemptsPath),
  selection_policy: {
    lane: 'controlled_dual_model',
    evidence_decision: 'unsupported',
    allowed_reason: 'insufficient_independent_target_evidence',
    minimum_source_families: minimumFamilies,
    minimum_match_ratio: minimumMatchRatio,
    require_unambiguous_omw: requireUnambiguousOmw,
    minimum_target_hints: minimumTargetHints,
    maximum_target_hints: maximumTargetHints,
    require_all_three_target_hints: minimumTargetHints === 3,
    exclude_historical_attempts: true,
    source_review_model_family_must_differ_from_generation_model: true,
    generation_review_model_family_must_differ_from_generation_model: true,
    publication_requires_separate_consensus_and_deterministic_promote: true,
    limit
  },
  summary: {
    evidence_rows: (evidenceReport.validations || []).length,
    aligned_candidate_rows: candidateRows.length,
    historical_attempts: (attemptReport.selected || []).length,
    eligible_rows: eligible.length,
    selected_rows: selected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    rejected_by_reason: Object.fromEntries([...rejectionCounts].sort(([a], [b]) => a.localeCompare(b)))
  },
  selected_count: selected.length,
  selected
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      eligible: eligible.length,
      selected: selected.length,
      by_lang: output.summary.selected_by_lang,
      words: selected.map((row) => row.word)
    },
    null,
    2
  )
)

function inspect(validation) {
  if (validation?.decision !== 'unsupported') return reject('not_unsupported')
  if (validation?.reason !== 'insufficient_independent_target_evidence') return reject('wrong_failure_reason')
  const families = [...new Set(validation?.evidence?.matching_source_families || [])]
  if (families.length < minimumFamilies) return reject('insufficient_source_families')
  if (requireUnambiguousOmw && validation?.evidence?.unambiguous_omw_support !== true)
    return reject('ambiguous_or_missing_omw')
  if (Number(validation?.evidence?.match_ratio || 0) < minimumMatchRatio) return reject('low_source_match_ratio')
  const entryId = Number(validation?.source_entry_id)
  const entryCandidates = candidatesByEntry.get(entryId) || []
  const legacyCandidate = entryCandidates.length === 1 ? entryCandidates[0] : null
  const senseId = Number(validation?.source_sense_id ?? legacyCandidate?.first_sense_id)
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return reject('invalid_candidate_identity')
  if (attempted.has(`${entryId}:${senseId}`) || attempted.has(`${entryId}:*`)) return reject('historically_attempted')
  const sourceRow = candidateBySense.get(`${entryId}:${senseId}`) || legacyCandidate
  if (!sourceRow) return reject('missing_aligned_candidate')
  if (Number(sourceRow?.sense_alignment?.aligned_sense_id) !== senseId) return reject('sense_alignment_mismatch')
  const targetLangs = LANGS.filter((lang) => lang !== validation.source_lang)
  const targetLanguagesWithHints = targetLangs.filter(
    (lang) =>
      Array.isArray(validation?.generation_hints?.[lang]?.terms) &&
      validation.generation_hints[lang].terms.length
  )
  if (targetLanguagesWithHints.length < minimumTargetHints) {
    return reject('missing_target_hint')
  }
  if (targetLanguagesWithHints.length > maximumTargetHints) {
    return reject('too_many_target_hints')
  }
  return {
    ok: true,
    row: {
      ...sourceRow,
      candidate_key: `${entryId}:${senseId}`,
      generation_hints: validation.generation_hints,
      controlled_lane_evidence: {
        decision: validation.decision,
        reason: validation.reason,
        matching_sources: validation.evidence?.matching_sources || [],
        matching_source_families: families,
        aligned_omw_synsets: validation.evidence?.aligned_omw_synsets || [],
        unambiguous_omw_support: validation.evidence?.unambiguous_omw_support === true,
        match_ratio: Number(validation.evidence?.match_ratio || 0),
        target_languages_with_hints: targetLanguagesWithHints,
        target_languages_missing_hints: targetLangs.filter(
          (lang) => !targetLanguagesWithHints.includes(lang)
        )
      },
      candidate_review_provenance: {
        kind: 'controlled_dual_model_preselection',
        source_evidence: path.relative(process.cwd(), evidencePath),
        publication_evidence: false,
        requires_source_review: true,
        requires_generation_consensus: true
      }
    }
  }
}

function reject(reason) {
  return { ok: false, reason }
}

function countBy(rows, selector) {
  const counts = new Map()
  for (const row of rows) {
    const key = selector(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => String(a).localeCompare(String(b))))
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`)
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`)
  return String(value)
}

function boundedInteger(value, fallback, minimum) {
  const number = Number(value ?? fallback)
  if (!Number.isInteger(number) || number < minimum) throw new Error(`Invalid integer: ${value}`)
  return number
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value ?? fallback)
  if (!Number.isFinite(number) || number < minimum || number > maximum) throw new Error(`Invalid number: ${value}`)
  return number
}

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    parsed[key] = next && !next.startsWith('--') ? argv[++index] : 'true'
  }
  return parsed
}
