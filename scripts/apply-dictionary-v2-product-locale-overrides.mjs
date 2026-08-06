import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const overridesPath = requiredPath(args.overrides, 'overrides');
const outPath = requiredPath(args.out, 'out');
const apply = args.apply === 'true';

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
const config = readJson(overridesPath);
if (!Array.isArray(config.overrides) || !config.overrides.length) {
  throw new Error('Override config must contain a non-empty overrides array');
}

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const findLocalization = db.prepare(`
  SELECT DISTINCT
    pe.id AS entry_id,
    pe.headword,
    ps.id AS sense_id,
    pl.id AS localization_id,
    pl.lang,
    pl.term,
    pl.definition
  FROM product_sense_source_links link
  JOIN product_senses ps ON ps.id = link.product_sense_id
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE link.source_sense_id = @sourceSenseId
    AND pl.lang = @language
`);
const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term = @replacement
  WHERE id = @localizationId
    AND term = @expected
`);

const changes = [];
const seen = new Set();
for (const override of config.overrides) {
  validateOverride(override);
  if (override.field !== 'term') throw new Error('Product DB overrides currently support only field=term');
  const key = `${Number(override.source_entry_id)}:${Number(override.source_sense_id)}:${override.language}:${override.field}`;
  if (seen.has(key)) throw new Error(`Duplicate override: ${key}`);
  seen.add(key);

  const rows = findLocalization.all({
    sourceSenseId: Number(override.source_sense_id),
    language: override.language
  });
  if (rows.length !== 1) throw new Error(`Expected one localization for ${key}, found ${rows.length}`);
  const row = rows[0];
  if (row.term !== override.expected) {
    throw new Error(
      `Override source mismatch for ${key}: expected ${JSON.stringify(override.expected)}, got ${JSON.stringify(row.term)}`
    );
  }
  changes.push({
    key,
    source_entry_id: Number(override.source_entry_id),
    source_sense_id: Number(override.source_sense_id),
    entry_id: row.entry_id,
    headword: row.headword,
    sense_id: row.sense_id,
    localization_id: row.localization_id,
    language: row.lang,
    from: override.expected,
    to: override.replacement
  });
}

if (apply) {
  db.transaction(() => {
    for (const change of changes) {
      const result = updateLocalization.run({
        localizationId: change.localization_id,
        expected: change.from,
        replacement: change.to
      });
      if (result.changes !== 1) throw new Error(`Update failed for ${change.key}`);
    }
  })();
}
db.close();

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  db: path.relative(process.cwd(), dbPath),
  overrides: path.relative(process.cwd(), overridesPath),
  apply,
  matched: changes.length,
  updated: apply ? changes.length : 0,
  changes
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), apply, matched: changes.length, updated: output.updated }, null, 2));

function validateOverride(override) {
  if (!Number.isInteger(Number(override?.source_entry_id))) throw new Error('Override source_entry_id must be an integer');
  if (!Number.isInteger(Number(override?.source_sense_id))) throw new Error('Override source_sense_id must be an integer');
  if (!['en', 'pt-BR', 'zh', 'ja'].includes(override?.language)) throw new Error('Override language is invalid');
  if (typeof override?.field !== 'string') throw new Error('Override field is required');
  if (typeof override?.expected !== 'string' || typeof override?.replacement !== 'string') {
    throw new Error('Override expected and replacement must be strings');
  }
  if (override.expected === override.replacement) throw new Error('Override replacement must change the value');
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}
