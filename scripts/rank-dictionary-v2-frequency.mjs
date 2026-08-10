import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_fixed_pilot.db';
const DEFAULT_FREQ_DIR = 'data/raw/frequency';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const freqDir = path.resolve(args['freq-dir'] || DEFAULT_FREQ_DIR);
const maxRank = Number(args['max-rank'] || 50_000);
const frequencySource = String(args['frequency-source'] || 'frequencywords');
const onlyUnranked = args['only-unranked'] === 'true';
const backupOutPath = args['backup-out'] ? path.resolve(args['backup-out']) : null;
const dryRun = args['dry-run'] === 'true';

const frequencyFileSets = {
  frequencywords: {
    en: 'frequencywords-en_50k.txt',
    zh: 'frequencywords-zh_50k.txt',
    ja: 'frequencywords-ja_50k.txt',
    'pt-BR': 'frequencywords-pt_br_50k.txt'
  },
  wordfreq: {
    en: 'wordfreq-en-200000.txt',
    zh: 'wordfreq-zh-200000.txt',
    ja: 'wordfreq-ja-200000.txt',
    'pt-BR': 'wordfreq-pt-200000.txt'
  }
};
const frequencyFiles = frequencyFileSets[frequencySource];
if (!frequencyFiles) {
  throw new Error(`Invalid --frequency-source: ${frequencySource}`);
}

const missingFiles = Object.values(frequencyFiles)
  .map((file) => path.join(freqDir, file))
  .filter((file) => !fs.existsSync(file));

if (missingFiles.length) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: 'missing_frequency_files',
        freq_dir: path.relative(process.cwd(), freqDir),
        missing_files: missingFiles.map((file) => path.relative(process.cwd(), file)),
        next_step: 'Run: npm run dict:download'
      },
      null,
      2
    )
  );
  process.exit(2);
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

const statements = {
  reset: db.prepare('UPDATE entries SET frequency_rank = NULL'),
  byEntryKey: db.prepare(`
    SELECT id, frequency_rank
    FROM entries
    WHERE source_lang = ?
      AND normalized_key = ?
  `),
  byForm: db.prepare(`
    SELECT e.id, e.frequency_rank
    FROM entry_forms ef
    JOIN entries e ON e.id = ef.entry_id
    WHERE ef.lang = ?
      AND ef.normalized_form = ?
  `),
  updateRank: db.prepare(`
    UPDATE entries
    SET frequency_rank = CASE
      WHEN frequency_rank IS NULL THEN @rank
      WHEN @rank < frequency_rank THEN @rank
      ELSE frequency_rank
    END,
    updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `)
};

if (backupOutPath) {
  const ranks = db
    .prepare('SELECT id, frequency_rank FROM entries WHERE frequency_rank IS NOT NULL ORDER BY id')
    .all();
  fs.mkdirSync(path.dirname(backupOutPath), { recursive: true });
  fs.writeFileSync(
    backupOutPath,
    `${JSON.stringify({ generated_at: new Date().toISOString(), db: path.relative(process.cwd(), dbPath), ranks })}\n`,
    'utf8'
  );
}

if (!dryRun && args.reset !== 'false' && !onlyUnranked) statements.reset.run();

const updateRanks = db.transaction((updates) => {
  for (const update of updates) statements.updateRank.run(update);
});

const summary = {};
for (const [lang, fileName] of Object.entries(frequencyFiles)) {
  const rows = readFrequencyTerms(path.join(freqDir, fileName), lang, maxRank);
  const updates = [];
  let matchedTerms = 0;
  const matchedEntries = new Set();

  for (const row of rows) {
    const candidates = [
      ...statements.byEntryKey.all(lang, row.normalized),
      ...statements.byForm.all(lang, row.normalized)
    ];
    if (!candidates.length) continue;
    matchedTerms++;
    for (const candidate of candidates) {
      if (onlyUnranked && candidate.frequency_rank !== null) continue;
      matchedEntries.add(candidate.id);
      updates.push({ id: candidate.id, rank: row.rank });
    }
  }

  if (!dryRun) updateRanks(updates);
  summary[lang] = {
    frequency_terms: rows.length,
    matched_terms: matchedTerms,
    matched_entries: matchedEntries.size
  };
}

const rankedByLang = db
  .prepare(
    `
    SELECT source_lang, COUNT(1) AS c
    FROM entries
    WHERE frequency_rank IS NOT NULL
    GROUP BY source_lang
    ORDER BY source_lang
  `
  )
  .all();

const topRanked = db
  .prepare(
    `
    SELECT word, source_lang, frequency_rank
    FROM entries
    WHERE frequency_rank IS NOT NULL
    ORDER BY frequency_rank, source_lang, word
    LIMIT 30
  `
  )
  .all();

db.close();

console.log(
  JSON.stringify(
    {
      ok: true,
      db: path.relative(process.cwd(), dbPath),
      freq_dir: path.relative(process.cwd(), freqDir),
      max_rank: maxRank,
      frequency_source: frequencySource,
      only_unranked: onlyUnranked,
      dry_run: dryRun,
      backup_out: backupOutPath ? path.relative(process.cwd(), backupOutPath) : null,
      summary,
      ranked_by_lang: rankedByLang,
      top_ranked: topRanked
    },
    null,
    2
  )
);

function readFrequencyTerms(file, lang, limit) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({ term: line.split(/\s+/)[0]?.trim(), rank: index + 1 }))
    .filter((row) => row.term && !isHeader(row.term, lang))
    .slice(0, limit)
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      normalized: normalize(row.term)
    }));
}

function isHeader(term, lang) {
  const lower = String(term || '').toLowerCase();
  return lower === lang.toLowerCase() || (lang === 'zh' && lower === 'zh-cn') || (lang === 'pt-BR' && lower === 'pt');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const next = argv[i + 1];
    result[arg.slice(2)] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return result;
}
