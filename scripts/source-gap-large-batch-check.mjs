import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = process.cwd();
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linguago-source-gap-check-'));
const dbPath = path.join(tempDir, 'product.db');
const reportPath = path.join(tempDir, 'report.json');
const checkpointPath = path.join(tempDir, 'checkpoint.json');
const outPath = path.join(tempDir, 'run.json');

const failingServer = http.createServer((_request, response) => {
  response.writeHead(500, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'simulated endpoint failure' }));
});
const successServer = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  const body = await readJson(request);
  const prompt = body?.messages?.at(-1)?.content || '';
  const sourceEntryId = Number(prompt.match(/source_entry_id=(\d+)/u)?.[1]);
  const headword = prompt.match(/headword=([^;\n]+)/u)?.[1]?.trim();
  const output = dictionaryOutput(sourceEntryId, headword);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});
let recoveringRequests = 0;
const recoveringServer = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  recoveringRequests++;
  if (recoveringRequests === 1) {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'simulated transient endpoint failure' }));
    return;
  }
  const body = await readJson(request);
  const prompt = body?.messages?.at(-1)?.content || '';
  const sourceEntryId = Number(prompt.match(/source_entry_id=(\d+)/u)?.[1]);
  const headword = prompt.match(/headword=([^;\n]+)/u)?.[1]?.trim();
  const output = dictionaryOutput(sourceEntryId, headword);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }));
});
const malformedJsonServer = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  await readJson(request);
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ message: { content: '{not-json' } }] }));
});

try {
  const [failurePort, successPort, recoveringPort, malformedJsonPort] = await Promise.all([
    listen(failingServer),
    listen(successServer),
    listen(recoveringServer),
    listen(malformedJsonServer)
  ]);
  createDatabase(dbPath);
  createReport(reportPath);
  const baseArgs = [
    'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    '--db',
    dbPath,
    '--report',
    reportPath,
    '--out',
    outPath,
    '--checkpoint',
    checkpointPath,
    '--endpoints',
    `http://127.0.0.1:${failurePort},http://127.0.0.1:${successPort}`,
    '--model',
    'fake-dictionary-model',
    '--limit',
    '4',
    '--concurrency',
    '2',
    '--batch-size',
    '1',
    '--chunk-size',
    '2',
    '--prompt-mode',
    'ultra',
    '--require-evidence-verdict',
    'true',
    '--minimal-request',
    'true',
    '--deterministic-readings',
    'false',
    '--deterministic-pronunciations',
    'false',
    '--prewarm',
    'false',
    '--dry-run',
    'false',
    '--apply',
    'true',
    '--max-attempts',
    '1',
    '--circuit-breaker-failures',
    '1',
    '--log-generated',
    'true'
  ];

  const first = await runNode(baseArgs);
  assert(first.code === 0, `first run failed: ${first.stderr || first.stdout}`);
  const firstReport = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  assert(
    firstReport.stats.accepted === 4,
    `expected 4 accepted, got ${firstReport.stats.accepted}: ${JSON.stringify(
      (firstReport.generated || []).map((row) => ({ word: row.word, errors: row.errors }))
    )}`
  );
  assert(firstReport.stats.chunks_committed === 2, 'expected two committed chunks');
  assert(
    firstReport.stats.endpoint_metrics[`http://127.0.0.1:${failurePort}`]?.open === true,
    'failure endpoint did not open circuit'
  );
  assert(databaseCount(dbPath, 'product_senses') === 4, 'first run did not write four senses');

  const second = await runNode([...baseArgs, '--resume', 'true']);
  assert(second.code === 0, `resume run failed: ${second.stderr || second.stdout}`);
  assert(databaseCount(dbPath, 'product_senses') === 4, 'resume inserted duplicate senses');
  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert(checkpoint.summary.accepted === 4, 'checkpoint did not retain four accepted items');
  assert(checkpoint.summary.pending === 0, 'checkpoint still has pending items');

  const migratedArgs = [...baseArgs];
  migratedArgs[migratedArgs.indexOf('--endpoints') + 1] = `http://127.0.0.1:${successPort}`;
  const migrated = await runNode([
    ...migratedArgs,
    '--resume',
    'true',
    '--allow-endpoint-change-on-resume',
    'true'
  ]);
  assert(migrated.code === 0, `endpoint migration resume failed: ${migrated.stderr || migrated.stdout}`);
  assert(databaseCount(dbPath, 'product_senses') === 4, 'endpoint migration resume inserted duplicate senses');
  const migratedCheckpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert(migratedCheckpoint.endpoint_migrations?.length === 1, 'endpoint migration was not recorded');

  const promoteOut = path.join(tempDir, 'promote.json');
  const promote = await runNode([
    'scripts/promote-dictionary-v2-product-source-gap-drafts.mjs',
    '--db',
    dbPath,
    '--checkpoint',
    checkpointPath,
    '--out',
    promoteOut,
    '--limit',
    '100',
    '--apply',
    'false'
  ]);
  assert(promote.code === 0, `checkpoint promote failed: ${promote.stderr || promote.stdout}`);
  const promoteReport = JSON.parse(fs.readFileSync(promoteOut, 'utf8'));
  assert(promoteReport.stats.scanned === 4, 'checkpoint promote did not isolate four senses');
  assert(promoteReport.stats.accepted === 4, 'checkpoint promote did not accept four senses');

  const recoveryDbPath = path.join(tempDir, 'recovery-product.db');
  const recoveryReportPath = path.join(tempDir, 'recovery-report.json');
  const recoveryCheckpointPath = path.join(tempDir, 'recovery-checkpoint.json');
  const recoveryOutPath = path.join(tempDir, 'recovery-run.json');
  createDatabase(recoveryDbPath);
  createReport(recoveryReportPath);
  const recoveryRun = await runNode([
    'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    '--db',
    recoveryDbPath,
    '--report',
    recoveryReportPath,
    '--out',
    recoveryOutPath,
    '--checkpoint',
    recoveryCheckpointPath,
    '--endpoints',
    `http://127.0.0.1:${recoveringPort}`,
    '--model',
    'fake-dictionary-model',
    '--limit',
    '1',
    '--concurrency',
    '1',
    '--batch-size',
    '1',
    '--chunk-size',
    '1',
    '--prompt-mode',
    'ultra',
    '--require-evidence-verdict',
    'true',
    '--minimal-request',
    'true',
    '--deterministic-readings',
    'false',
    '--deterministic-pronunciations',
    'false',
    '--prewarm',
    'false',
    '--dry-run',
    'false',
    '--apply',
    'true',
    '--max-attempts',
    '1',
    '--circuit-breaker-failures',
    '1',
    '--circuit-breaker-reset-ms',
    '10',
    '--log-generated',
    'true'
  ]);
  assert(recoveryRun.code === 0, `circuit recovery run failed: ${recoveryRun.stderr || recoveryRun.stdout}`);
  const recoveryReport = JSON.parse(fs.readFileSync(recoveryOutPath, 'utf8'));
  const recoveryEndpoint = `http://127.0.0.1:${recoveringPort}`;
  assert(recoveryReport.stats.accepted === 1, 'recovered endpoint did not complete its task');
  assert(recoveryReport.stats.infrastructure_rejected === 0, 'transient failure leaked into final rejects');
  assert(
    recoveryReport.stats.endpoint_metrics[recoveryEndpoint]?.recoveries === 1,
    'circuit did not enter half-open recovery'
  );
  assert(databaseCount(recoveryDbPath, 'product_senses') === 1, 'recovery run did not write its accepted sense');

  const malformedDbPath = path.join(tempDir, 'malformed-product.db');
  const malformedReportPath = path.join(tempDir, 'malformed-report.json');
  const malformedCheckpointPath = path.join(tempDir, 'malformed-checkpoint.json');
  const malformedOutPath = path.join(tempDir, 'malformed-run.json');
  createDatabase(malformedDbPath);
  createReport(malformedReportPath);
  const malformedRun = await runNode([
    'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    '--db',
    malformedDbPath,
    '--report',
    malformedReportPath,
    '--out',
    malformedOutPath,
    '--checkpoint',
    malformedCheckpointPath,
    '--endpoints',
    `http://127.0.0.1:${malformedJsonPort}`,
    '--model',
    'fake-dictionary-model',
    '--limit',
    '1',
    '--concurrency',
    '1',
    '--batch-size',
    '1',
    '--chunk-size',
    '1',
    '--prompt-mode',
    'micro',
    '--minimal-request',
    'true',
    '--deterministic-readings',
    'false',
    '--deterministic-pronunciations',
    'false',
    '--prewarm',
    'false',
    '--dry-run',
    'true',
    '--apply',
    'false',
    '--max-attempts',
    '2',
    '--circuit-breaker-failures',
    '1',
    '--log-generated',
    'true'
  ]);
  assert(malformedRun.code === 0, `malformed JSON run failed: ${malformedRun.stderr || malformedRun.stdout}`);
  const malformedReport = JSON.parse(fs.readFileSync(malformedOutPath, 'utf8'));
  const malformedEndpoint = `http://127.0.0.1:${malformedJsonPort}`;
  assert(malformedReport.stats.rejected === 1, 'malformed JSON did not produce one rejected item');
  assert(malformedReport.stats.validation_rejected === 1, 'malformed JSON was not classified as validation rejection');
  assert(
    malformedReport.stats.infrastructure_rejected === 0,
    'malformed JSON was misclassified as infrastructure failure'
  );
  assert(
    malformedReport.stats.endpoint_metrics[malformedEndpoint]?.failures === 0,
    'malformed JSON incorrectly incremented endpoint failures'
  );
  assert(
    malformedReport.stats.endpoint_metrics[malformedEndpoint]?.open === false,
    'malformed JSON incorrectly opened circuit'
  );

  const formatRerouteDbPath = path.join(tempDir, 'format-reroute-product.db');
  const formatRerouteReportPath = path.join(tempDir, 'format-reroute-report.json');
  const formatRerouteOutPath = path.join(tempDir, 'format-reroute-run.json');
  createDatabase(formatRerouteDbPath);
  createReport(formatRerouteReportPath);
  const formatRerouteRun = await runNode([
    'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    '--db',
    formatRerouteDbPath,
    '--report',
    formatRerouteReportPath,
    '--out',
    formatRerouteOutPath,
    '--endpoints',
    `http://127.0.0.1:${malformedJsonPort},http://127.0.0.1:${successPort}`,
    '--endpoint-concurrency',
    `${malformedJsonPort}=1,${successPort}=1`,
    '--model',
    'fake-dictionary-model',
    '--limit',
    '1',
    '--concurrency',
    '2',
    '--batch-size',
    '1',
    '--chunk-size',
    '1',
    '--prompt-mode',
    'ultra',
    '--minimal-request',
    'true',
    '--deterministic-readings',
    'false',
    '--deterministic-pronunciations',
    'false',
    '--prewarm',
    'false',
    '--dry-run',
    'true',
    '--apply',
    'false',
    '--max-attempts',
    '1',
    '--circuit-breaker-failures',
    '1',
    '--log-generated',
    'true'
  ]);
  assert(
    formatRerouteRun.code === 0,
    `format reroute run failed: ${formatRerouteRun.stderr || formatRerouteRun.stdout}`
  );
  const formatRerouteReport = JSON.parse(fs.readFileSync(formatRerouteOutPath, 'utf8'));
  assert(formatRerouteReport.stats.accepted === 1, 'malformed output was not rerouted to the healthy endpoint');
  assert(formatRerouteReport.stats.infrastructure_rejected === 0, 'format reroute created an infrastructure rejection');
  assert(
    formatRerouteReport.stats.endpoint_metrics[malformedEndpoint]?.failures === 0,
    'format reroute incremented endpoint failures'
  );

  const noPromoteDbPath = path.join(tempDir, 'no-promote-product.db');
  const noPromoteReportPath = path.join(tempDir, 'no-promote-report.json');
  const noPromoteOutPath = path.join(tempDir, 'no-promote-run.json');
  createDatabase(noPromoteDbPath);
  createReport(noPromoteReportPath);
  const noPromoteInput = JSON.parse(fs.readFileSync(noPromoteReportPath, 'utf8'));
  noPromoteInput.selected[0].promote_allowed = false;
  fs.writeFileSync(noPromoteReportPath, JSON.stringify(noPromoteInput, null, 2), 'utf8');
  const noPromoteRun = await runNode([
    'scripts/supplement-dictionary-v2-product-source-gaps-unsloth.mjs',
    '--db',
    noPromoteDbPath,
    '--report',
    noPromoteReportPath,
    '--out',
    noPromoteOutPath,
    '--endpoints',
    `http://127.0.0.1:${successPort}`,
    '--model',
    'fake-dictionary-model',
    '--limit',
    '1',
    '--concurrency',
    '1',
    '--batch-size',
    '1',
    '--chunk-size',
    '1',
    '--prompt-mode',
    'ultra',
    '--require-evidence-verdict',
    'true',
    '--minimal-request',
    'true',
    '--deterministic-readings',
    'false',
    '--deterministic-pronunciations',
    'false',
    '--prewarm',
    'false',
    '--dry-run',
    'false',
    '--apply',
    'true',
    '--max-attempts',
    '1',
    '--log-generated',
    'true'
  ]);
  assert(noPromoteRun.code === 0, `no-promote run failed: ${noPromoteRun.stderr || noPromoteRun.stdout}`);
  const noPromoteReport = JSON.parse(fs.readFileSync(noPromoteOutPath, 'utf8'));
  assert(noPromoteReport.stats.accepted === 1, 'no-promote item was not generated');
  assert(noPromoteReport.stats.no_promote_writes_skipped === 1, 'no-promote write was not skipped');
  assert(databaseCount(noPromoteDbPath, 'product_senses') === 0, 'no-promote item leaked into SQLite');

  console.log(
    JSON.stringify(
      {
        ok: true,
        accepted: 4,
        chunks: 2,
        resume_duplicates: 0,
        endpoint_change_resume: 'passed',
        circuit_breaker: 'passed',
        circuit_recovery: 'passed',
        malformed_json_classification: 'passed',
        malformed_json_reroute: 'passed',
        no_promote_write_guard: 'passed',
        checkpoint_promote: 4
      },
      null,
      2
    )
  );
} finally {
  await Promise.all([close(failingServer), close(successServer), close(recoveringServer), close(malformedJsonServer)]);
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function createDatabase(filePath) {
  const db = new Database(filePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE product_entries (
      id INTEGER PRIMARY KEY,
      headword TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      primary_lang TEXT NOT NULL,
      frequency_rank INTEGER,
      group_key TEXT NOT NULL UNIQUE,
      group_method TEXT,
      status TEXT NOT NULL,
      source_count INTEGER,
      lang_count INTEGER,
      created_at TEXT
    );
    CREATE TABLE product_senses (
      id INTEGER PRIMARY KEY,
      product_entry_id INTEGER NOT NULL REFERENCES product_entries(id),
      sense_order INTEGER NOT NULL,
      part_of_speech TEXT,
      gloss_key TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL,
      created_at TEXT
    );
    CREATE TABLE product_localizations (
      id INTEGER PRIMARY KEY,
      product_sense_id INTEGER NOT NULL REFERENCES product_senses(id),
      lang TEXT NOT NULL,
      term TEXT NOT NULL,
      reading TEXT,
      reading_system TEXT,
      pronunciation TEXT,
      pronunciation_system TEXT,
      definition TEXT NOT NULL,
      source TEXT,
      confidence REAL,
      needs_review INTEGER NOT NULL,
      UNIQUE(product_sense_id, lang)
    );
    CREATE TABLE product_sense_source_links (
      id INTEGER PRIMARY KEY,
      product_sense_id INTEGER NOT NULL REFERENCES product_senses(id),
      source_entry_id INTEGER,
      source_sense_id INTEGER,
      source_lang TEXT,
      source_word TEXT,
      source_frequency_rank INTEGER,
      match_method TEXT,
      confidence REAL,
      UNIQUE(product_sense_id, source_sense_id)
    );
    CREATE TABLE product_examples (
      id INTEGER PRIMARY KEY,
      product_sense_id INTEGER NOT NULL REFERENCES product_senses(id),
      example_order INTEGER NOT NULL,
      source_lang TEXT NOT NULL,
      source_text TEXT NOT NULL,
      needs_review INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE product_example_localizations (
      id INTEGER PRIMARY KEY,
      product_example_id INTEGER NOT NULL REFERENCES product_examples(id),
      lang TEXT NOT NULL,
      text TEXT NOT NULL,
      reading TEXT,
      needs_review INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.close();
}

function createReport(filePath) {
  // Six candidates ensure a resumed --limit 4 run cannot accidentally process two extra rows.
  const selected = Array.from({ length: 6 }, (_, index) => ({
    source_entry_id: 900001 + index,
    first_sense_id: 910001 + index,
    word: `palavra${index + 1}`,
    normalized_key: `palavra${index + 1}`,
    source_lang: 'pt-BR',
    frequency_rank: 1000 + index,
    gloss_key: `test word ${index + 1}`,
    gloss_preview: `test word ${index + 1}`
  }));
  fs.writeFileSync(filePath, JSON.stringify({ selected }, null, 2), 'utf8');
}

function dictionaryOutput(sourceEntryId, headword) {
  return {
    source_entry_id: sourceEntryId,
    headword,
    normalized_key: headword,
    primary_lang: 'pt-BR',
    frequency_rank: 1000,
    part_of_speech: 'noun',
    gloss_key: 'test word',
    source_evidence_valid: true,
    source_evidence_reason: null,
    localizations: {
      en: {
        term: 'test word',
        pronunciation: '/test wɜːrd/',
        pronunciation_system: 'IPA',
        definition: 'A word used for automated testing.'
      },
      'pt-BR': {
        term: headword,
        pronunciation: '/paˈla.vɾa/',
        pronunciation_system: 'IPA',
        definition: 'Palavra usada para realizar um teste automatizado.'
      },
      zh: { term: '测试词', reading: 'cè shì cí', reading_system: 'pinyin', definition: '用于自动化测试的词语。' },
      ja: { term: 'テスト語', reading: 'てすとご', reading_system: 'kana', definition: '自動テストで使用する語。' }
    }
  };
}

function databaseCount(filePath, table) {
  const db = new Database(filePath, { readonly: true });
  const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  db.close();
  return count;
}

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, UNSLOTH_API_KEY: 'test-token' },
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => (text += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
