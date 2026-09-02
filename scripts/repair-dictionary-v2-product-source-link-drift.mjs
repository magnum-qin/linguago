import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(
  args.db || 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db'
);
const sourceDbPath = path.resolve(args['source-db'] || 'data/processed/linguago_v2_full.db');
const configPath = path.resolve(
  args.config || 'config/dictionary-overrides/source-link-drift-repairs-v1.json'
);
const apply = args.apply === 'true';

for (const filePath of [dbPath, sourceDbPath, configPath]) {
  if (!fs.existsSync(filePath)) throw new Error(`Required file not found: ${filePath}`);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const db = new Database(dbPath, { readonly: !apply });
db.pragma('busy_timeout = 30000');
db.prepare('ATTACH DATABASE ? AS source_db').run(sourceDbPath);

const getLink = db.prepare(`
  SELECT id, source_entry_id, source_sense_id, source_lang, source_word, match_method
  FROM product_sense_source_links WHERE id = ?
`);
const getTarget = db.prepare(`
  SELECT e.id AS source_entry_id, e.source_lang, e.word,
         s.id AS source_sense_id, s.gloss_key
  FROM source_db.entries e
  JOIN source_db.senses s ON s.entry_id = e.id
  WHERE e.id = ? AND s.id = ?
`);
const updateLink = apply
  ? db.prepare(`
      UPDATE product_sense_source_links
      SET source_entry_id = @new_source_entry_id,
          source_sense_id = @new_source_sense_id
      WHERE id = @link_id
        AND source_entry_id = @old_source_entry_id
        AND source_sense_id = @old_source_sense_id
        AND source_lang = @source_lang
        AND source_word = @source_word
        AND match_method = 'source_gap_manual_residual'
    `)
  : null;

const checked = config.repairs.map((repair) => {
  const link = getLink.get(repair.link_id);
  const target = getTarget.get(repair.new_source_entry_id, repair.new_source_sense_id);
  const errors = [];
  if (!link) errors.push('link_not_found');
  else {
    if (link.source_entry_id !== repair.old_source_entry_id) errors.push('old_source_entry_id_changed');
    if (link.source_sense_id !== repair.old_source_sense_id) errors.push('old_source_sense_id_changed');
    if (link.source_lang !== repair.source_lang) errors.push('source_lang_changed');
    if (link.source_word !== repair.source_word) errors.push('source_word_changed');
    if (link.match_method !== 'source_gap_manual_residual') errors.push('match_method_changed');
  }
  if (!target) errors.push('target_not_found');
  else {
    if (target.source_lang !== repair.source_lang) errors.push('target_lang_mismatch');
    if (target.word !== repair.source_word) errors.push('target_word_mismatch');
    if (target.gloss_key !== repair.expected_gloss) errors.push('target_gloss_mismatch');
  }
  return { repair, valid: errors.length === 0, errors };
});

if (checked.some((row) => !row.valid)) {
  process.stdout.write(`${JSON.stringify({ apply, checked }, null, 2)}\n`);
  db.close();
  process.exitCode = 2;
} else {
  let updated = 0;
  if (apply) {
    db.transaction(() => {
      for (const { repair } of checked) updated += updateLink.run(repair).changes;
      if (updated !== checked.length) throw new Error(`Expected ${checked.length} updates, got ${updated}`);
    })();
  }
  process.stdout.write(`${JSON.stringify({ apply, checked: checked.length, updated }, null, 2)}\n`);
  db.close();
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      parsed[key] = next;
      index++;
    } else parsed[key] = 'true';
  }
  return parsed;
}
