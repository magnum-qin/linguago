import fs from 'node:fs';

const RECOVERABLE_GENERATION_STAGES = new Set([
  'qwen_generation',
  'qwen_repair_generation',
  'qwen_semantic_repair_generation'
]);

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
}
