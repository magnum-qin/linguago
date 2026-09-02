import fs from 'node:fs';
import path from 'node:path';

function argsOf(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? (i += 1, next) : true;
  }
  return out;
}

const args = argsOf(process.argv);
const input = path.resolve(args.input || 'logs/localized-sense-review-v5-human-labels.json');
const output = path.resolve(args.output || 'logs/localized-sense-review-v5-human-label-score.json');
const labelsPath = args.labels
  ? path.resolve(args.labels)
  : path.resolve('config/localized-sense-review-v5-calibration-labels.json');
const predictionsPath = args.predictions ? path.resolve(args.predictions) : null;
const minLabels = Number(args['min-labels'] || 20);
const minPrecision = Number(args['min-precision'] || 0.95);
const report = JSON.parse(fs.readFileSync(input, 'utf8'));
if (predictionsPath && fs.existsSync(predictionsPath)) {
  const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));
  const byId = new Map((predictions.rows || []).map((row) => [row.candidate_id, row]));
  for (const row of report.rows) {
    const prediction = byId.get(row.candidate_id);
    if (!prediction) continue;
    row.pipeline_status = prediction.status;
    row.pipeline_decision = prediction.decision;
    row.pipeline_matched_sense_ids = prediction.matched_sense_ids || [];
    row.disagreement_codes = prediction.disagreement_codes || [];
  }
}
if (fs.existsSync(labelsPath)) {
  const overlay = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
  for (const row of report.rows) {
    const label = overlay.labels?.[row.candidate_id];
    if (!label) continue;
    row.human_label = label.label;
    row.human_matched_sense_ids = label.sense_ids || [];
    row.human_note = label.note || '';
    row.reviewer = overlay.reviewer || '';
    row.reviewed_at = overlay.reviewed_at || null;
  }
}
const allowed = new Set(['correct_isolate', 'should_keep', 'needs_repair', 'uncertain']);
const labeled = report.rows.filter((row) => allowed.has(row.human_label));
const decisive = labeled.filter((row) => row.human_label !== 'uncertain');
const predicted = decisive.filter((row) => row.pipeline_status === 'consensus' && row.pipeline_decision === 'isolate');
const correct = predicted.filter((row) => row.human_label === 'correct_isolate');
const exact = correct.filter((row) => {
  const a = [...(row.pipeline_matched_sense_ids || [])].map(Number).sort((x, y) => x - y);
  const b = [...(row.human_matched_sense_ids || [])].map(Number).sort((x, y) => x - y);
  return JSON.stringify(a) === JSON.stringify(b);
});
const precision = predicted.length ? correct.length / predicted.length : 0;
const exactPrecision = predicted.length ? exact.length / predicted.length : 0;
const labelCounts = Object.fromEntries([...allowed].map((label) => [label, labeled.filter((row) => row.human_label === label).length]));
const gate = labeled.length >= minLabels && precision >= minPrecision && exactPrecision >= minPrecision;
const result = {
  ok: true,
  created_at: new Date().toISOString(),
  source: input,
  labels: fs.existsSync(labelsPath) ? labelsPath : null,
  predictions: predictionsPath,
  thresholds: { min_labels: minLabels, min_precision: minPrecision },
  summary: {
    total: report.rows.length,
    labeled: labeled.length,
    decisive: decisive.length,
    predicted_isolate: predicted.length,
    true_isolate: correct.length,
    exact_sense_matches: exact.length,
    isolate_precision: precision,
    exact_sense_precision: exactPrecision,
    label_counts: labelCounts,
    expansion_gate_passed: gate
  },
  false_isolates: predicted.filter((row) => row.human_label !== 'correct_isolate').map((row) => ({
    candidate_id: row.candidate_id, human_label: row.human_label, human_note: row.human_note
  })),
  sense_mismatches: correct.filter((row) => !exact.includes(row)).map((row) => ({
    candidate_id: row.candidate_id,
    pipeline: row.pipeline_matched_sense_ids,
    human: row.human_matched_sense_ids
  }))
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result.summary, null, 2));
if (!gate) process.exitCode = 2;
