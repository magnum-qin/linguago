import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DB = 'data/processed/linguago_v2_product_top5000_freedict_filtered_candidate.db';
const DEFAULT_OVERRIDES = 'config/dictionary-overrides/product-sense-localizations.json';

const args = parseArgs(process.argv.slice(2));
const dbPath = path.resolve(args.db || DEFAULT_DB);
const overridesPath = path.resolve(args.overrides || DEFAULT_OVERRIDES);
const apply = args.apply === 'true' || args.apply === true;
const outPath = args.out ? path.resolve(args.out) : null;

if (!fs.existsSync(dbPath)) throw new Error(`Database not found: ${dbPath}`);
if (!fs.existsSync(overridesPath)) throw new Error(`Overrides not found: ${overridesPath}`);

const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'));
if (!Array.isArray(overrides)) throw new Error('Override file must contain an array.');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 30000');

const statements = {
  findByOrder: db.prepare(`
    SELECT s.id, s.product_entry_id, s.sense_order, s.part_of_speech, s.gloss_key
    FROM product_entries e
    JOIN product_senses s ON s.product_entry_id = e.id
    WHERE e.headword = @headword
      AND e.primary_lang = @primary_lang
      AND s.sense_order = @sense_order
    ORDER BY s.id
    LIMIT 1
  `),
  findByGloss: db.prepare(`
    SELECT s.id, s.product_entry_id, s.sense_order, s.part_of_speech, s.gloss_key
    FROM product_entries e
    JOIN product_senses s ON s.product_entry_id = e.id
    WHERE e.headword = @headword
      AND e.primary_lang = @primary_lang
      AND s.gloss_key = @gloss_key
    ORDER BY s.id
    LIMIT 1
  `),
  findById: db.prepare(`
    SELECT s.id, s.product_entry_id, s.sense_order, s.part_of_speech, s.gloss_key
    FROM product_senses s
    WHERE s.id = ?
  `),
  updateSense: db.prepare(`
    UPDATE product_senses
    SET part_of_speech = COALESCE(@part_of_speech, part_of_speech),
        gloss_key = COALESCE(@gloss_key, gloss_key),
        confidence = COALESCE(@confidence, confidence),
        status = COALESCE(@status, status)
    WHERE id = @sense_id
  `),
  getLocalization: db.prepare(`
    SELECT id
    FROM product_localizations
    WHERE product_sense_id = ?
      AND lang = ?
  `),
  updateLocalization: db.prepare(`
    UPDATE product_localizations
    SET term = @term,
        reading = @reading,
        reading_system = @reading_system,
        pronunciation = @pronunciation,
        pronunciation_system = @pronunciation_system,
        definition = @definition,
        source = @source,
        confidence = @confidence,
        needs_review = 0
    WHERE id = @id
  `),
  insertLocalization: db.prepare(`
    INSERT INTO product_localizations (
      product_sense_id,
      lang,
      term,
      reading,
      reading_system,
      pronunciation,
      pronunciation_system,
      definition,
      source,
      confidence,
      needs_review
    )
    VALUES (
      @product_sense_id,
      @lang,
      @term,
      @reading,
      @reading_system,
      @pronunciation,
      @pronunciation_system,
      @definition,
      @source,
      @confidence,
      0
    )
  `)
};

const stats = {
  db: path.relative(process.cwd(), dbPath),
  overrides: path.relative(process.cwd(), overridesPath),
  apply,
  seen: overrides.length,
  resolved_senses: 0,
  updated_senses: 0,
  inserted_localizations: 0,
  updated_localizations: 0,
  skipped: []
};

const resolved = [];

function resolveSense(row) {
  const target = row.target || {};
  if (target.sense_id) return statements.findById.get(Number(target.sense_id));
  if (target.headword && target.primary_lang && target.sense_order) {
    return statements.findByOrder.get({
      headword: target.headword,
      primary_lang: target.primary_lang,
      sense_order: Number(target.sense_order)
    });
  }
  if (target.headword && target.primary_lang && target.gloss_key) {
    return statements.findByGloss.get({
      headword: target.headword,
      primary_lang: target.primary_lang,
      gloss_key: target.gloss_key
    });
  }
  return null;
}

function normalizeLocalization(localization, lang, row) {
  const term = cleanText(localization.term);
  const definition = cleanText(localization.definition);
  if (!term || !definition) {
    throw new Error(`Localization for ${lang} requires term and definition.`);
  }
  return {
    lang,
    term,
    reading: cleanNullable(localization.reading),
    reading_system: cleanNullable(localization.reading_system),
    pronunciation: cleanNullable(localization.pronunciation),
    pronunciation_system: cleanNullable(localization.pronunciation_system),
    definition,
    source: row.source || 'manual:product-localization-override',
    confidence: Number(localization.confidence ?? row.confidence ?? 0.95)
  };
}

for (const row of overrides) {
  const sense = resolveSense(row);
  if (!sense) {
    stats.skipped.push({ target: row.target, reason: 'sense_not_found' });
    continue;
  }
  const localizations = Object.entries(row.localizations || {}).map(([lang, localization]) => {
    if (!['en', 'zh', 'ja', 'pt-BR'].includes(lang)) {
      throw new Error(`Invalid lang in override: ${lang}`);
    }
    return normalizeLocalization(localization, lang, row);
  });
  if (!localizations.length) {
    stats.skipped.push({ target: row.target, reason: 'no_localizations' });
    continue;
  }
  stats.resolved_senses++;
  resolved.push({ row, sense, localizations });
}

if (apply) {
  db.transaction(() => {
    for (const item of resolved) {
      const senseChanges = statements.updateSense.run({
        sense_id: item.sense.id,
        part_of_speech: cleanNullable(item.row.part_of_speech),
        gloss_key: cleanNullable(item.row.gloss_key),
        confidence: item.row.sense_confidence == null ? null : Number(item.row.sense_confidence),
        status: cleanNullable(item.row.status)
      }).changes;
      stats.updated_senses += senseChanges;
      for (const localization of item.localizations) {
        const existing = statements.getLocalization.get(item.sense.id, localization.lang);
        const payload = {
          ...localization,
          product_sense_id: item.sense.id
        };
        if (existing) {
          stats.updated_localizations += statements.updateLocalization.run({ ...payload, id: existing.id }).changes;
        } else {
          stats.inserted_localizations += statements.insertLocalization.run(payload).changes;
        }
      }
    }
  })();
}

const serialized = `${JSON.stringify(
  {
    ok: stats.skipped.length === 0,
    stats,
    preview: resolved.slice(0, 20).map((item) => ({
      target: item.row.target,
      sense_id: item.sense.id,
      sense_order: item.sense.sense_order,
      langs: item.localizations.map((localization) => localization.lang)
    }))
  },
  null,
  2
)}\n`;
if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serialized, 'utf8');
}
process.stdout.write(serialized);
db.close();

function cleanText(value) {
  return String(value || '').trim();
}

function cleanNullable(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

function parseArgs(argv) {
  const output = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    output[key] = next && !next.startsWith('--') ? next : 'true';
    if (next && !next.startsWith('--')) i++;
  }
  return output;
}
