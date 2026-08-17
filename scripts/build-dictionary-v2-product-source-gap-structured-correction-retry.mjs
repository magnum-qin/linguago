import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const consensusPath = requiredPath(args.consensus, 'consensus');
const outPath = requiredPath(args.out, 'out');
const generationPath = args.generation ? path.resolve(args.generation) : null;
const allowedCorrectionFields = new Set(
  String(args['correction-fields'] || 'term,definition,reading,pronunciation')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
const report = readJson(reportPath);
const consensus = readJson(consensusPath);
const generation = generationPath ? readJson(generationPath) : null;

if (consensus?.policy?.independent_model_families !== true) {
  throw new Error('Consensus report does not certify independent model families');
}

const candidates = new Map((report.selected || []).map((row) => [candidateKey(row), row]));
const generatedEntries = new Map(
  (generation?.generated || [])
    .filter((row) => row?.valid === true && row?.output?.localizations)
    .map((row) => [candidateKey(row), row.output])
    .filter(([key]) => key)
);
const selected = [];
const rejected = [];

for (const review of consensus.reviews || []) {
  if (review?.valid !== true || review?.consensus_accepted === true) continue;
  const key = candidateKey(review);
  const candidate = candidates.get(key);
  if (!candidate) {
    rejected.push(rejection(review, 'missing_candidate'));
    continue;
  }
  const corrections = Array.isArray(review.corrections) ? review.corrections : [];
  const inspected = inspectCorrections(candidate, corrections, generatedEntries.get(key));
  if (!inspected.ok) {
    rejected.push(rejection(review, inspected.reason));
    continue;
  }
  selected.push(applyCorrections(candidate, review, inspected.corrections, generatedEntries.get(key)));
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  consensus_report: relative(consensusPath),
  policy: {
    structured_replacements_only: true,
    allowed_correction_fields: [...allowedCorrectionFields],
    generated_terms_immutable: Boolean(generationPath),
    source_term_drift_forbidden: true,
    ambiguous_replacements_forbidden: true,
    replacement_is_not_publication_evidence: true,
    require_deterministic_reverse_evidence_after_generation: true,
    require_independent_no_correction_consensus_after_generation: true,
    automatic_promotion: false
  },
  summary: {
    consensus_rejected: (consensus.reviews || []).filter(
      (row) => row?.valid === true && row?.consensus_accepted !== true
    ).length,
    selected: selected.length,
    rejected: rejected.length,
    rejected_by_reason: countBy(rejected, (row) => row.reason)
  },
  selected_count: selected.length,
  selected,
  rejected
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), summary: output.summary }, null, 2));

function inspectCorrections(candidate, corrections, generatedEntry) {
  if (!corrections.length) return { ok: false, reason: 'missing_structured_correction' };
  if (generationPath && !generatedEntry) return { ok: false, reason: 'missing_generated_entry' };
  const accepted = [];
  for (const correction of corrections) {
    if (!correction || typeof correction !== 'object' || Array.isArray(correction)) {
      return { ok: false, reason: 'legacy_or_invalid_correction' };
    }
    const language = String(correction.language || '');
    const field = String(correction.field || '');
    if (!allowedCorrectionFields.has(field)) return { ok: false, reason: `excluded_${field}_correction` };
    const replacement = typeof correction.replacement === 'string'
      ? correction.replacement.trim()
      : '';
    if (!LANGS.includes(language)) return { ok: false, reason: 'non_language_specific_correction' };
    if (!['term', 'definition', 'reading', 'pronunciation'].includes(field)) {
      return { ok: false, reason: 'non_field_correction' };
    }
    if (!replacement) return { ok: false, reason: 'missing_safe_replacement' };
    const current = typeof correction.current === 'string' ? correction.current.trim() : '';
    if (current && normalizeTerm(current, language) === normalizeTerm(replacement, language)) {
      return { ok: false, reason: 'no_op_replacement' };
    }
    if (field !== 'definition' && /\s(?:\/|or)\s|[|;]/iu.test(replacement)) {
      return { ok: false, reason: 'ambiguous_replacement' };
    }
    if (
      field === 'term' &&
      language === candidate.source_lang &&
      normalizeTerm(replacement, language) !== normalizeTerm(candidate.word, language)
    ) {
      return { ok: false, reason: 'source_term_drift' };
    }
    accepted.push({ ...correction, language, field, replacement });
  }
  return { ok: true, corrections: accepted };
}

function applyCorrections(candidate, review, corrections, generatedEntry) {
  const next = structuredClone(candidate);
  next.latest_errors = ['structured_consensus_correction_retry'];
  next.latest_quality_review_reason = review.reason || null;
  next.latest_quality_review_errors = corrections.map(
    (item) => `${item.language}.${item.field}: ${item.current} -> ${item.replacement}`
  );
  next.candidate_evidence_review = next.candidate_evidence_review || {};
  next.candidate_evidence_review.suggested_terms = {
    ...(next.candidate_evidence_review.suggested_terms || {})
  };
  next.candidate_evidence_review.preferred_terms = {
    ...(next.candidate_evidence_review.preferred_terms || {})
  };
  next.candidate_evidence_review.definition_contract = {
    ...(next.candidate_evidence_review.definition_contract || {})
  };
  next.generation_hints = { ...(next.generation_hints || {}) };

  if (generatedEntry?.localizations) {
    for (const lang of LANGS) {
      const term = String(generatedEntry.localizations?.[lang]?.term || '').trim();
      if (!term) continue;
      next.candidate_evidence_review.preferred_terms[lang] = term;
      next.generation_hints[lang] = {
        ...(next.generation_hints[lang] || {}),
        terms: [term],
        provenance: 'immutable:reverse-supported-generation',
        evidence_families: next.generation_hints?.[lang]?.evidence_families || []
      };
    }
  }

  for (const correction of corrections) {
    if (correction.field === 'term') {
      next.candidate_evidence_review.suggested_terms[correction.language] = correction.replacement;
      next.candidate_evidence_review.preferred_terms[correction.language] = correction.replacement;
      next.generation_hints[correction.language] = {
        ...(next.generation_hints[correction.language] || {}),
        terms: [correction.replacement],
        provenance: 'gemma_consensus_correction_pending_reverse_validation',
        evidence_families: []
      };
    } else if (correction.field === 'definition') {
      next.candidate_evidence_review.definition_contract[correction.language] = correction.replacement;
    }
  }

  next.structured_correction_retry = {
    consensus_report: relative(consensusPath),
    reviewer_model: consensus.policy.reviewer_model,
    corrections,
    immutable_terms: generatedEntry?.localizations
      ? Object.fromEntries(LANGS.map((lang) => [lang, generatedEntry.localizations?.[lang]?.term]).filter(([, value]) => value))
      : null,
    publication_evidence: false,
    requires_reverse_evidence: true,
    requires_new_consensus: true
  };
  next.promote_allowed = false;
  return next;
}

function rejection(review, reason) {
  return {
    source_entry_id: Number(review?.source_entry_id),
    source_sense_id: Number(review?.source_sense_id),
    word: review?.word || null,
    reason
  };
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(
    row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id
  );
  return Number.isInteger(entryId) && Number.isInteger(senseId) ? `${entryId}:${senseId}` : null;
}

function normalizeTerm(value, lang) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase(lang === 'pt-BR' ? 'pt-BR' : undefined)
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function countBy(rows, getter) {
  const result = {};
  for (const row of rows) {
    const key = String(getter(row));
    result[key] = (result[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
