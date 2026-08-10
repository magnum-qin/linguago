import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const logsDir = path.resolve(args['logs-dir'] || 'logs');
const prefixes = String(args.prefix || 'product-source-gap-v83')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const outPath = path.resolve(args.out || 'logs/product-source-gap-v83-generation-attempts.json');

if (!fs.existsSync(logsDir)) throw new Error(`Logs directory not found: ${logsDir}`);

const attempts = new Map();
const parseFailures = [];
let filesScanned = 0;
let generationReports = 0;
let checkpoints = 0;

for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
  if (
    !entry.isFile() ||
    !prefixes.some((prefix) => entry.name.startsWith(prefix)) ||
    !entry.name.endsWith('.json')
  )
    continue;
  const filePath = path.join(logsDir, entry.name);
  filesScanned++;
  let report;
  try {
    report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    parseFailures.push({ file: entry.name, error: String(error?.message || error) });
    continue;
  }

  if (Array.isArray(report.generated)) {
    generationReports++;
    for (const item of report.generated) addAttempt(item, entry.name, 'generated');
  }

  if (Array.isArray(report.skipped_preview)) {
    for (const item of report.skipped_preview) {
      if (item?.reason === 'already_linked_complete_source_gap') {
        addAttempt(item, entry.name, 'already_linked_complete_source_gap');
      }
    }
  }

  if (Array.isArray(report.reviews)) {
    for (const item of report.reviews) {
      if (item?.valid === true && item?.decision === 'reject') {
        addAttempt(item, entry.name, 'review_reject');
      }
      if (item?.valid === false && item?.source_entry_id) {
        addAttempt(item, entry.name, 'review_failure_after_retries');
      }
    }
  }

  if (isGenerationCheckpoint(report)) {
    checkpoints++;
    for (const [key, item] of Object.entries(report.items)) {
      if (!checkpointItemWasAttempted(item)) continue;
      addAttempt({ ...item, source_entry_id: item?.source_entry_id ?? key }, entry.name, 'checkpoint');
    }
  }
}

const selected = [...attempts.values()]
  .sort((a, b) => a.source_entry_id - b.source_entry_id || Number(a.source_sense_id || 0) - Number(b.source_sense_id || 0))
  .map((item) => ({
    source_entry_id: item.source_entry_id,
    source_sense_id: item.source_sense_id,
    attempts: item.files.size,
    files: [...item.files].sort(),
    evidence: [...item.evidence].sort()
  }));
const output = {
  ok: parseFailures.length === 0,
  generated_at: new Date().toISOString(),
  policy: {
    logs_dir: path.relative(process.cwd(), logsDir),
    filename_prefixes: prefixes,
    includes: [
      'top_level_generated_rows',
      'already_linked_complete_source_gap_rows',
      'attempted_generation_checkpoint_items',
      'valid_remote_review_rejections'
    ],
    excludes: [
      'review_accept_rows',
      'review_manual_rows',
      'triage_only_rows',
      'selected_but_not_generated_rows'
    ]
  },
  summary: {
    files_scanned: filesScanned,
    generation_reports: generationReports,
    checkpoints,
    unique_source_entry_ids: new Set(selected.map((item) => item.source_entry_id)).size,
    unique_source_entry_sense_attempts: selected.length,
    parse_failures: parseFailures.length
  },
  selected,
  parse_failures: parseFailures
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: output.ok, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function addAttempt(item, file, evidence) {
  const sourceEntryId = Number(item?.source_entry_id ?? item?.output?.source_entry_id);
  if (!Number.isInteger(sourceEntryId) || sourceEntryId < 1) return;
  const sourceSenseIdValue = Number(item?.source_sense_id ?? item?.output?.source_sense_id);
  const sourceSenseId = Number.isInteger(sourceSenseIdValue) && sourceSenseIdValue > 0 ? sourceSenseIdValue : null;
  const attemptKey = `${sourceEntryId}:${sourceSenseId || '*'}`;
  const current = attempts.get(attemptKey) || {
    source_entry_id: sourceEntryId,
    source_sense_id: sourceSenseId,
    files: new Set(),
    evidence: new Set()
  };
  current.files.add(file);
  current.evidence.add(evidence);
  attempts.set(attemptKey, current);
}

function isGenerationCheckpoint(value) {
  return Boolean(value?.items && typeof value.items === 'object' && value?.config?.model);
}

function checkpointItemWasAttempted(item) {
  if (!item || typeof item !== 'object') return false;
  if (Array.isArray(item.attempts) && item.attempts.length) return true;
  if (Number(item.attempt_count || 0) > 0) return true;
  return ['accepted', 'rejected', 'failed'].includes(String(item.status || ''));
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
