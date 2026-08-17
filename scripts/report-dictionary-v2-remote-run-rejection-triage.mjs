#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const runDir = requiredDir(args['run-dir']);
const outPath = path.resolve(
  args.out || path.join(runDir, '27-rejection-triage.json')
);

const qwen = read('01-qwen-source-review.json');
const gemma = read('03-gemma-source-review.json');
const reverse = read('04b-source-consensus-reverse-evidence.json');
const semantic = read('04d-semantic-preview-gemma.json');
const ready = read('04f-generation-ready-candidates.json');
const generation = read('05-qwen-generation.json');
const finalReview = read('07-final-gemma.json');

const qwenByKey = index(qwen.reviews);
const gemmaByKey = index(gemma.reviews);
const reverseByKey = index(reverse.validations);
const semanticByKey = index(semantic.reviews);
const jmdictRejectedByKey = index(ready.jmdict_preflight_rejected);
const generatedByKey = index(generation.generated);
const skippedByKey = index(generation.skipped_preview);
const finalByKey = index(finalReview.reviews);

const classified = [];
for (const candidate of qwen.reviews || []) {
  const key = candidateKey(candidate);
  const base = summarize(candidate);
  const qwenReview = qwenByKey.get(key);
  if (!approved(qwenReview)) {
    classified.push(result(base, 'qwen_source_review', reviewDisposition(qwenReview), qwenReview));
    continue;
  }

  const gemmaReview = gemmaByKey.get(key);
  if (!approved(gemmaReview)) {
    classified.push(result(base, 'gemma_source_review', reviewDisposition(gemmaReview), gemmaReview));
    continue;
  }

  const reverseReview = reverseByKey.get(key);
  if (reverseReview?.decision !== 'supported') {
    classified.push(result(base, 'source_reverse_evidence', reverseReview?.reason || 'not_supported', reverseReview));
    continue;
  }

  const semanticReview = semanticByKey.get(key);
  if (!semanticReview?.consensus_accepted) {
    classified.push(result(base, 'semantic_preview', reviewDisposition(semanticReview), semanticReview));
    continue;
  }

  const jmdictReject = jmdictRejectedByKey.get(key);
  if (jmdictReject) {
    classified.push(result(base, 'jmdict_preflight', jmdictReject.reason || 'reading_rejected', jmdictReject));
    continue;
  }

  const skipped = skippedByKey.get(key);
  if (skipped) {
    classified.push(result(base, 'generation_preflight', skipped.reason || 'skipped', skipped));
    continue;
  }

  const generated = generatedByKey.get(key);
  if (!generated?.valid) {
    classified.push(result(base, 'qwen_generation', generationDisposition(generated), generated));
    continue;
  }

  const final = finalByKey.get(key);
  if (!final?.consensus_accepted) {
    classified.push(result(base, 'final_gemma_review', reviewDisposition(final), final));
    continue;
  }

  classified.push(result(base, 'accepted', 'accepted', final));
}

const stages = countBy(classified, (row) => row.stage);
const dispositions = countBy(classified, (row) => `${row.stage}:${row.disposition}`);
const accepted = classified.filter((row) => row.stage === 'accepted');
const rejected = classified.filter((row) => row.stage !== 'accepted');
const deterministicRepair = rejected.filter((row) =>
  row.stage === 'jmdict_preflight' || row.stage === 'qwen_generation'
);
const evidenceAcquisition = rejected.filter((row) => row.stage === 'source_reverse_evidence');
const semanticRepair = rejected.filter((row) =>
  row.stage === 'semantic_preview' || row.stage === 'final_gemma_review'
);
const sourceCandidateRebuild = rejected.filter((row) =>
  row.stage === 'qwen_source_review' || row.stage === 'gemma_source_review'
);

const inputCount = qwen.reviews?.length || 0;
const partitionCount = accepted.length + rejected.length;
const output = {
  ok: inputCount > 0 && inputCount === partitionCount,
  generated_at: new Date().toISOString(),
  run_dir: relative(runDir),
  policy: {
    first_exit_stage_is_exclusive: true,
    remote_model_calls: false,
    product_database_write: false,
    retry_without_changed_input: false
  },
  summary: {
    input: inputCount,
    accepted: accepted.length,
    remaining: rejected.length,
    partition_count: partitionCount,
    stages,
    dispositions,
    action_buckets: {
      deterministic_repair: deterministicRepair.length,
      evidence_acquisition: evidenceAcquisition.length,
      semantic_contract_repair: semanticRepair.length,
      source_candidate_rebuild: sourceCandidateRebuild.length,
      already_complete_or_skipped: rejected.filter((row) => row.stage === 'generation_preflight').length
    }
  },
  deterministic_repair: deterministicRepair,
  evidence_acquisition: evidenceAcquisition,
  semantic_contract_repair: semanticRepair,
  source_candidate_rebuild: sourceCandidateRebuild,
  accepted,
  classified
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ok: output.ok, ...output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function read(name) {
  const filePath = path.join(runDir, name);
  if (!fs.existsSync(filePath)) throw new Error(`Missing pipeline stage: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function result(base, stage, disposition, detail) {
  return {
    ...base,
    stage,
    disposition,
    expected_readings: detail?.expected_readings || [],
    ja_term: detail?.ja_term || null,
    risk_flags: detail?.risk_flags || [],
    errors: detail?.errors || [],
    reason: detail?.reason || null,
    corrections: detail?.corrections || []
  };
}

function summarize(row) {
  return {
    candidate_key: candidateKey(row),
    source_entry_id: Number(row?.source_entry_id ?? row?.output?.source_entry_id),
    source_sense_id: Number(row?.source_sense_id ?? row?.output?.source_sense_id),
    word: row?.word || null,
    source_lang: row?.source_lang || null,
    frequency_rank: Number(row?.frequency_rank) || null,
    anchor: row?.english_anchor || row?.anchor || row?.gloss_key || null
  };
}

function approved(row) {
  return Boolean(row?.valid && (row?.approved === true || row?.decision === 'accept'));
}

function reviewDisposition(row) {
  if (!row) return 'missing_stage_result';
  if (!row.valid) return 'invalid_response';
  if (row.decision === 'manual_review' || row.decision === 'manual') return 'manual_review';
  return row.decision || (row.approved ? 'accept' : 'reject');
}

function generationDisposition(row) {
  if (!row) return 'missing_generation_result';
  if (row.infrastructure_failure) return 'infrastructure_failure';
  if (row.errors?.length) return row.errors.join('|');
  return 'validation_rejected';
}

function index(rows = []) {
  return new Map(rows.map((row) => [candidateKey(row), row]));
}

function candidateKey(row) {
  return `${Number(row?.source_entry_id ?? row?.output?.source_entry_id)}:${Number(
    row?.source_sense_id ?? row?.output?.source_sense_id
  )}`;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'none');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function requiredDir(value) {
  if (!value) throw new Error('Missing --run-dir <path>');
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`Run directory not found: ${resolved}`);
  }
  return resolved;
}

function relative(value) {
  return path.relative(process.cwd(), value) || '.';
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
      index += 1;
    } else {
      parsed[key] = 'true';
    }
  }
  return parsed;
}
