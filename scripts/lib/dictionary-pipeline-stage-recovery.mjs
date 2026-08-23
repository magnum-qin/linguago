import fs from 'node:fs';

const RECOVERABLE_GENERATION_STAGES = new Set([
  'qwen_generation',
  'qwen_repair_generation',
  'qwen_semantic_repair_generation'
]);

export function inspectCompletedPipelineStage(name, expectedOutputs) {
  if (name === 'reverse_evidence') {
    return inspectCompletedReverseEvidenceStage(expectedOutputs);
  }
  return inspectCompletedGenerationStage(name, expectedOutputs);
}

export function inspectCompletedGenerationStage(name, expectedOutputs) {
  if (!RECOVERABLE_GENERATION_STAGES.has(name)) {
    return { recoverable: false, reason: 'stage_not_recoverable' };
  }
  if (!Array.isArray(expectedOutputs) || expectedOutputs.length < 2) {
    return { recoverable: false, reason: 'missing_expected_outputs' };
  }
  if (expectedOutputs.some((filePath) => !fs.existsSync(filePath))) {
    return { recoverable: false, reason: 'output_missing' };
  }

  const checkpointPath = expectedOutputs.find((filePath) => filePath.endsWith('.checkpoint.json'));
  const reportPath = expectedOutputs.find((filePath) => !filePath.endsWith('.checkpoint.json'));
  if (!checkpointPath || !reportPath) {
    return { recoverable: false, reason: 'report_or_checkpoint_missing' };
  }

  try {
    const report = readJson(reportPath);
    const checkpoint = readJson(checkpointPath);
    const summary = checkpoint?.summary || {};
    const selected = Number(summary.selected);
    const completed = Number(summary.completed);
    const pending = Number(summary.pending);
    const chunksCommitted = Number(summary.chunks_committed);
    const chunksTotal = Number(summary.chunks_total);

    if (report?.partial !== false) return { recoverable: false, reason: 'report_partial' };
    if (!Number.isFinite(selected) || selected < 0) return { recoverable: false, reason: 'selected_invalid' };
    if (completed !== selected || pending !== 0) return { recoverable: false, reason: 'checkpoint_incomplete' };
    if (!Number.isFinite(chunksTotal) || chunksTotal < 0 || chunksCommitted !== chunksTotal) {
      return { recoverable: false, reason: 'chunks_incomplete' };
    }
    if (Number(report?.stats?.generated) !== selected) {
      return { recoverable: false, reason: 'report_count_mismatch' };
    }
    return {
      recoverable: true,
      reason: 'durable_generation_outputs_complete',
      selected,
      accepted: Number(summary.accepted || 0),
      rejected: Number(summary.rejected || 0)
    };
  } catch (error) {
    return { recoverable: false, reason: `invalid_output:${String(error?.message || error)}` };
  }
}

function inspectCompletedReverseEvidenceStage(expectedOutputs) {
  if (!Array.isArray(expectedOutputs) || expectedOutputs.length !== 2) {
    return { recoverable: false, reason: 'missing_expected_outputs' };
  }
  if (expectedOutputs.some((filePath) => !fs.existsSync(filePath))) {
    return { recoverable: false, reason: 'output_missing' };
  }

  const supportedPath = expectedOutputs.find((filePath) => /-supported\.json$/u.test(filePath));
  const reportPath = expectedOutputs.find((filePath) => filePath !== supportedPath);
  if (!supportedPath || !reportPath) {
    return { recoverable: false, reason: 'report_or_supported_output_missing' };
  }

  try {
    const report = readJson(reportPath);
    const supported = readJson(supportedPath);
    const validated = Number(report?.summary?.validated_rows);
    const generationRows = Number(report?.summary?.generation_rows);
    const decisions = report?.summary?.decisions || {};
    const accepted = Number(decisions.supported || 0);
    const rejected = Number(decisions.unsupported || 0) + Number(decisions.manual_review || 0);
    const decisionTotal = accepted + rejected;

    if (report?.ok !== true || supported?.ok !== true || supported?.partial !== false) {
      return { recoverable: false, reason: 'report_not_complete' };
    }
    if (!Number.isFinite(validated) || validated < 0 || generationRows !== validated) {
      return { recoverable: false, reason: 'validation_count_mismatch' };
    }
    if (!Array.isArray(report.validations) || report.validations.length !== validated || decisionTotal !== validated) {
      return { recoverable: false, reason: 'decision_count_mismatch' };
    }
    if (!Array.isArray(supported.generated) || supported.generated.length !== accepted) {
      return { recoverable: false, reason: 'supported_count_mismatch' };
    }
    if (pathName(report.summary.supported_replay_report) !== pathName(supportedPath)) {
      return { recoverable: false, reason: 'supported_report_path_mismatch' };
    }
    if (pathName(supported.reverse_evidence_report) !== pathName(reportPath)) {
      return { recoverable: false, reason: 'reverse_report_path_mismatch' };
    }
    return {
      recoverable: true,
      reason: 'durable_reverse_evidence_outputs_complete',
      selected: validated,
      accepted,
      rejected
    };
  } catch (error) {
    return { recoverable: false, reason: `invalid_output:${String(error?.message || error)}` };
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}

function pathName(filePath) {
  return String(filePath || '').replaceAll('\\', '/').split('/').at(-1) || '';
}
