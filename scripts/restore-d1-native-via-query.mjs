import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const outDir = path.resolve(args['out-dir'] || 'outputs/d1-v2-product-native-export');
const accountId = args['account-id'];
const databaseId = args['database-id'];
const wranglerConfig = path.resolve(
  args['wrangler-auth'] || path.join(process.env.APPDATA || '', 'xdg.config/.wrangler/config/default.toml')
);
const batchBytes = Number(args['batch-bytes'] || 500_000);
const startChunk = Number(args['start-chunk'] || 0);
const quiet = args.quiet === 'true';

if (!accountId) throw new Error('Missing --account-id');
if (!databaseId) throw new Error('Missing --database-id');
if (!Number.isInteger(batchBytes) || batchBytes < 20_000) throw new Error('Invalid --batch-bytes');
if (!Number.isInteger(startChunk) || startChunk < 0) throw new Error('Invalid --start-chunk');

const manifestPath = path.join(outDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error(`Missing manifest: ${manifestPath}`);
if (!fs.existsSync(wranglerConfig)) throw new Error(`Missing Wrangler auth config: ${wranglerConfig}`);

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const token = readTomlString(wranglerConfig, 'oauth_token');
if (!token) throw new Error('Could not read oauth_token from Wrangler auth config');

const files = [manifest.schema, ...manifest.chunks].map((file) => path.resolve(file));
let totalStatements = 0;
let totalBatches = 0;

for (let fileIndex = startChunk; fileIndex < files.length; fileIndex++) {
  const file = files[fileIndex];
  const label = path.basename(file);
  const statements = readStatements(file);
  let batch = [];
  let size = 0;
  let sent = 0;

  for (const statement of statements) {
    const statementBytes = Buffer.byteLength(statement, 'utf8') + 1;
    if (batch.length && size + statementBytes > batchBytes) {
      await postBatch(batch, { label, sent, total: statements.length });
      sent += batch.length;
      totalStatements += batch.length;
      totalBatches++;
      batch = [];
      size = 0;
    }
    batch.push(statement);
    size += statementBytes;
  }
  if (batch.length) {
    await postBatch(batch, { label, sent, total: statements.length });
    sent += batch.length;
    totalStatements += batch.length;
    totalBatches++;
  }
  console.log(JSON.stringify({ ok: true, file: label, statements: sent }));
}

console.log(
  JSON.stringify(
    {
      ok: true,
      total_files: files.length - startChunk,
      total_batches: totalBatches,
      total_statements: totalStatements
    },
    null,
    2
  )
);

function readStatements(file) {
  if (!fs.existsSync(file)) throw new Error(`Missing SQL file: ${file}`);
  const sql = fs.readFileSync(file, 'utf8');
  const statements = [];
  let current = '';
  let inString = false;

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    current += char;

    if (char === "'") {
      if (inString && sql[index + 1] === "'") {
        current += sql[index + 1];
        index++;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (char === ';' && !inString) {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
    }
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function postBatch(statements, progress) {
  const sql = statements.join('\n');
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql })
    }
  );
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!response.ok || data?.success === false) {
    throw new Error(
      `D1 query batch failed for ${progress.label} at ${progress.sent}/${progress.total}: HTTP ${response.status} ${JSON.stringify(data).slice(0, 1000)}`
    );
  }
  if (!quiet) {
    console.log(
      JSON.stringify({
        ok: true,
        file: progress.label,
        sent: progress.sent + statements.length,
        total: progress.total,
        batch_statements: statements.length
      })
    );
  }
}

function readTomlString(file, key) {
  const content = fs.readFileSync(file, 'utf8');
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = content.match(new RegExp(`^${escaped}\\s*=\\s*\"([^\"]+)\"`, 'mu'));
  return match?.[1] || '';
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
