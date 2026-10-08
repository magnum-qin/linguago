#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { bindSourceReviews, isAcceptedSourceReview } from './lib/source-consensus-binding.mjs';

const args = parseArgs(process.argv.slice(2));
const primaryPath = requiredPath(args.primary, 'primary');
const reviewerPath = requiredPath(args.reviewer, 'reviewer');
const outPath = requiredPath(args.out, 'out');
const primary = readJson(primaryPath);
const reviewer = readJson(reviewerPath);
const selectedSource = args.selected ? readJson(requiredPath(args.selected, 'selected')) : primary;
const requireTermAgreement = args['require-term-agreement'] !== 'false';
const { first: primaryReviews, second: reviewerReviews, candidates: selectedByKey } =
  bindSourceReviews(selectedSource.selected || [], primary.reviews || [], reviewer.reviews || []);
const agreed = [];
const disagreements = [];

for (const [candidateKey, primaryReview] of primaryReviews) {
  const independentReview = reviewerReviews.get(candidateKey);
  if (!independentReview) continue;
  const termMismatches = preferredTermMismatches(primaryReview, independentReview);
  const accepted =
    isAcceptedSourceReview(primaryReview) &&
    isAcceptedSourceReview(independentReview) &&
    (!requireTermAgreement || termMismatches.length === 0);
  const record = {
    source_entry_id: Number(primaryReview.source_entry_id),
    source_sense_id: Number(primaryReview.source_sense_id),
    qwen: summarize(primaryReview),
    gemma: summarize(independentReview),
    preferred_term_agreement: termMismatches.length === 0,
    preferred_term_mismatches: termMismatches
  };
  if (accepted) {
    const candidate = selectedByKey.get(candidateKey);
    if (candidate) agreed.push(withReviewerDefinitionContract(candidate, independentReview, record));
  } else {
    disagreements.push(record);
  }
}

function withReviewerDefinitionContract(candidate, independentReview, record) {
  const definitionContract = independentReview?.definition_contract;
  const completeContract =
    definitionContract &&
    typeof definitionContract === 'object' &&
    ['en', 'pt-BR', 'zh', 'ja'].every((lang) => String(definitionContract[lang] || '').trim());
  if (!completeContract) return { ...candidate, source_review_consensus: record };
  return {
    ...candidate,
    candidate_evidence_review: {
      ...(candidate.candidate_evidence_review || {}),
      definition_contract: { ...definitionContract },
      definition_contract_source: 'independent_reviewer'
    },
    source_review_consensus: {
      ...record,
      definition_contract_source: 'independent_reviewer'
    }
  };
}

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  primary_review: relative(primaryPath),
  independent_review: relative(reviewerPath),
  selected_source: args.selected ? relative(path.resolve(args.selected)) : relative(primaryPath),
  policy: {
    require_both_valid: true,
    require_both_approved: true,
    require_preferred_term_agreement: requireTermAgreement,
    llm_agreement_is_not_dictionary_evidence: true,
    automatic_promotion: false
  },
  summary: {
    primary_reviews: primaryReviews.size,
    independent_reviews: reviewerReviews.size,
    agreed: agreed.length,
    disagreements: disagreements.length,
    dual_approved_but_term_disagreed: disagreements.filter(
      (row) => row.qwen.approved && row.gemma.approved && !row.preferred_term_agreement
    ).length
  },
  selected_count: agreed.length,
  selected: agreed,
  disagreements
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), summary: output.summary }, null, 2));

function summarize(row) {
  return {
    valid: row.valid === true,
    approved: row.approved === true,
    decision: row.decision || null,
    confidence: Number(row.confidence) || null,
    reason: row.reason || null,
    endpoint: row.endpoint || null,
    preferred_terms: row.preferred_terms || null,
    definition_contract: row.definition_contract || null
  };
}

function preferredTermMismatches(primaryReview, independentReview) {
  return ['en', 'pt-BR', 'zh', 'ja']
    .filter(
      (lang) =>
        normalizeTerm(primaryReview?.preferred_terms?.[lang]) !==
        normalizeTerm(independentReview?.preferred_terms?.[lang])
    )
    .map((lang) => ({
      lang,
      primary: primaryReview?.preferred_terms?.[lang] ?? null,
      reviewer: independentReview?.preferred_terms?.[lang] ?? null
    }));
}

function normalizeTerm(value) {
  return String(value || '').normalize('NFKC').trim().toLocaleLowerCase();
}

function key(row) {
  return `${Number(row.source_entry_id)}:${Number(row.source_sense_id ?? row.first_sense_id)}`;
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    const next = argv[index + 1];
    parsed[name] = next && !next.startsWith('--') ? argv[++index] : true;
  }
  return parsed;
}
