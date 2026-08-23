#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectCompletedGenerationStage,
  inspectCompletedPipelineStage
} from './lib/dictionary-pipeline-stage-recovery.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-stage-recovery-'));
try {
  const report = path.join(root, 'generation.json');
  const checkpoint = path.join(root, 'generation.checkpoint.json');
  write(report, { partial: false, stats: { generated: 3, accepted: 2, rejected: 1 } });
  write(checkpoint, {
    summary: {
      selected: 3,
      pending: 0,
      completed: 3,
      accepted: 2,
      rejected: 1,
      chunks_committed: 1,
      chunks_total: 1
    }
  });

  const complete = inspectCompletedGenerationStage('qwen_generation', [report, checkpoint]);
  assert.equal(complete.recoverable, true);
  assert.equal(complete.selected, 3);

  write(report, { partial: true, stats: { generated: 3 } });
  assert.equal(
    inspectCompletedGenerationStage('qwen_generation', [report, checkpoint]).reason,
    'report_partial'
  );

  write(report, { partial: false, stats: { generated: 3 } });
  write(checkpoint, { summary: { selected: 3, pending: 1, completed: 2, chunks_committed: 1, chunks_total: 1 } });
  assert.equal(
    inspectCompletedGenerationStage('qwen_generation', [report, checkpoint]).reason,
    'checkpoint_incomplete'
  );

  assert.equal(
    inspectCompletedGenerationStage('final_gemma', [report, checkpoint]).reason,
    'stage_not_recoverable'
  );

  const reverse = path.join(root, 'reverse-evidence.json');
  const supported = path.join(root, 'reverse-evidence-supported.json');
  write(reverse, {
    ok: true,
    summary: {
      generation_rows: 3,
      validated_rows: 3,
      decisions: { supported: 2, unsupported: 1, manual_review: 0 },
      supported_replay_report: supported
    },
    validations: [{}, {}, {}]
  });
  write(supported, {
    ok: true,
    partial: false,
    reverse_evidence_report: reverse,
    generated: [{}, {}]
  });
  const reverseComplete = inspectCompletedPipelineStage('reverse_evidence', [reverse, supported]);
  assert.equal(reverseComplete.recoverable, true);
  assert.equal(reverseComplete.accepted, 2);
  assert.equal(reverseComplete.rejected, 1);

  write(supported, {
    ok: true,
    partial: false,
    reverse_evidence_report: reverse,
    generated: [{}]
  });
  assert.equal(
    inspectCompletedPipelineStage('reverse_evidence', [reverse, supported]).reason,
    'supported_count_mismatch'
  );
  console.log(JSON.stringify({ ok: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

function write(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
