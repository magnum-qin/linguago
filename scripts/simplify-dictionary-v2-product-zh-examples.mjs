import Database from 'better-sqlite3';
import * as OpenCC from 'opencc-js';

const args = parseArgs(process.argv.slice(2));
const dbPath = args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const stats = {
  db: dbPath,
  dry_run: dryRun,
  product_examples_checked: 0,
  product_examples_updated: 0,
  product_example_localizations_checked: 0,
  product_example_localizations_updated: 0,
  sample_updates: []
};

const exampleRows = db
  .prepare(
    `
  SELECT id, source_text
  FROM product_examples
  WHERE source_lang = 'zh'
    AND needs_review = 0
`
  )
  .all();

const localizationRows = db
  .prepare(
    `
  SELECT id, text, reading
  FROM product_example_localizations
  WHERE lang = 'zh'
    AND needs_review = 0
`
  )
  .all();

stats.product_examples_checked = exampleRows.length;
stats.product_example_localizations_checked = localizationRows.length;

const exampleUpdates = [];
for (const row of exampleRows) {
  const next = {
    source_text: simplify(row.source_text)
  };
  if (next.source_text === row.source_text) continue;
  exampleUpdates.push({ id: row.id, before: row, after: next });
}

const localizationUpdates = [];
for (const row of localizationRows) {
  const next = {
    text: simplify(row.text),
    reading: simplify(row.reading)
  };
  if (next.text === row.text && next.reading === row.reading) continue;
  localizationUpdates.push({ id: row.id, before: row, after: next });
}

stats.product_examples_updated = exampleUpdates.length;
stats.product_example_localizations_updated = localizationUpdates.length;
stats.sample_updates = [
  ...exampleUpdates.slice(0, 5).map((row) => ({
    table: 'product_examples',
    id: row.id,
    before: row.before.source_text,
    after: row.after.source_text
  })),
  ...localizationUpdates.slice(0, 5).map((row) => ({
    table: 'product_example_localizations',
    id: row.id,
    before: row.before.text,
    after: row.after.text
  }))
];

if (!dryRun) {
  const updateExample = db.prepare(`
    UPDATE product_examples
    SET source_text = ?
    WHERE id = ?
  `);
  const updateLocalization = db.prepare(`
    UPDATE product_example_localizations
    SET text = ?, reading = ?
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    for (const row of exampleUpdates) {
      updateExample.run(row.after.source_text, row.id);
    }
    for (const row of localizationUpdates) {
      updateLocalization.run(row.after.text, row.after.reading, row.id);
    }
  });
  tx();
}

console.log(JSON.stringify(stats, null, 2));
db.close();

function simplify(value) {
  if (value === null || value === undefined) return value;
  return normalizeMainlandParticles(converter(String(value)));
}

function normalizeMainlandParticles(value) {
  return String(value)
    .replaceAll('什幺', '什么')
    .replaceAll('为什幺', '为什么')
    .replaceAll('那幺', '那么')
    .replaceAll('这幺', '这么')
    .replaceAll('怎幺', '怎么')
    .replaceAll('多幺', '多么')
    .replace(/幺([？?])/gu, '吗$1')
    .replace(/幺([，,。.!！\s]|$)/gu, '么$1');
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}
