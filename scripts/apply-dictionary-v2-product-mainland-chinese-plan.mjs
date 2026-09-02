import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = requiredPath(args.db, 'db');
const planPath = requiredPath(args.plan, 'plan');
const aliasPath = path.resolve(args.aliases || 'config/dictionary-overrides/product-entry-form-aliases.json');
const apply = args.apply === 'true';
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
if (plan.version !== 'v1-mainland-simplified') throw new Error(`Unsupported plan version: ${plan.version}`);

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');
const getLocalization = db.prepare(`
  SELECT l.id, l.term, l.definition, l.source, s.status AS sense_status
  FROM product_localizations l JOIN product_senses s ON s.id=l.product_sense_id
  WHERE l.id=?
`);
const updateLocalization = db.prepare(`
  UPDATE product_localizations
  SET term=@term, definition=@definition,
      source=@source, confidence=CASE WHEN confidence IS NULL THEN 0.99 ELSE confidence END
  WHERE id=@id
`);
const getEntry = db.prepare('SELECT id, headword, normalized_key, primary_lang FROM product_entries WHERE id=?');
const updateEntry = db.prepare('UPDATE product_entries SET headword=?, normalized_key=? WHERE id=?');
const stats = { apply, aliases_seen: 0, aliases_added: 0, headwords_seen: 0, headwords_applied: 0, repairs_seen: 0, repairs_applied: 0, skipped: [] };

const validHeadwords = [];
const plannedHeadwordById = new Map();
for (const repair of plan.headword_repairs || []) {
  stats.headwords_seen++;
  const entry = getEntry.get(repair.entry_id);
  if (!entry || entry.primary_lang !== 'zh' || entry.headword !== repair.before) {
    stats.skipped.push({ kind: 'headword', entry_id: repair.entry_id, reason: 'source_drift' });
    continue;
  }
  const collision = db.prepare('SELECT id FROM product_entries WHERE primary_lang=? AND headword=? AND id<>?').get('zh', repair.after, repair.entry_id);
  if (collision) {
    stats.skipped.push({ kind: 'headword', entry_id: repair.entry_id, reason: 'target_collision' });
    continue;
  }
  validHeadwords.push(repair);
  plannedHeadwordById.set(repair.entry_id, repair.after);
}

const validAliases = [];
for (const alias of plan.aliases || []) {
  stats.aliases_seen++;
  const entry = getEntry.get(alias.entry_id);
  const expectedHeadword = plannedHeadwordById.get(alias.entry_id) || entry?.headword;
  if (!entry || expectedHeadword !== alias.headword || entry.primary_lang !== alias.lang) {
    stats.skipped.push({ kind: 'alias', entry_id: alias.entry_id, reason: 'target_drift' });
    continue;
  }
  validAliases.push(alias);
}

const validRepairs = [];
for (const repair of plan.localization_repairs || []) {
  stats.repairs_seen++;
  const current = getLocalization.get(repair.localization_id);
  if (!current) {
    stats.skipped.push({ kind: 'localization', id: repair.localization_id, reason: 'missing' });
    continue;
  }
  if (repair.changes.term && current.term !== repair.changes.term.before) {
    stats.skipped.push({ kind: 'localization', id: repair.localization_id, reason: 'term_drift' });
    continue;
  }
  if (repair.changes.definition && current.definition !== repair.changes.definition.before) {
    stats.skipped.push({ kind: 'localization', id: repair.localization_id, reason: 'definition_drift' });
    continue;
  }
  validRepairs.push({ repair, current });
}

if (apply) {
  db.transaction(() => {
    for (const repair of validHeadwords) {
      stats.headwords_applied += updateEntry.run(repair.after, repair.after.normalize('NFKC').trim().toLocaleLowerCase(), repair.entry_id).changes;
    }
    for (const { repair, current } of validRepairs) {
      const term = repair.changes.term?.after ?? current.term;
      const definition = repair.changes.definition?.after ?? current.definition;
      const source = appendSource(current.source, 'deterministic:mainland-simplified-v1');
      stats.repairs_applied += updateLocalization.run({ id: repair.localization_id, term, definition, source }).changes;
    }
  })();
  const aliasesConfig = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
  const existing = new Set((aliasesConfig.aliases || []).map(aliasKey));
  for (const alias of validAliases) {
    const clean = {
      entry_id: alias.entry_id,
      headword: alias.headword,
      lang: alias.lang,
      form: alias.form,
      form_type: alias.form_type,
      source: alias.source,
      confidence: alias.confidence,
      note: alias.note
    };
    if (existing.has(aliasKey(clean))) continue;
    aliasesConfig.aliases.push(clean);
    existing.add(aliasKey(clean));
    stats.aliases_added++;
  }
  aliasesConfig.version = 'v1-mainland-simplified';
  fs.writeFileSync(aliasPath, `${JSON.stringify(aliasesConfig, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ ...stats, valid_aliases: validAliases.length, valid_headwords: validHeadwords.length, valid_repairs: validRepairs.length }, null, 2));
db.close();

function appendSource(source, marker) {
  const parts = String(source || '').split('+').filter(Boolean);
  if (!parts.includes(marker)) parts.push(marker);
  return parts.join('+');
}
function aliasKey(row) { return `${row.entry_id}\u0000${row.lang}\u0000${row.form}\u0000${row.form_type}`; }
function requiredPath(value, name) {
  if (!value) throw new Error(`Missing --${name}`);
  const file = path.resolve(value);
  if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`);
  return file;
}
function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index++) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    out[key] = next && !next.startsWith('--') ? argv[++index] : 'true';
  }
  return out;
}
