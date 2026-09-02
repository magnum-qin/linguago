#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const LANGS = ['en', 'pt-BR', 'zh', 'ja']
const KANA_RE = /[\u3040-\u30ff]/u
const args = parseArgs(process.argv.slice(2))
const reviewPath = path.resolve(required(args.review, 'review'))
const outPath = path.resolve(required(args.out, 'out'))
const confidenceThreshold = boundedNumber(args['confidence-threshold'], 0.95, 0, 1)
const generationModelFamily = String(args['generation-model-family'] || 'qwen').trim().toLowerCase()
const consensusModelFamily = String(args['consensus-model-family'] || 'gemma').trim().toLowerCase()
const allowUnhintedSuggestions = args['allow-unhinted-suggestions'] === 'true'
const allowJaNoDerivation = args['allow-ja-no-derivation'] === 'true'
const bindEvidenceValidatedSuggestions = args['bind-evidence-validated-suggestions'] === 'true'
const allowResolvedRiskFlags = args['allow-resolved-risk-flags'] === 'true'
const minTargetHintFamilies = boundedInteger(args['min-target-hint-families'], 0, 0)
const excludedSourceEntryIds = new Set(
  String(args['exclude-source-entry-ids'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger)
)
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
const evidenceValidatedKeys = bindEvidenceValidatedSuggestions
  ? loadEvidenceValidatedKeys(report)
  : null
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
    allow_unhinted_suggestions: allowUnhintedSuggestions,
    allow_ja_no_derivation: allowJaNoDerivation,
    minimum_target_hint_families: minTargetHintFamilies,
    bind_evidence_validated_suggestions: bindEvidenceValidatedSuggestions,
    allow_resolved_risk_flags: allowResolvedRiskFlags,
    excluded_source_entry_ids: [...excludedSourceEntryIds].sort((a, b) => a - b),
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
  rejected,
  ...(finalGateEnabled
    ? {
        derived_from: {
          generation: path.relative(process.cwd(), finalGenerationPath),
          evidence: path.relative(process.cwd(), finalEvidencePath),
          consensus: path.relative(process.cwd(), finalConsensusPath)
        },
        generated: selected
          .map((row) => finalGate.get(candidateKey(row))?.generation)
          .filter(Boolean)
      }
    : {})
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2))

function inspect(row) {
  if (excludedSourceEntryIds.has(Number(row?.source_entry_id))) return reject('manual_exclusion')
  const review = row?.candidate_evidence_review
  if (review?.decision !== 'accept') return reject('source_review_not_accepted')
  if (Number(review.confidence) < confidenceThreshold) return reject('source_review_confidence_below_threshold')
  const riskFlags = Array.isArray(review.risk_flags) ? review.risk_flags : []
  if (riskFlags.length && !(allowResolvedRiskFlags && riskFlags.every(isResolvedRiskFlag))) {
    return reject('source_review_has_risk_flags')
  }
  if (!hasLockedSourceSense(row)) return reject('sense_not_aligned')
  if (!Number.isInteger(Number(row.first_sense_id))) return reject('missing_source_sense_id')
  if (evidenceValidatedKeys && !evidenceValidatedKeys.has(candidateKey(row))) {
    return reject('suggested_terms_not_reverse_evidence_supported')
  }

  if (finalGateEnabled) {
    const key = candidateKey(row)
    const gate = finalGate.get(key)
    if (!gate) return reject('not_accepted_by_final_gate')
    if (!generationOutputIsComplete(gate.generation, row)) return reject('final_generation_incomplete')
    if (generatedLocalizationHasScriptMismatch(gate.generation)) {
      return reject('final_generation_localization_script_mismatch')
    }
    return acceptedRow(row)
  }

  const preferredTerms = review.preferred_terms || {}
  const sourceLang = String(row.source_lang || '')
  if (!LANGS.includes(sourceLang)) return reject('invalid_source_language')
  const suggestedTerms = {
    ...(review.suggested_terms || {}),
    [sourceLang]: preferredTerms[sourceLang] || row.word
  }
  const definitions = review.definition_contract || {}
  for (const lang of LANGS) {
    if (!cleanText(suggestedTerms[lang])) return reject(`missing_suggested_term_${lang}`)
    if (!cleanText(definitions[lang])) return reject(`missing_definition_${lang}`)
  }

  if (normalizeTerm(suggestedTerms[sourceLang], sourceLang) !== normalizeTerm(row.word, sourceLang)) {
    return reject('source_term_drift')
  }
  if (normalizeTerm(preferredTerms[sourceLang], sourceLang) !== normalizeTerm(row.word, sourceLang)) {
    return reject('source_preferred_term_not_exact')
  }

  for (const lang of LANGS) {
    if (lang === sourceLang) continue
    const hints = row?.generation_hints?.[lang]?.terms || []
    if (
      !allowUnhintedSuggestions &&
      !hints.some((term) => generationHintMatches(term, suggestedTerms[lang], lang))
    ) {
      return reject(`suggested_term_not_in_generation_hints_${lang}`)
    }
    if (
      minTargetHintFamilies > 0 &&
      lang !== 'en' &&
      (row?.generation_hints?.[lang]?.evidence_families || []).length < minTargetHintFamilies
    ) {
      return reject(`insufficient_generation_hint_families_${lang}`)
    }
  }

  return acceptedRow(row)
}

function generatedLocalizationHasScriptMismatch(generation) {
  const zh = generation?.output?.localizations?.zh
  return KANA_RE.test(cleanText(zh?.term)) || KANA_RE.test(cleanText(zh?.definition))
}

function hasLockedSourceSense(row) {
  if (row?.sense_alignment?.status === 'aligned') return true

  const selection = row?.daily_sense_selection
  const firstSenseId = Number(row?.first_sense_id)
  const selectedAlternative = (selection?.alternatives || []).find(
    (alternative) => Number(alternative?.id) === firstSenseId
  )
  const sourceConsensus = row?.source_review_consensus
  const consensusLocked =
    sourceConsensus?.qwen?.approved === true &&
    sourceConsensus?.gemma?.approved === true &&
    sourceConsensus?.preferred_term_agreement === true &&
    Number(row?.reverse_evidence_prefilter?.target_coverage_count || 0) >= 3
  const additionalSenseLocked =
    selection?.policy === 'native_dictionary_additional_unlinked_sense' &&
    selection?.requires_independent_source_review === true &&
    Number.isInteger(Number(row?.product_entry_id)) &&
    Number.isInteger(firstSenseId) &&
    selectedAlternative?.blocked_reason == null &&
    selectedAlternative?.linked_product_sense == null &&
    authoritativeAdditionalSenseSource(row?.source_lang, selectedAlternative?.source) &&
    String(row?.candidate_key || '') === `${Number(row?.source_entry_id)}:${firstSenseId}`
  if (additionalSenseLocked) return true
  return (
    selection?.policy === 'native_dictionary_then_daily_semantics' &&
    selection?.requires_independent_source_review === true &&
    Number.isInteger(firstSenseId) &&
    selectedAlternative?.blocked_reason == null &&
    (
      ['cc-cedict', 'jmdict', 'kaikki-zh'].includes(String(selectedAlternative?.source || '')) ||
      consensusLocked
    ) &&
    String(row?.candidate_key || '') === `${Number(row?.source_entry_id)}:${firstSenseId}`
  )
}

function authoritativeAdditionalSenseSource(lang, value) {
  const source = String(value || '').trim().toLowerCase()
  if (lang === 'zh') return source.includes('cc-cedict')
  if (lang === 'ja') return source.includes('jmdict')
  if (lang === 'pt-BR') return source.includes('freedict') || source.includes('dicionario')
  if (lang === 'en') return source.includes('freedict-eng-por') || source.includes('ecdict')
  return false
}

function isResolvedRiskFlag(value) {
  const flag = String(value || '').trim()
  if (!flag) return false
  const resolved = /(excluded|ignored|corrected|rejected in favor|but (?:the )?(?:selected|preferred|primary|precise|correct)|also (?:present|listed).*(?:correct|align)|provided as an alternative.*specific|in context.*(?:correct|unambiguous)|context (?:implies|disambiguates)|given the (?:explicit )?(?:gloss|anchor|context)|specific gloss|can also mean|polysem|ambiguous|secondary meaning|associated with.*but|context.*acceptable|context.*accepted)/iu
  const registerOnly = /\b(colloquial|archaic|loanword origin|katakana loan|spelling variant|outdated terminology)\b/iu
  const unresolved = /not strict|wrong|mismatch|broader than|narrower than|hypernym|subset|different sense|implies .* rather|usually means .*not|slightly narrower|wrong part|noun, source|noun form for verb|specific to .* while|female-specific|singular|plural/iu
  return (resolved.test(flag) || registerOnly.test(flag)) && !unresolved.test(flag)
}

function acceptedRow(row) {
  const review = row?.candidate_evidence_review || {}
  const sourceLang = String(row.source_lang || '')
  const normalizedReview = {
    ...review,
    suggested_terms: {
      ...(review.suggested_terms || {}),
      [sourceLang]: review?.preferred_terms?.[sourceLang] || row.word
    }
  }
  const boundReview = bindEvidenceValidatedSuggestions
    ? {
        ...normalizedReview,
        preferred_term_policy: 'reverse_evidence_validated_suggestion',
        preferred_terms: { ...normalizedReview.suggested_terms }
      }
    : normalizedReview
  return {
    ok: true,
    row: {
      ...row,
      candidate_evidence_review: boundReview,
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
        suggested_terms_binding: bindEvidenceValidatedSuggestions,
        suggested_terms_reverse_evidence_validated: bindEvidenceValidatedSuggestions,
        unhinted_suggestions_allowed: allowUnhintedSuggestions,
        requires_deterministic_reverse_evidence: true,
        requires_generation_consensus: true,
        requires_generation_model_family: generationModelFamily,
        requires_consensus_model_family: consensusModelFamily,
        automatic_promotion: false
      }
    }
  }
}

function loadEvidenceValidatedKeys(sourceReport) {
  const evidencePathValue = String(sourceReport?.reverse_evidence_report || '').trim()
  if (!evidencePathValue) {
    throw new Error('--bind-evidence-validated-suggestions requires a reverse-evidence supported report')
  }
  const evidencePath = path.resolve(evidencePathValue)
  const evidence = readJson(evidencePath)
  return new Set(
    (evidence.validations || [])
      .filter((row) => row?.decision === 'supported')
      .map((row) => `${Number(row.source_entry_id)}:${Number(row.source_sense_id)}`)
  )
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

  const generationRows = Array.isArray(generation.generated)
    ? generation.generated
    : Array.isArray(generation.replayed)
      ? generation.replayed
      : []
  const generationByKey = new Map(
    generationRows
      .filter((row) => row?.valid === true)
      .map((row) => [candidateKey(row), row])
      .filter(([key]) => key)
  )
  const evidenceByKey = new Map(
    (evidence.validations || [])
      .filter(
        (row) =>
          row?.decision === 'supported' &&
          finalEvidenceQualificationIsPublishable(row, evidence.policy)
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

function finalEvidenceQualificationIsPublishable(row, policy = {}) {
  const decisions = LANGS.map((lang) => row?.languages?.[lang]?.decision)
  if (decisions.some((decision) => decision === 'unsupported')) return false
  const supported = decisions.filter((decision) => decision === 'supported').length
  const manual = decisions.filter((decision) => decision === 'manual_review').length
  if (manual === 0) return supported === LANGS.length

  const qualification = row?.evidence_qualification
  if (qualification?.mode !== 'supported_with_limited_manual_evidence') return false
  const maxManual = Number(policy?.max_manual_target_languages ?? 1)
  const minSupported = Number(policy?.min_supported_target_languages ?? 3)
  return (
    maxManual > 0 &&
    minSupported > 0 &&
    manual <= maxManual &&
    supported >= minSupported &&
    Number(qualification.manual_target_languages) === manual &&
    Number(qualification.supported_target_languages) === supported
  )
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

function generationHintMatches(hint, suggestion, lang) {
  const normalizedHint = normalizeTerm(hint, lang)
  const normalizedSuggestion = normalizeTerm(suggestion, lang)
  if (normalizedHint === normalizedSuggestion) return true
  return allowJaNoDerivation && lang === 'ja' && normalizedSuggestion === `${normalizedHint}の`
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

function boundedInteger(value, fallback, minimum) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`Invalid integer value: ${value}`)
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
