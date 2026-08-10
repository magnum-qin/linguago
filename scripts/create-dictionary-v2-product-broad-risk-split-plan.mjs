import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REVIEW = 'logs/product-broad-risk-llm-review-20-20260625.json';
const DEFAULT_TRIAGE = 'logs/product-broad-risk-triage-20260625.json';
const DEFAULT_OUT = 'logs/product-broad-risk-split-plan-20260625.json';
const LANGS = ['en', 'zh', 'ja', 'pt-BR'];

const args = parseArgs(process.argv.slice(2));
const reviewPath = path.resolve(args.review || DEFAULT_REVIEW);
const triagePath = path.resolve(args.triage || DEFAULT_TRIAGE);
const outPath = path.resolve(args.out || DEFAULT_OUT);
const markdownPath = outPath.replace(/\.json$/u, '.md');
const confidenceThreshold = Number(args['confidence-threshold'] || 0.85);

if (!fs.existsSync(reviewPath)) throw new Error(`Review report not found: ${reviewPath}`);
if (!fs.existsSync(triagePath)) throw new Error(`Triage report not found: ${triagePath}`);
if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) {
  throw new Error(`Invalid --confidence-threshold: ${args['confidence-threshold']}`);
}

const review = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
const triage = JSON.parse(fs.readFileSync(triagePath, 'utf8'));
const triageBySenseId = new Map((triage.rows || []).map((row) => [Number(row.sense_id), row]));
const llmCandidateIds = new Set((triage.llm_candidate_sense_ids || []).map(Number));

const rows = [];
for (const row of review.reviews || []) {
  const senseId = Number(row.sense_id);
  const triageRow = triageBySenseId.get(senseId) || null;
  const validation = validateReviewRow(row, triageRow, llmCandidateIds, confidenceThreshold);
  rows.push({
    sense_id: senseId,
    entry_id: row.entry_id ?? triageRow?.entry_id ?? null,
    headword: row.headword ?? triageRow?.headword ?? null,
    primary_lang: row.primary_lang ?? triageRow?.primary_lang ?? null,
    frequency_rank: row.frequency_rank ?? triageRow?.frequency_rank ?? null,
    decision: row.decision || null,
    confidence: row.confidence ?? null,
    status: validation.ok ? 'approved_candidate' : 'excluded',
    exclusion_reasons: validation.errors,
    reason: row.reason || '',
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    original: triageRow
      ? {
          part_of_speech: triageRow.part_of_speech,
          gloss_key: triageRow.gloss_key,
          localizations: triageRow.localizations,
          triage: triageRow.triage
        }
      : null,
    proposed_senses: validation.ok ? normalizeSuggestedSenses(row.suggested_senses || []) : []
  });
}

rows.sort((a, b) => {
  return (
    statusPriority(a.status) - statusPriority(b.status) ||
    Number(a.frequency_rank ?? 999999) - Number(b.frequency_rank ?? 999999) ||
    Number(a.sense_id) - Number(b.sense_id)
  );
});

const approved = rows.filter((row) => row.status === 'approved_candidate');
const excluded = rows.filter((row) => row.status === 'excluded');
const output = {
  ok: true,
  created_at: new Date().toISOString(),
  review: path.relative(process.cwd(), reviewPath),
  triage: path.relative(process.cwd(), triagePath),
  confidence_threshold: confidenceThreshold,
  summary: {
    reviewed: rows.length,
    approved_candidates: approved.length,
    excluded: excluded.length,
    by_exclusion_reason: countReasons(excluded)
  },
  approved_candidates: approved,
  excluded,
  next_step:
    'Sample approved_candidates manually, then implement a deterministic database repair script or product override entries. Do not apply this plan directly.'
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
fs.writeFileSync(markdownPath, renderMarkdown(output), 'utf8');

console.log(
  JSON.stringify(
    {
      ok: true,
      out: path.relative(process.cwd(), outPath),
      markdown: path.relative(process.cwd(), markdownPath),
      summary: output.summary
    },
    null,
    2
  )
);

function validateReviewRow(row, triageRow, llmCandidateIds, threshold) {
  const errors = [];
  if (!row.valid) errors.push('invalid_llm_review');
  if (row.decision !== 'split') errors.push('not_split_decision');
  if (!Number.isFinite(Number(row.confidence)) || Number(row.confidence) < threshold)
    errors.push('below_confidence_threshold');
  if (!Array.isArray(row.suggested_senses) || row.suggested_senses.length < 2) errors.push('missing_split_suggestions');
  if (!triageRow) errors.push('not_found_in_triage');
  if (!llmCandidateIds.has(Number(row.sense_id))) errors.push('not_current_llm_split_candidate');

  const seenLabels = new Set();
  for (const [index, sense] of (row.suggested_senses || []).entries()) {
    const label = cleanText(sense.label);
    if (!label) errors.push(`suggested_sense_${index + 1}_missing_label`);
    if (label && seenLabels.has(label.toLowerCase())) errors.push(`suggested_sense_${index + 1}_duplicate_label`);
    seenLabels.add(label.toLowerCase());
    for (const lang of LANGS) {
      const loc = sense.localizations?.[lang];
      if (!loc || typeof loc !== 'object') {
        errors.push(`suggested_sense_${index + 1}_missing_${lang}`);
        continue;
      }
      if (!cleanText(loc.term)) errors.push(`suggested_sense_${index + 1}_${lang}_missing_term`);
      if (!cleanText(loc.definition)) errors.push(`suggested_sense_${index + 1}_${lang}_missing_definition`);
      if ((lang === 'zh' || lang === 'ja') && !('reading' in loc)) {
        errors.push(`suggested_sense_${index + 1}_${lang}_missing_reading_field`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function normalizeSuggestedSenses(senses) {
  return senses.map((sense, index) => ({
    proposed_order: index + 1,
    label: cleanText(sense.label),
    part_of_speech: cleanText(sense.part_of_speech) || null,
    localizations: Object.fromEntries(
      LANGS.map((lang) => {
        const loc = sense.localizations?.[lang] || {};
        return [
          lang,
          {
            term: cleanText(loc.term),
            reading: lang === 'zh' || lang === 'ja' ? cleanNullable(loc.reading) : null,
            pronunciation: null,
            definition: cleanText(loc.definition)
          }
        ];
      })
    )
  }));
}

function renderMarkdown(output) {
  const lines = [
    '# Product Broad-Risk Split Plan',
    '',
    `Generated: ${output.created_at}`,
    '',
    '## Summary',
    '',
    `- Reviewed rows: ${output.summary.reviewed}`,
    `- Approved candidates: ${output.summary.approved_candidates}`,
    `- Excluded: ${output.summary.excluded}`,
    `- Exclusion reasons: ${JSON.stringify(output.summary.by_exclusion_reason)}`,
    '',
    '## Approved Candidates',
    ''
  ];

  for (const row of output.approved_candidates) {
    lines.push(
      `### ${row.frequency_rank ?? 'n/a'} ${row.headword} sense ${row.sense_id}`,
      '',
      `- confidence: ${row.confidence}`,
      `- reason: ${row.reason}`,
      `- original gloss: ${abbreviate(row.original?.gloss_key, 500)}`,
      `- original en/zh/ja/pt: ${formatOriginalTerms(row)}`,
      ''
    );
    for (const sense of row.proposed_senses) {
      lines.push(
        `#### ${sense.proposed_order}. ${sense.label}`,
        '',
        `- pos: ${sense.part_of_speech || ''}`,
        `- en: ${sense.localizations.en.term} - ${sense.localizations.en.definition}`,
        `- zh: ${sense.localizations.zh.term} (${sense.localizations.zh.reading || ''}) - ${sense.localizations.zh.definition}`,
        `- ja: ${sense.localizations.ja.term} (${sense.localizations.ja.reading || ''}) - ${sense.localizations.ja.definition}`,
        `- pt-BR: ${sense.localizations['pt-BR'].term} - ${sense.localizations['pt-BR'].definition}`,
        ''
      );
    }
  }

  lines.push('## Excluded', '');
  for (const row of output.excluded) {
    lines.push(
      `- ${row.frequency_rank ?? 'n/a'} ${row.headword} sense ${row.sense_id}: ${row.exclusion_reasons.join(', ')}`
    );
  }

  return lines.join('\n');
}

function countReasons(rows) {
  const counts = {};
  for (const row of rows) {
    for (const reason of row.exclusion_reasons) counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function formatOriginalTerms(row) {
  return LANGS.map((lang) => row.original?.localizations?.[lang]?.term || '').join(' | ');
}

function statusPriority(status) {
  return status === 'approved_candidate' ? 0 : 1;
}

function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function cleanNullable(value) {
  const text = cleanText(value);
  return text || null;
}

function abbreviate(value, maxLength) {
  if (value == null) return '';
  const text = String(value).replace(/\s+/gu, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}...`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
