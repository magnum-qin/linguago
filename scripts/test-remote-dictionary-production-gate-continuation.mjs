import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = fs.readFileSync(
  path.join(here, 'run-remote-dictionary-production-until-release.ps1'),
  'utf8',
);
const completion = fs.readFileSync(
  path.join(here, 'complete-remote-dictionary-production-run.ps1'),
  'utf8',
);

assert.match(script, /\[bool\]\$ContinueOnProductionGateFailure = \$true/);
assert.match(script, /\[int\]\$AdditionalSenseCandidateMultiplier = 12/);
assert.match(script, /@\('additional-sense', 'daily-mixed'\)/);
assert.match(script, /function Test-ProductionGateRejection/);
assert.match(script, /-match 'Production gates failed'/);
assert.match(script, /batch_rejected_by_production_gates/);
assert.match(
  script,
  /if \(\$ContinueOnProductionGateFailure -and \(Test-ProductionGateRejection \$RunDir \$_\)\)/,
);
assert.match(script, /continue\s*\n\s*}\s*\n\s*throw/);
assert.match(script, /Write-State 'candidate_exhausted'/);
assert.match(script, /recovery_required = \$true/);
assert.match(script, /gpu_started = \$false/);
assert.match(script, /Move-Item -LiteralPath \$TempPath -Destination \$StatePath -Force/);
assert.match(script, /function Invoke-BatchBuild/);
assert.match(script, /heartbeat_at/);
assert.match(script, /\$Process\.WaitForExit\(\)/);
assert.doesNotMatch(script, /stack = \$_\.ScriptStackTrace/);
assert.match(script, /merge-dictionary-v2-daily-production-lanes\.mjs/);
assert.doesNotMatch(script, /throw 'Candidate pool exhausted before the release threshold was reached'/);
assert.match(script, /Write-State 'batch_limit_reached'/);
assert.match(script, /validation_batch_complete = \$true/);
assert.match(completion, /\$FinalAccepted = \[int64\]\$Summary\.summary\.final_accepted/);
assert.match(completion, /Write-Status 'candidate_exhausted'/);
assert.match(completion, /database_write_attempted = \$false/);
assert.match(completion, /if \(\$FinalAccepted -le 0\)/);

console.log('remote dictionary production gate continuation checks passed');
