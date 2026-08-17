import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || 'logs/naer-government-terminology-datasets.json');
const outDir = path.resolve(args['out-dir'] || 'data/raw/government-lexicons/naer');
const concurrency = Math.max(1, Number(args.concurrency || 6));
const timeoutMs = Math.max(10_000, Number(args['timeout-ms'] || 120_000));
if (!fs.existsSync(reportPath)) throw new Error(`Report not found: ${reportPath}`);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const datasets = (report.datasets || []).filter((row) => row.download_urls?.length);
fs.mkdirSync(outDir, { recursive: true });

let cursor = 0;
const results = [];
await Promise.all(Array.from({ length: concurrency }, (_, worker) => runWorker(worker)));
results.sort((a, b) => Number(a.dataset_id) - Number(b.dataset_id));
const summary = {
  requested: datasets.length,
  downloaded: results.filter((row) => row.status === 'downloaded').length,
  reused: results.filter((row) => row.status === 'reused').length,
  failed: results.filter((row) => row.status === 'failed').length,
  bytes: results.reduce((sum, row) => sum + Number(row.bytes || 0), 0)
};
const manifestPath = path.join(outDir, 'manifest.json');
fs.writeFileSync(manifestPath, `${JSON.stringify({
  ok: summary.failed === 0,
  generated_at: new Date().toISOString(),
  source_report: path.relative(process.cwd(), reportPath),
  summary,
  datasets: results
}, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ manifest: path.relative(process.cwd(), manifestPath), ...summary }, null, 2));

async function runWorker(worker) {
  while (cursor < datasets.length) {
    const dataset = datasets[cursor++];
    const filePath = path.join(outDir, `${dataset.dataset_id}.csv`);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 20) {
      results.push(result(dataset, filePath, 'reused', null));
      continue;
    }
    try {
      const response = await fetch(dataset.download_urls[0], {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'LinguaGo dictionary evidence importer/1.0' }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 20) throw new Error(`response_too_small:${bytes.length}`);
      fs.writeFileSync(filePath, bytes);
      results.push(result(dataset, filePath, 'downloaded', null));
      console.log(`[${results.length}/${datasets.length}] worker=${worker} id=${dataset.dataset_id} bytes=${bytes.length}`);
    } catch (error) {
      results.push(result(dataset, filePath, 'failed', error instanceof Error ? error.message : String(error)));
      console.error(`[failed] worker=${worker} id=${dataset.dataset_id} ${error instanceof Error ? error.message : error}`);
    }
  }
}

function result(dataset, filePath, status, error) {
  return {
    dataset_id: dataset.dataset_id,
    title: dataset.title,
    license: dataset.license,
    source_url: dataset.download_urls[0],
    file: path.relative(process.cwd(), filePath),
    status,
    bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0,
    error
  };
}
function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith('--')) {
      parsed[key] = value;
      i += 1;
    } else parsed[key] = true;
  }
  return parsed;
}
