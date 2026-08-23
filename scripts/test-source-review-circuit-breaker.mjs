import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-review-circuit-'));
const reportPath = path.join(tempDir, 'candidates.json');
const outPath = path.join(tempDir, 'review.json');
const approvedPath = path.join(tempDir, 'approved.json');
const rejectedPath = path.join(tempDir, 'rejected.json');

const stalled = http.createServer(() => {});
const healthy = http.createServer((request, response) => {
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          decision: 'reject',
          confidence: 0.99,
          reason: 'Fixture rejection.',
          evidence: ['fixture'],
          risk_flags: ['fixture']
        })
      }
    }]
  }));
});

try {
  const stalledPort = await listen(stalled);
  const healthyPort = await listen(healthy);
  fs.writeFileSync(reportPath, JSON.stringify({
    selected: Array.from({ length: 4 }, (_, index) => ({
      source_entry_id: index + 1,
      first_sense_id: index + 101,
      source_lang: 'en',
      word: `fixture-${index + 1}`,
      normalized_key: `fixture-${index + 1}`,
      gloss_key: `fixture-${index + 1}`
    }))
  }), 'utf8');

  const result = await runNode([
    'scripts/review-dictionary-v2-product-source-gap-candidates-unsloth.mjs',
    '--report', reportPath,
    '--out', outPath,
    '--approved-out', approvedPath,
    '--rejected-out', rejectedPath,
    '--source-db', path.join(tempDir, 'missing.db'),
    '--limit', '4',
    '--endpoints', `http://127.0.0.1:${stalledPort},http://127.0.0.1:${healthyPort}`,
    '--model', 'fixture-model',
    '--timeout-ms', '1000',
    '--max-attempts', '2',
    '--checkpoint-every', '1',
    '--prewarm', 'false',
    '--response-format', 'json-object',
    '--prompt-mode', 'micro',
    '--circuit-breaker-failures', '1',
    '--circuit-breaker-reset-ms', '5000'
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);

  const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert.equal(report.summary.reviewed, 4);
  assert.equal(report.summary.failed, 0);
  const stalledRuntime = report.summary.endpoint_runtime[`http://127.0.0.1:${stalledPort}`];
  const healthyRuntime = report.summary.endpoint_runtime[`http://127.0.0.1:${healthyPort}`];
  assert.equal(stalledRuntime.failures, 1);
  assert.equal(stalledRuntime.timeouts, 1);
  assert.equal(stalledRuntime.circuit_opens, 1);
  assert.ok(healthyRuntime.calls >= 4);
  console.log(JSON.stringify({ ok: true, reviewed: 4, stalled: stalledRuntime, healthy: healthyRuntime }));
} finally {
  stalled.closeAllConnections?.();
  healthy.closeAllConnections?.();
  await Promise.allSettled([close(stalled), close(healthy)]);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Circuit-breaker fixture timed out'));
    }, 15_000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
