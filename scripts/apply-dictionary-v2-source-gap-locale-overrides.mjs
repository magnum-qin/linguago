import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const overridesPath = requiredPath(args.overrides, 'overrides');
const outPath = requiredPath(args.out, 'out');

const report = readJson(reportPath);
const config = readJson(overridesPath);
if (!Array.isArray(report.generated)) throw new Error('Report must contain a generated array');
if (!Array.isArray(config.overrides) || !config.overrides.length) {
  throw new Error('Override config must contain a non-empty overrides array');
}

const overrides = new Map();
for (const override of config.overrides) {
  validateOverride(override);
  const key = overrideKey(override);
  if (overrides.has(key)) throw new Error(`Duplicate override: ${key}`);
  overrides.set(key, override);
}

const applied = [];
const generated = structuredClone(report.generated);
for (const row of generated) {
  const candidate = candidateKey(row);
  if (!candidate) continue;
  for (const [key, override] of overrides) {
    if (!key.startsWith(`${candidate}:`)) continue;
    const localization = row?.output?.localizations?.[override.language];
    if (!localization) throw new Error(`Missing ${override.language} localization for ${candidate}`);
    const actual = localization[override.field];
    if (actual !== override.expected) {
      throw new Error(
        `Override source mismatch for ${key}: expected ${JSON.stringify(override.expected)}, got ${JSON.stringify(actual)}`
      );
    }
    localization[override.field] = override.replacement;
    applied.push({
      candidate_key: candidate,
      language: override.language,
      field: override.field,
      from: override.expected,
      to: override.replacement
    });
  }
}

if (applied.length !== overrides.size) {
  const appliedKeys = new Set(
    applied.map((row) => `${row.candidate_key}:${row.language}:${row.field}`)
  );
  const unused = [...overrides.keys()].filter((key) => !appliedKeys.has(key));
  throw new Error(`Unused overrides: ${unused.join(', ')}`);
}

const output = {
  ...report,
  generated_at: new Date().toISOString(),
  derived_from: {
    ...(report.derived_from || {}),
    locale_override_report: path.relative(process.cwd(), reportPath),
    locale_overrides: path.relative(process.cwd(), overridesPath)
  },
  locale_override_summary: {
    applied: applied.length,
    changes: applied
  },
  generated
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), applied: applied.length }, null, 2));

function validateOverride(override) {
  if (!Number.isInteger(Number(override?.source_entry_id))) throw new Error('Override source_entry_id must be an integer');
  if (!Number.isInteger(Number(override?.source_sense_id))) throw new Error('Override source_sense_id must be an integer');
  if (!['en', 'pt-BR', 'zh', 'ja'].includes(override?.language)) throw new Error('Override language is invalid');
  if (!['term', 'definition', 'reading', 'pronunciation'].includes(override?.field)) {
    throw new Error('Override field is invalid');
  }
  if (typeof override?.expected !== 'string' || typeof override?.replacement !== 'string') {
    throw new Error('Override expected and replacement must be strings');
  }
  if (override.expected === override.replacement) throw new Error('Override replacement must change the value');
}

function candidateKey(row) {
  if (/^\d+:\d+$/.test(String(row?.candidate_key || ''))) return String(row.candidate_key);
  const entryId = Number(row?.source_entry_id);
  const senseId = Number(row?.source_sense_id ?? row?.output?.source_sense_id);
  if (!Number.isInteger(entryId) || !Number.isInteger(senseId)) return null;
  return `${entryId}:${senseId}`;
}

function overrideKey(override) {
  return `${Number(override.source_entry_id)}:${Number(override.source_sense_id)}:${override.language}:${override.field}`;
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
