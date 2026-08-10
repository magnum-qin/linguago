import fs from 'node:fs';
import path from 'node:path';

const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const args = parseArgs(process.argv.slice(2));
const reportPath = requiredPath(args.report, 'report');
const repairPath = requiredPath(args.repair, 'repair');
const outPath = requiredPath(args.out, 'out');
const report = readJson(reportPath);
const repair = readJson(repairPath);
const sourceEntryId = Number(repair.source_entry_id);

if (!Number.isInteger(sourceEntryId)) throw new Error('Repair requires integer source_entry_id');
if (repair.kind !== 'human_reviewed_definition_contract') {
  throw new Error('Repair kind must be human_reviewed_definition_contract');
}

const contracts = repair.definition_contract;
if (!contracts || typeof contracts !== 'object' || Array.isArray(contracts)) {
  throw new Error('Repair requires definition_contract');
}
for (const lang of LANGS) {
  if (typeof contracts[lang] !== 'string' || !contracts[lang].trim()) {
    throw new Error(`Repair requires non-empty ${lang} definition contract`);
  }
}

const candidates = Array.isArray(report.selected) ? report.selected : [];
const candidate = candidates.find((row) => Number(row?.source_entry_id) === sourceEntryId);
if (!candidate) throw new Error(`Source entry ${sourceEntryId} not found in report`);

const selected = structuredClone(candidate);
selected.candidate_evidence_review = selected.candidate_evidence_review || {};
selected.candidate_evidence_review.definition_contract = Object.fromEntries(
  LANGS.map((lang) => [lang, contracts[lang].trim()])
);
selected.targeted_definition_repair = {
  kind: repair.kind,
  reason: String(repair.reason || '').trim() || null,
  reviewed_at: String(repair.reviewed_at || '').trim() || null,
  publication_evidence: false,
  requires_new_generation: true,
  requires_deterministic_reverse_evidence: true,
  requires_independent_no_correction_consensus: true,
  automatic_promotion: false
};
selected.promote_allowed = false;

const output = {
  ok: true,
  generated_at: new Date().toISOString(),
  source_report: relative(reportPath),
  repair_config: relative(repairPath),
  policy: selected.targeted_definition_repair,
  selected_count: 1,
  selected: [selected]
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, out: relative(outPath), source_entry_id: sourceEntryId }, null, 2));

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  return path.resolve(value);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function relative(filePath) {
  return path.relative(process.cwd(), filePath);
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
    } else parsed[key] = true;
  }
  return parsed;
}
