import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const inputPath = requiredPath(args.input, 'input');
const dbPath = requiredPath(args.db, 'db');
const outPath = path.resolve(args.out || 'logs/localized-sense-structural-publication-blocks.json');
const reportPath = path.resolve(args.report || 'logs/localized-sense-structural-block-plan-report.json');
const input = readJson(inputPath);
const issues = Array.isArray(input.deterministic_localization_repairs)
  ? input.deterministic_localization_repairs
  : [];
const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 30000');

const findCandidates = db.prepare(`
  SELECT ps.id AS sense_id, ps.product_entry_id AS entry_id, ps.sense_order,
         ps.status, pe.headword, pe.primary_lang,
         pl.lang, pl.term, pl.definition, pl.needs_review
  FROM product_senses ps
  JOIN product_entries pe ON pe.id = ps.product_entry_id
  JOIN product_localizations pl ON pl.product_sense_id = ps.id
  WHERE ps.product_entry_id = ? AND pl.lang = ?
  ORDER BY ps.sense_order, ps.id
`);

const blocks = [];
const unresolved = [];
for (const issue of issues) {
  const matches = findCandidates.all(Number(issue.entry_id), issue.query_lang)
    .filter((row) => normalize(row.term) === normalize(issue.query_term));
  if (matches.length !== 1) {
    unresolved.push({
      ...issue,
      resolution: matches.length ? 'ambiguous_product_sense_match' : 'missing_product_sense_match',
      matching_sense_ids: matches.map((row) => row.sense_id)
    });
    continue;
  }
  const match = matches[0];
  blocks.push({
    target: { sense_id: match.sense_id },
    block_code: 'non_publishable',
    rationale: `Structural localization requires sense-level repair: ${issue.reason}; ${issue.query_lang} term=${JSON.stringify(issue.query_term)}.`,
    recommendation: 'Split the composite or placeholder localization into independently evidenced four-language senses before republishing.',
    evidence: {
      candidate_id: issue.candidate_id,
      entry_id: issue.entry_id,
      headword: issue.headword,
      sense_order: match.sense_order,
      lang: issue.query_lang,
      expected_term: issue.query_term,
      expected_definition: match.definition
    }
  });
}

const duplicateSenseIds = duplicates(blocks.map((row) => Number(row.target.sense_id)));
const ok = issues.length > 0 && unresolved.length === 0 && duplicateSenseIds.length === 0;
const report = {
  ok,
  created_at: new Date().toISOString(),
  database_write: false,
  inputs: { input: relative(inputPath), db: relative(dbPath) },
  policy: {
    exact_entry_language_term_match_required: true,
    unique_product_sense_required: true,
    automatic_sense_split_allowed: false
  },
  summary: {
    structural_issues: issues.length,
    resolved_unique_senses: blocks.length,
    unresolved: unresolved.length,
    duplicate_sense_ids: duplicateSenseIds.length
  },
  blocks,
  unresolved,
  duplicate_sense_ids: duplicateSenseIds
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(blocks, null, 2)}\n`, 'utf8');
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok, out: relative(outPath), report: relative(reportPath), summary: report.summary }, null, 2));
db.close();
process.exitCode = ok ? 0 : 2;

function duplicates(values) {
  const seen = new Set(), repeated = new Set();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort((a, b) => a - b);
}
function normalize(value) { return String(value || '').normalize('NFKC').trim().toLocaleLowerCase(); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function relative(file) { return path.relative(process.cwd(), file); }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2), next = argv[i + 1];
    out[key] = next && !next.startsWith('--') ? argv[++i] : 'true';
  }
  return out;
}
