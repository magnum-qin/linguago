import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root || '.');
const manifestPath = path.resolve(root, args.manifest || 'config/remote-runner-files.json');
const updatesPath = path.resolve(args.updates || '');
const apply = String(args.apply || 'false').toLowerCase() === 'true';

if (!fs.existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`);
if (!updatesPath || !fs.existsSync(updatesPath)) throw new Error(`Updates file not found: ${updatesPath}`);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, ''));
const manifest = readJson(manifestPath);
const updates = readJson(updatesPath);
if (!Array.isArray(manifest.files) || !Array.isArray(updates) || updates.length === 0) {
  throw new Error('Manifest files and updates must be non-empty arrays');
}

const allowed = new Set([
  'scripts\\run-dictionary-v2-remote-pipeline.mjs',
  'scripts\\validate-dictionary-v2-product-source-gap-reverse-evidence.mjs',
  'scripts\\lib\\japanese-reverse-lookup-variants.mjs',
  'scripts\\test-dictionary-v2-pipeline-execution-modes.mjs',
  'scripts\\validate-remote-dictionary-controlled-replay.ps1',
  'scripts\\publish-remote-dictionary-controlled-run.ps1',
  'scripts\\start-remote-dictionary-release-cohort-production.ps1',
  'scripts\\complete-remote-dictionary-production-run.ps1',
  'scripts\\run-remote-dictionary-production-until-release.ps1',
  'scripts\\manage-remote-dictionary-runner.ps1',
  'scripts\\set-remote-dictionary-task-credential.ps1',
  'scripts\\new-remote-dictionary-runner-manifest.ps1',
  'scripts\\test-remote-dictionary-production-gate-continuation.mjs',
  'scripts\\new-remote-dictionary-production-batch.ps1',
  'scripts\\build-dictionary-v2-additional-sense-recovery-pool.mjs',
  'scripts\\build-dictionary-v2-additional-sense-attempt-index.mjs',
  'scripts\\test-dictionary-v2-additional-sense-attempt-index.mjs',
  'scripts\\test-dictionary-v2-additional-sense-recovery-pool.mjs',
  'scripts\\align-dictionary-v2-product-source-gap-candidate-senses.mjs',
  'scripts\\lib\\daily-candidate-quality.mjs',
  'scripts\\lib\\jmdict-review-metadata.mjs',
  'scripts\\select-dictionary-v2-product-daily-scale-cohort.mjs',
  'scripts\\select-dictionary-v2-product-daily-primary-senses.mjs',
  'scripts\\filter-dictionary-v2-production-batch.mjs',
  'scripts\\filter-dictionary-v2-daily-recovery-candidates.mjs',
  'scripts\\build-dictionary-v2-model-confirmed-sense-index.mjs',
  'scripts\\restore-dictionary-v2-missing-stock.mjs',
  'scripts\\watch-remote-dictionary-main-db.ps1',
  'config\\dictionary-overrides\\product-entry-form-aliases.json',
  'scripts\\update-remote-runner-manifest-entries.mjs',
  'data\\processed\\linguago_v2_product_top5000_freedict_filtered_candidate.db'
]);
const byPath = new Map(manifest.files.map((entry) => [normalize(entry.path), entry]));
const changed = [];

for (const update of updates) {
  const relative = normalize(update.path);
  if (!allowed.has(relative)) throw new Error(`Path is not approved for targeted refresh: ${relative}`);
  if (!/^[A-Fa-f0-9]{64}$/.test(String(update.sha256 || ''))) {
    throw new Error(`Invalid expected SHA-256 for ${relative}`);
  }
  let entry = byPath.get(relative);
  const absolute = path.resolve(root, relative);
  if (!absolute.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) {
    throw new Error(`Path escapes runner root: ${relative}`);
  }
  const bytes = fs.readFileSync(absolute);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const expected = String(update.sha256).toUpperCase();
  if (actual !== expected) throw new Error(`Hash mismatch for ${relative}: expected ${expected}, got ${actual}`);
  if (!entry) {
    entry = { path: relative, sha256: '', bytes: 0 };
    manifest.files.push(entry);
    byPath.set(relative, entry);
  }
  const previousSha256 = String(entry.sha256 || '').toUpperCase();
  const previousBytes = Number(entry.bytes || 0);
  entry.sha256 = actual;
  entry.bytes = bytes.length;
  changed.push({
    path: relative,
    previous_sha256: previousSha256,
    sha256: actual,
    previous_bytes: previousBytes,
    bytes: bytes.length,
    differs: previousSha256 !== actual || previousBytes !== bytes.length
  });
}

if (apply) {
  const temp = `${manifestPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, manifestPath);
}
console.log(JSON.stringify({ ok: true, apply, manifest: manifestPath, changed }, null, 2));

function normalize(value) {
  return String(value || '').replaceAll('/', '\\');
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      result[token.slice(2)] = value;
      index += 1;
    } else {
      result[token.slice(2)] = true;
    }
  }
  return result;
}
