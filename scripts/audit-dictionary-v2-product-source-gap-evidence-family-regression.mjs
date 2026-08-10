import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const legacyPath = requiredPath(args.legacy, 'legacy');
const currentPath = requiredPath(args.current, 'current');
const outPath = requiredPath(args.out, 'out');
const blocksOutPath = args['blocks-out'] ? path.resolve(args['blocks-out']) : null;

const legacy = readJson(legacyPath);
const current = readJson(currentPath);
if (legacy?.policy?.evidence_family_policy !== 'legacy') {
  throw new Error('Legacy report does not use the legacy evidence-family policy');
}
if (current?.policy?.evidence_family_policy !== 'wiktionary') {
  throw new Error('Current report does not use the wiktionary evidence-family policy');
}

const currentBySense = new Map(
  (current.validations || []).map((row) => [Number(row.product_sense_id), row])
);
const comparisons = (legacy.validations || [])
  .map((oldRow) => {
    const newRow = currentBySense.get(Number(oldRow.product_sense_id));
    if (!newRow) return null;
    return {
      product_entry_id: Number(oldRow.product_entry_id),
      product_sense_id: Number(oldRow.product_sense_id),
      source_entry_id: Number(oldRow.source_entry_id),
      source_sense_id: Number(oldRow.source_sense_id),
      word: oldRow.word,
      source_lang: oldRow.source_lang,
      anchor: oldRow.anchor,
      legacy_decision: oldRow.decision,
      current_decision: newRow.decision,
      changed_languages: changedLanguages(oldRow, newRow),
      legacy_languages: oldRow.languages,
      current_languages: newRow.languages
    };
  })
  .filter(Boolean);

const downgraded = comparisons.filter(
  (row) => row.legacy_decision === 'supported' && row.current_decision !== 'supported'
);
const upgraded = comparisons.filter(
  (row) => row.legacy_decision !== 'supported' && row.current_decision === 'supported'
);
const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  legacy_report: path.relative(process.cwd(), legacyPath),
  current_report: path.relative(process.cwd(), currentPath),
  policy: {
    automatic_mutation: false,
    downgrade_action: 'manual_review_before_block',
    kaikki_and_wikdict_family: 'wiktionary'
  },
  summary: {
    compared: comparisons.length,
    unchanged: comparisons.filter((row) => row.legacy_decision === row.current_decision).length,
    changed: comparisons.filter((row) => row.legacy_decision !== row.current_decision).length,
    supported_downgraded: downgraded.length,
    supported_upgraded: upgraded.length,
    downgrade_decisions: countBy(downgraded.map((row) => row.current_decision)),
    downgrade_languages: countBy(downgraded.flatMap((row) => row.changed_languages))
  },
  downgraded,
  upgraded
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
if (blocksOutPath) {
  const blocks = downgraded.map((row) => ({
    target: { sense_id: row.product_sense_id },
    block_code: 'non_publishable',
    rationale:
      'Historical source-gap evidence treated Kaikki and WikDict as independent, but both are Wiktionary-derived. The current independent-family audit requires manual review.',
    recommendation:
      'Restore publication only after a non-Wiktionary lexical source supports every downgraded target language.'
  }));
  fs.mkdirSync(path.dirname(blocksOutPath), { recursive: true });
  fs.writeFileSync(blocksOutPath, `${JSON.stringify(blocks, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify({ ok: true, out: path.relative(process.cwd(), outPath), summary: output.summary }, null, 2));

function changedLanguages(oldRow, newRow) {
  return Object.keys({ ...(oldRow.languages || {}), ...(newRow.languages || {}) }).filter(
    (lang) => oldRow.languages?.[lang]?.decision !== newRow.languages?.[lang]?.decision
  );
}

function countBy(values) {
  return Object.fromEntries(
    [...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length])
  );
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
