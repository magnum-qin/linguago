#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || '.');
const runDirs = String(args['run-dirs'] || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(root, value));
const outPath = path.resolve(args.out || 'logs/product-remote-production-funnel.json');
const sampleLimit = positiveInteger(args['sample-limit'], 100);

if (!runDirs.length) throw new Error('Missing --run-dirs <dir[,dir]>');

const allRows = [];
const runs = [];
for (const runDir of runDirs) {
  const report = analyzeRun(runDir);
  runs.push(report.summary);
  allRows.push(...report.classified);
}

const stageCounts = countBy(allRows, (row) => row.stage);
const reasonCounts = countBy(allRows, (row) => `${row.stage}:${row.reason}`);
const laneCounts = countBy(allRows, (row) => row.repair_lane);
const languageCounts = countBy(allRows, (row) => row.source_lang || 'unknown');
const accepted = allRows.filter((row) => row.stage === 'accepted').length;
const output = {
  ok: runs.every((run) => run.ok) && allRows.length === sum(runs, 'input'),
  generated_at: new Date().toISOString(),
  policy: {
    first_exit_stage_is_exclusive: true,
    model_consensus_is_not_lexical_evidence: true,
    kaikki_and_wikdict_family: 'wiktionary',
    mainland_chinese_preferred: true,
    product_database_write: false,
    remote_model_calls: false
  },
  summary: {
    runs: runs.length,
    input: allRows.length,
    accepted,
    final_yield: ratio(accepted, allRows.length),
    stages: stageCounts,
    reasons: reasonCounts,
    repair_lanes: laneCounts,
    source_languages: languageCounts
  },
  runs,
  samples: sampleByBucket(allRows, sampleLimit),
  acquisition_queue: allRows.filter((row) => row.repair_lane === 'evidence_acquisition'),
  alignment_queue: allRows.filter((row) => row.repair_lane === 'source_alignment_repair'),
  classified: allRows
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: relative(outPath), ok: output.ok, ...output.summary }, null, 2));
if (!output.ok) process.exitCode = 1;

function analyzeRun(runDir) {
  requiredDir(runDir);
  const manifest = readJson(path.join(runDir, 'manifest.json'));
  const inputPath = path.resolve(root, manifest.input || '');
  const input = rowsFrom(readJson(inputPath), ['selected', 'candidates', 'entries']);
  const dailyRejected = indexByEntry(readRows(runDir, '00a-daily-primary-senses-rejected.json', ['rejected']));
  const productionRejected = indexByEntry(
    readRows(runDir, '00-production-prefilter-rejected.json', ['selected', 'rejected'])
  );
  const alignmentRejected = indexByEntry(
    readRows(runDir, '00b-source-sense-alignment-rejected.json', ['rejected'])
  );
  const alignedRows = readRows(runDir, '00b-source-sense-aligned.json', ['selected']);
  const prefilterRows = readOptionalRows(
    runDir,
    '00c-reverse-evidence-prefilter.json',
    ['selected', 'candidates', 'validations']
  );
  const prefilterDetailRows = readOptionalRows(
    runDir,
    '00c-reverse-evidence-prefilter-details.json',
    ['validations']
  );
  const prefilterEnabled = prefilterRows !== null && prefilterDetailRows !== null;
  const prefilterSelected = keySet(prefilterEnabled ? prefilterRows : alignedRows);
  const prefilterValidations = indexByCandidate(prefilterEnabled ? prefilterDetailRows : alignedRows);
  const gemma = indexByCandidate(readRows(runDir, '03-gemma-source-review.json', ['reviews']));
  const reverse = indexByCandidate(
    readRows(runDir, '04b-source-consensus-reverse-evidence.json', ['validations'])
  );
  const semantic = indexByCandidate(readRows(runDir, '04d-semantic-preview-gemma.json', ['reviews']));
  const ready = readJson(path.join(runDir, '04f-generation-ready-candidates.json'));
  const jmdictRejected = indexByCandidate(rowsFrom(ready, ['jmdict_preflight_rejected']));
  const readyKeys = keySet(rowsFrom(ready, ['selected', 'candidates', 'generation_ready']));
  const generation = indexByCandidate(readRows(runDir, '05-qwen-generation.json', ['generated']));
  const finalReview = indexByCandidate(readRows(runDir, '07-final-gemma.json', ['reviews']));
  const controlledReplay = readJson(path.join(runDir, '08-controlled-replay.json'));
  const controlledReplayKeys = keySet(rowsFrom(controlledReplay, ['selected']));
  const controlledReplayRejected = indexByCandidate(rowsFrom(controlledReplay, ['rejected']));

  const classified = input.map((candidate) => {
    const entryId = Number(candidate.source_entry_id ?? candidate.id);
    const base = summarize(candidate, manifest, runDir);
    const dailyReject = dailyRejected.get(entryId);
    if (dailyReject) return classifiedRow(base, 'daily_primary', dailyReject.reason, dailyReject);

    const productionReject = productionRejected.get(entryId);
    if (productionReject) {
      const detail = productionReject.production_prefilter || productionReject;
      return classifiedRow(base, 'production_policy', detail.reason || 'policy_rejected', detail);
    }

    const alignmentReject = alignmentRejected.get(entryId);
    if (alignmentReject) {
      const detail = alignmentReject.sense_alignment || alignmentReject;
      return classifiedRow(base, 'source_sense_alignment', detail.reason || 'alignment_rejected', detail);
    }

    const aligned = findByEntry(prefilterValidations, entryId);
    if (!aligned) return classifiedRow(base, 'source_sense_alignment', 'missing_aligned_validation', null);
    const key = candidateKey(aligned);
    base.source_sense_id = Number(aligned.source_sense_id ?? aligned.first_sense_id) || null;
    base.candidate_key = key;
    base.anchor = aligned.evidence?.anchor || aligned.anchor || null;

    if (!prefilterSelected.has(key)) {
      return classifiedRow(
        base,
        'reverse_evidence_prefilter',
        aligned.reason || aligned.decision || 'not_selected',
        aligned
      );
    }

    const sourceReview = gemma.get(key);
    if (!approved(sourceReview)) {
      return classifiedRow(base, 'gemma_source_review', reviewReason(sourceReview), sourceReview);
    }

    const reverseReview = reverse.get(key);
    if (reverseReview?.decision !== 'supported') {
      return classifiedRow(
        base,
        'source_reverse_evidence',
        reverseReview?.reason || reverseReview?.decision || 'not_supported',
        reverseReview
      );
    }

    const semanticReview = semantic.get(key);
    if (!semanticReview?.consensus_accepted) {
      return classifiedRow(base, 'semantic_preview', reviewReason(semanticReview), semanticReview);
    }

    const jmdictReject = jmdictRejected.get(key);
    if (jmdictReject) {
      return classifiedRow(base, 'jmdict_preflight', jmdictReject.reason || 'reading_rejected', jmdictReject);
    }
    if (readyKeys.size && !readyKeys.has(key)) {
      return classifiedRow(base, 'generation_preflight', 'not_generation_ready', null);
    }

    const generated = generation.get(key);
    if (!generated?.valid) {
      return classifiedRow(base, 'qwen_generation', generationReason(generated), generated);
    }

    const final = finalReview.get(key);
    if (!final?.consensus_accepted) {
      return classifiedRow(base, 'final_gemma_review', reviewReason(final), final);
    }
    if (!controlledReplayKeys.has(key)) {
      const replayReject = controlledReplayRejected.get(key);
      return classifiedRow(
        base,
        'controlled_replay_gate',
        replayReject?.reason || 'not_selected_for_controlled_replay',
        replayReject
      );
    }
    return classifiedRow(base, 'accepted', 'accepted', final);
  });

  const expectedInput = Number(manifest.summary?.input || input.length);
  return {
    summary: {
      ok: input.length === expectedInput && classified.length === input.length,
      run_id: path.basename(runDir),
      input: input.length,
      accepted: classified.filter((row) => row.stage === 'accepted').length,
      final_yield: ratio(classified.filter((row) => row.stage === 'accepted').length, input.length),
      stages: countBy(classified, (row) => row.stage),
      repair_lanes: countBy(classified, (row) => row.repair_lane),
      manifest_summary: manifest.summary || null
    },
    classified
  };
}

function classifiedRow(base, stage, reason, detail) {
  const families = unique([
    ...(detail?.evidence?.matching_source_families || []),
    ...(detail?.matching_source_families || []),
    ...Object.values(detail?.languages || {}).flatMap((value) => value?.matching_source_families || [])
  ]).map(collapseFamily);
  return {
    ...base,
    stage,
    reason: String(reason || 'unknown'),
    repair_lane: repairLane(stage, reason),
    target_lang: detail?.target_lang || null,
    evidence_families: unique(families),
    target_coverage_count: Number(detail?.target_coverage_count) || 0,
    decision: detail?.decision || null,
    risk_flags: detail?.risk_flags || [],
    errors: detail?.errors || []
  };
}

function repairLane(stage, reason) {
  const text = String(reason || '').toLowerCase();
  if (stage === 'accepted') return 'accepted';
  if (stage === 'production_policy') return 'excluded_policy';
  if (stage === 'daily_primary') return 'source_index_repair';
  if (stage === 'source_sense_alignment') {
    return text.includes('already_complete') ? 'already_covered' : 'source_alignment_repair';
  }
  if (stage === 'reverse_evidence_prefilter' || stage === 'source_reverse_evidence') {
    return text.includes('conflict') ? 'source_alignment_repair' : 'evidence_acquisition';
  }
  if (stage === 'gemma_source_review') return 'source_candidate_rebuild';
  if (stage === 'semantic_preview' || stage === 'final_gemma_review') {
    return 'semantic_contract_repair';
  }
  if (stage === 'controlled_replay_gate') return 'publication_gate_repair';
  if (stage === 'jmdict_preflight' || stage === 'generation_preflight' || stage === 'qwen_generation') {
    return 'deterministic_contract_repair';
  }
  return 'manual_review';
}

function summarize(row, manifest, runDir) {
  return {
    run_id: path.basename(runDir),
    input_report: manifest.input || null,
    source_entry_id: Number(row.source_entry_id ?? row.id),
    source_sense_id: Number(row.source_sense_id ?? row.first_sense_id) || null,
    candidate_key: candidateKey(row),
    word: row.word || row.headword || null,
    source_lang: row.source_lang || row.lang || null,
    frequency_rank: Number(row.frequency_rank) || null,
    anchor: row.english_anchor || row.anchor || row.gloss_key || null
  };
}

function sampleByBucket(rows, limit) {
  const buckets = {};
  for (const row of rows) {
    const key = `${row.stage}:${row.reason}`;
    if (!buckets[key]) buckets[key] = [];
    if (buckets[key].length < limit) buckets[key].push(row);
  }
  return buckets;
}

function readRows(runDir, name, preferred) {
  return rowsFrom(readJson(path.join(runDir, name)), preferred);
}

function readOptionalRows(runDir, name, preferred) {
  const filePath = path.join(runDir, name);
  return fs.existsSync(filePath) ? rowsFrom(readJson(filePath), preferred) : null;
}

function rowsFrom(value, preferred = []) {
  for (const key of preferred) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing JSON input: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function indexByEntry(rows) {
  return new Map(rows.map((row) => [Number(row.source_entry_id ?? row.id), row]));
}

function indexByCandidate(rows) {
  return new Map(rows.map((row) => [candidateKey(row), row]));
}

function findByEntry(index, entryId) {
  for (const row of index.values()) {
    if (Number(row.source_entry_id ?? row.output?.source_entry_id) === entryId) return row;
  }
  return null;
}

function keySet(rows) {
  return new Set(rows.map(candidateKey));
}

function candidateKey(row) {
  const entryId = Number(row?.source_entry_id ?? row?.output?.source_entry_id ?? row?.id);
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id ?? row?.first_sense_id);
  return Number.isFinite(senseId) && senseId > 0 ? `${entryId}:${senseId}` : `${entryId}`;
}

function approved(row) {
  return Boolean(row?.valid && (row?.approved === true || row?.decision === 'accept'));
}

function reviewReason(row) {
  if (!row) return 'missing_stage_result';
  if (!row.valid) return 'invalid_response';
  return row.reason || row.decision || (row.approved ? 'accept' : 'reject');
}

function generationReason(row) {
  if (!row) return 'missing_generation_result';
  if (row.infrastructure_failure) return 'infrastructure_failure';
  if (row.errors?.length) return row.errors.join('|');
  return 'validation_rejected';
}

function collapseFamily(value) {
  const family = String(value || '').trim().toLowerCase();
  if (family.includes('wikdict') || family.includes('kaikki') || family.includes('wiktionary')) {
    return 'wiktionary';
  }
  return family;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = String(selector(row) || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : 0;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requiredDir(value) {
  if (!fs.existsSync(value) || !fs.statSync(value).isDirectory()) {
    throw new Error(`Run directory not found: ${value}`);
  }
}

function relative(value) {
  return path.relative(process.cwd(), value) || '.';
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
