import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const baselinePath = path.resolve(args.baseline || 'config/dictionary-v2-online-baseline.json');
const outPath = args.out ? path.resolve(args.out) : null;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(baselinePath)) throw new Error(`Baseline not found: ${baselinePath}`);

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const hasBlocks = Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_sense_publication_blocks'").get()
);
const publishable = hasBlocks
  ? `ps.status='accepted' AND NOT EXISTS (
      SELECT 1 FROM product_sense_publication_blocks b WHERE b.product_sense_id=ps.id
    )`
  : `ps.status='accepted'`;
const scalar = (sql) => Number(db.prepare(sql).get().n || 0);
const current = {
  entries: scalar(`SELECT COUNT(DISTINCT ps.product_entry_id) AS n FROM product_senses ps WHERE ${publishable}`),
  senses: scalar(`SELECT COUNT(*) AS n FROM product_senses ps WHERE ${publishable}`),
  sense_localizations: scalar(`
    SELECT COUNT(*) AS n
    FROM product_localizations pl
    JOIN product_senses ps ON ps.id=pl.product_sense_id
    WHERE ${publishable} AND pl.needs_review=0
  `),
  examples: scalar(`
    SELECT COUNT(*) AS n
    FROM product_examples ex
    JOIN product_senses ps ON ps.id=ex.product_sense_id
    WHERE ${publishable}
  `),
  example_localizations: scalar(`
    SELECT COUNT(*) AS n
    FROM product_example_localizations el
    JOIN product_examples ex ON ex.id=el.product_example_id
    JOIN product_senses ps ON ps.id=ex.product_sense_id
    WHERE ${publishable}
  `)
};
db.close();

const delta = Object.fromEntries(
  Object.entries(current).map(([key, value]) => [key, value - Number(baseline.counts?.[key] || 0)])
);
const threshold = Number(baseline.release_threshold_new_senses || 5000);
const cohortValid = delta.senses >= 0 && delta.entries >= 0 && delta.sense_localizations >= 0;
const releaseReady = cohortValid && delta.senses >= threshold;
const report = {
  ok: cohortValid,
  status: !cohortValid ? 'behind_online_baseline' : releaseReady ? 'ready' : 'accumulating',
  created_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  baseline: {
    file: path.relative(process.cwd(), baselinePath),
    release: baseline.release,
    source_run_id: baseline.source_run_id,
    published_at: baseline.published_at,
    product_db_sha256: baseline.product_db_sha256,
    worker_version_id: baseline.worker_version_id,
    rollback_worker_version_id: baseline.rollback_worker_version_id,
    d1_time_travel_bookmark: baseline.d1_time_travel_bookmark,
    counts: baseline.counts
  },
  current,
  delta,
  release_threshold_new_senses: threshold,
  release_ready: releaseReady,
  remaining_senses: cohortValid ? Math.max(0, threshold - delta.senses) : null
};

if (outPath) writeJsonAtomic(outPath, report);
console.log(JSON.stringify(report, null, 2));

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith('--')) {
      result[key] = value;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}
