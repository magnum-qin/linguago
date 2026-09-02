import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-v219-control-'));
for (const dir of ['scripts', 'config', 'data/processed', 'state', 'batches']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'), '');
fs.writeFileSync(path.join(root, 'config/dictionary-v2-online-baseline.json'), '{}');
fs.writeFileSync(path.join(root, 'scripts/report-dictionary-v2-release-cohort.mjs'), `
import fs from 'node:fs';
fs.writeFileSync(process.argv[process.argv.indexOf('--out')+1], JSON.stringify({ok:true,release_ready:false,remaining_senses:5000}));
`);
const batchScript = path.join(root, 'scripts/new-remote-dictionary-production-batch.ps1');
fs.writeFileSync(batchScript, `param($Root,$Limit,$Out,$CandidateMode,$NativeMaxRank,$NativeScanLimit,$NativeTargets)
[IO.File]::WriteAllText((Join-Path $Root $Out), '{"selected_count":0,"selected":[]}', (New-Object Text.UTF8Encoding($false)))
exit 0
`);
// The production scripts must never be invoked for an empty candidate pool.
fs.writeFileSync(path.join(root, 'scripts/manage-remote-dictionary-runner.ps1'), "throw 'GPU_MUST_NOT_START'");
const orchestrator = path.resolve('scripts/run-remote-dictionary-production-until-release.ps1');
const run = () => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', orchestrator, '-Root', root, '-CandidateMode', 'native-daily', '-BatchLimit', '100', '-MaxBatches', '1', '-PollSeconds', '2'], { encoding: 'utf8', timeout: 30000 });
let result = run();
assert.equal(result.status, 0, result.stdout + result.stderr);
let state = JSON.parse(fs.readFileSync(path.join(root, 'state/release-cohort-production.json'), 'utf8'));
assert.equal(state.status, 'candidate_exhausted');
assert.equal(state.gpu_started, false);
assert.equal(state.batches_started, 0);
fs.writeFileSync(batchScript, "Write-Error 'failure with quote: \" and newline'; exit 7");
result = run();
assert.notEqual(result.status, 0);
state = JSON.parse(fs.readFileSync(path.join(root, 'state/release-cohort-production.json'), 'utf8'));
assert.equal(state.status, 'failed');
assert.match(state.error, /exit=7/);
assert.equal(state.batches_started, 0);
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
fs.writeFileSync(batchScript, 'exit 0');
fs.writeFileSync(path.join(root, 'scripts/build-dictionary-v2-additional-sense-attempt-index.mjs'), 'process.exit(0);');
fs.writeFileSync(path.join(root, 'scripts/merge-dictionary-v2-daily-production-lanes.mjs'), 'process.exit(0);');
const auditStub = path.join(root, 'scripts/audit-dictionary-v2-daily-candidate-cohort.mjs');
const validator = path.resolve('scripts/build-remote-dictionary-v219-validation-cohort.ps1');
for (const count of [75, 0]) {
  fs.writeFileSync(auditStub, `import fs from 'node:fs'; fs.writeFileSync(process.argv[process.argv.indexOf('--out')+1], JSON.stringify({summary:{selected_count:${count},findings:0}})); process.exit(2);`);
  const validation = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validator, '-Root', root], { encoding: 'utf8', timeout: 30000 });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
  const summary = JSON.parse(validation.stdout);
  assert.equal(summary.Status, count ? 'candidate_shortfall' : 'candidate_exhausted');
  assert.equal(summary.ValidationGatePassed, false);
  assert.equal(summary.GpuStarted, false);
}
const quotaCheck = (quotas) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', validator, '-Root', root, '-HeadwordLanguageQuotas', quotas], { encoding: 'utf8', timeout: 30000 });
const customQuota = quotaCheck('zh=50,ja=50');
assert.equal(customQuota.status, 0, customQuota.stdout + customQuota.stderr);
assert.equal(JSON.parse(customQuota.stdout).HeadwordLanguageQuotas, 'zh=50,ja=50,pt-BR=0,en=0');
for (const quotas of ['zh=50,zh=50', 'zh=50,ja=49', 'zh=-1,ja=101', 'fr=100']) assert.notEqual(quotaCheck(quotas).status, 0);
console.log(JSON.stringify({ ok: true, tests: ['empty_pool_exit_zero', 'no_gpu_on_empty', 'child_exit_code', 'failure_json_parseable', 'validation_shortfall_normal_not_passed', 'validation_empty_normal_not_passed'] }));
