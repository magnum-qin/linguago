#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const LANGS = ['en', 'pt-BR', 'zh', 'ja']
const args = parseArgs(process.argv.slice(2))
const reviewPath = path.resolve(required(args.review, 'review'))
const outPath = path.resolve(required(args.out, 'out'))
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.95, 0, 1)
const generationModelFamily = String(args['generation-model-family'] || 'qwen').trim().toLowerCase()
const consensusModelFamily = String(args['consensus-model-family'] || 'gemma').trim().toLowerCase()
const finalGenerationPath = optionalPath(args.generation)
const finalEvidencePath = optionalPath(args.evidence)
const finalConsensusPath = optionalPath(args.consensus)
const finalGatePaths = [finalGenerationPath, finalEvidencePath, finalConsensusPath]
const finalGateEnabled = finalGatePaths.every(Boolean)

if (finalGatePaths.some(Boolean) && !finalGateEnabled) {
  throw new Error('--generation, --evidence, and --consensus must be provided together')
}

if (generationModelFamily === consensusModelFamily) {
  throw new Error('Generation and consensus model families must differ')
}

const report = readJson(reviewPath)
const finalGate = finalGateEnabled ? loadFinalGate() : null
const sourceRows = report.selected || []
const rejected = []
const selected = []

for (const row of sourceRows) {
  const result = inspect(row)
  if (!result.ok) {
    rejected.push({
      source_entry_id: Number(row.source_entry_id),
      source_sense_id: Number(row.first_sense_id),
      word: row.word,
      reason: result.reason
    })
    continue
  }
  selected.push(result.row)
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reviewPath),
  selection_policy: {
    lane: 'controlled_model_consensus',
    publication_evidence: false,
    minimum_source_review_confidence: confidenceThreshold,
    independently_bound_terms_remain_preferred_only: true,
    suggested_terms_are_nonbinding_generation_constraints: true,
    generation_model_family: generationModelFamily,
    consensus_model_family: consensusModelFamily,
    require_deterministic_reverse_evidence: true,
    require_independent_no_correction_consensus: true,
    automatic_promotion: false,
    final_generation_evidence_consensus_gate: finalGateEnabled
  },
  summary: {
    reviewed_rows: sourceRows.length,
    selected_rows: selected.length,
    rejected_rows: rejected.length,
    selected_by_lang: countBy(selected, (row) => row.source_lang),
    rejected_by_reason: countBy(rejected, (row) => row.reason)
  },
  selected_count: selected.length,
  selected,
  rejected
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2))

function inspect(row) {
  const review = row?.candidate_evidence_review
  if (review?.decision !== 'accept') return reject('source_review_not_accepted')
  if (Number(review.confidence) < confidenceThreshold) return reject('source_review_confidence_below_threshold')
  if ((review.risk_flags || []).length) return reject('source_review_has_risk_flags')
  if (!row?.sense_alignment || row.sense_alignment.status !== 'aligned') return reject('sense_not_aligned')
  if (!Number.isInteger(Number(row.first_sense_id))) return reject('missing_source_sense_id')

  if (finalGateEnabled) {
    const key = candidateKey(row)
    const gate = finalGate.get(key)
    if (!gate) return reject('not_accepted_by_final_gate')
    if (!generationOutputIsComplete(gate.generation, row)) return reject('final_generation_incomplete')
    return acceptedRow(row)
  }

  const preferredTerms = review.preferred_terms || {}
  const suggestedTerms = review.suggested_terms || {}
  const definitions = review.definition_contract || {}
  for (const lang of LANGS) {
    if (!cleanText(suggestedTerms[lang])) return reject(`missing_suggested_term_${lang}`)
    if (!cleanText(definitions[lang])) return reject(`missing_definition_${lang}`)
  }

  const sourceLang = String(row.source_lang || '')
  if (!LANGS.includes(sourceLang)) return reject('invalid_source_language')
  if (normalizeTerm(suggestedTerms[sourceLang], sourceLang) !== normalizeTerm(row.word, sourceLang)) {
    return reject('source_term_drift')
  }
  if (normalizeTerm(preferredTerms[sourceLang], sourceLang) !== normalizeTerm(row.word, sourceLang)) {
    return reject('source_preferred_term_not_exact')
  }

  for (const lang of LANGS) {
    if (lang === sourceLang) continue
    const hints = row?.generation_hints?.[lang]?.terms || []
    if (!hints.some((term) => normalizeTerm(term, lang) === normalizeTerm(suggestedTerms[lang], lang))) {
      return reject(`suggested_term_not_in_generation_hints_${lang}`)
    }
  }

  return acceptedRow(row)
}

function acceptedRow(row) {
  return {
    ok: true,
    row: {
      ...row,
      promote_allowed: false,
      candidate_review_provenance: {
        ...(row.candidate_review_provenance || {}),
        kind: 'controlled_model_consensus',
        source_review_report: path.relative(process.cwd(), reviewPath),
        final_generation_report: finalGenerationPath
          ? path.relative(process.cwd(), finalGenerationPath)
          : null,
        deterministic_evidence_report: finalEvidencePath
          ? path.relative(process.cwd(), finalEvidencePath)
          : null,
        independent_consensus_report: finalConsensusPath
          ? path.relative(process.cwd(), finalConsensusPath)
          : null,
        publication_evidence: false,
        suggested_terms_binding: false,
        requires_deterministic_reverse_evidence: true,
        requires_generation_consensus: true,
        requires_generation_model_family: generationModelFamily,
        requires_consensus_model_family: consensusModelFamily,
        automatic_promotion: false
      }
    }
  }
}

function loadFinalGate() {
  const generation = readJson(finalGenerationPath)
  const evidence = readJson(finalEvidencePath)
  const consensus = readJson(finalConsensusPath)
  if (evidence?.policy?.require_source_reverse_evidence !== true) {
    throw new Error('Final evidence report does not require source reverse evidence')
  }
  if (consensus?.policy?.independent_model_families !== true) {
    throw new Error('Final consensus report does not certify independent model families')
  }
  if (consensus?.policy?.automatic_promotion !== false) {
    throw new Error('Final consensus report permits automatic promotion')
  }

  const generationByKey = new Map(
    (generation.generated || [])
      .filter((row) => row?.valid === true)
      .map((row) => [candidateKey(row), row])
      .filter(([key]) => key)
  )
  const evidenceByKey = new Map(
    (evidence.validations || [])
      .filter(
        (row) =>
          row?.decision === 'supported' &&
          LANGS.every((lang) => row?.languages?.[lang]?.decision === 'supported')
      )
      .map((row) => [candidateKey(row), row])
      .filter(([key]) => key)
  )
  const consensusByKey = new Map(
    (consensus.reviews || [])
      .filter(
        (row) =>
          row?.valid === true &&
          row?.decision === 'accept' &&
          row?.consensus_accepted === true &&
          Number(row?.confidence) >= Number(consensus.policy.confidence_threshold || 0.9) &&
          Array.isArray(row?.corrections) &&
          row.corrections.length === 0
      )
      .map((row) => [candidateKey(row), row])
      .filter(([key]) => key)
  )

  const gate = new Map()
  for (const [key, generated] of generationByKey) {
    if (!evidenceByKey.has(key) || !consensusByKey.has(key)) continue
    gate.set(key, {
      generation: generated,
      evidence: evidenceByKey.get(key),
      consensus: consensusByKey.get(key)
    })
  }
  return gate
}

function generationOutputIsComplete(generation, sourceRow) {
  const output = generation?.output
  if (!output || Number(output.source_sense_id) !== Number(sourceRow.first_sense_id)) return false
  if (normalizeTerm(output.source_word || generation.word, sourceRow.source_lang) !== normalizeTerm(sourceRow.word, sourceRow.source_lang)) {
    return false
  }
  return LANGS.every((lang) => {
    const localization = output.localizations?.[lang]
    return cleanText(localization?.term) && cleanText(localization?.definition)
  })
}

function candidateKey(row) {
  const sourceEntryId = Number(row?.source_entry_id)
  const sourceSenseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id)
  if (!Number.isInteger(sourceEntryId) || !Number.isInteger(sourceSenseId)) return null
  return `${sourceEntryId}:${sourceSenseId}`
}

function normalizeTerm(value, lang) {
  let text = cleanText(value).normalize('NFKC').toLocaleLowerCase(lang === 'pt-BR' ? 'pt-BR' : undefined)
  text = text.replace(/[\s\p{P}\p{S}]+/gu, '')
  return text
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function reject(reason) {
  return { ok: false, reason }
}

function countBy(rows, getter) {
  const counts = {}
  for (const row of rows) {
    const key = String(getter(row))
    counts[key] = (counts[key] || 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function optionalPath(value) {
  return value ? path.resolve(String(value)) : null
}

function required(value, name) {
  if (!value) throw new Error(`Missing --${name}`)
  return String(value)
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`Invalid numeric value: ${value}`)
  }
  return number
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
