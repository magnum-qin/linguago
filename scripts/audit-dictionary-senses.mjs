import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';

const DB_FILE = path.resolve(process.argv[2] || 'data/dictionary.sqlite');
const REPORT_FILE = path.resolve(process.argv[3] || 'data/processed/dictionary-sense-audit.json');
const LIMIT = Number(process.env.AUDIT_LIMIT || 200);
const SQL_WASM = path.resolve('node_modules/sql.js/dist/sql-wasm.wasm');
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];

if (!fs.existsSync(DB_FILE)) throw new Error(`Database not found: ${DB_FILE}`);

const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(SQL_WASM) });
const db = new SQL.Database(fs.readFileSync(DB_FILE));

const entries = selectAll(
  `
    SELECT e.id, e.source_lang, e.headword, e.normalized_headword, e.quality_score,
           COUNT(s.id) AS sense_count
    FROM dictionary_entries e
    JOIN dictionary_senses s ON s.entry_id = e.id
    WHERE e.status = 'accepted'
    GROUP BY e.id
    HAVING sense_count > 1
    ORDER BY e.quality_score DESC, sense_count DESC, e.updated_at DESC
    LIMIT ?
  `,
  [LIMIT]
);

const issues = [];
for (const entry of entries) {
  auditEntry(entry);
}

const summary = {
  generated_at: new Date().toISOString(),
  db_file: path.relative(process.cwd(), DB_FILE),
  audited_entries: entries.length,
  issue_counts: countBy(issues, 'code'),
  severity_counts: countBy(issues, 'severity')
};

const report = {
  summary,
  issues: issues.slice(0, 1000)
};

fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`[done] wrote ${path.relative(process.cwd(), REPORT_FILE)}`);

function auditEntry(entry) {
  const senses = selectAll(
    `
      SELECT sense_order, part_of_speech, gloss_key
      FROM dictionary_senses
      WHERE entry_id = ?
      ORDER BY sense_order
    `,
    [entry.id]
  );
  const definitions = selectAll(
    `
      SELECT sense_order, lang, definition
      FROM dictionary_definitions
      WHERE entry_id = ?
      ORDER BY sense_order, lang
    `,
    [entry.id]
  );
  const examples = selectAll(
    `
      SELECT sense_order, example_order, source_sentence, zh, en, pt_br AS "pt-BR", ja
      FROM dictionary_examples
      WHERE entry_id = ?
      ORDER BY sense_order, example_order
    `,
    [entry.id]
  );

  const glosses = new Map();
  const senseByOrder = new Map(senses.map((sense) => [Number(sense.sense_order), sense]));
  for (const sense of senses) {
    const gloss = normalizeMeaning(sense.gloss_key);
    if (gloss) {
      if (glosses.has(gloss)) {
        const firstOrder = glosses.get(gloss);
        const firstSense = senseByOrder.get(Number(firstOrder));
        const samePartOfSpeech =
          normalizeMeaning(firstSense?.part_of_speech) === normalizeMeaning(sense.part_of_speech);
        add(
          entry,
          samePartOfSpeech ? 'duplicate_gloss' : 'shared_gloss_key',
          `Shared gloss "${sense.gloss_key}" at senses ${firstOrder} and ${sense.sense_order}.`,
          samePartOfSpeech ? 'error' : 'warning'
        );
      }
      glosses.set(gloss, sense.sense_order);
    }
  }

  const duplicateDefinitionPairs = new Map();
  for (const lang of LANGS) {
    const seen = new Map();
    for (const row of definitions.filter((definition) => definition.lang === lang)) {
      const normalized = normalizeMeaning(row.definition);
      if (!normalized) continue;
      if (seen.has(normalized)) {
        const firstOrder = Number(seen.get(normalized));
        const secondOrder = Number(row.sense_order);
        const key = [firstOrder, secondOrder].sort((a, b) => a - b).join(':');
        const pair = duplicateDefinitionPairs.get(key) || {
          firstOrder,
          secondOrder,
          languages: [],
          definitions: []
        };
        pair.languages.push(lang);
        pair.definitions.push(`${lang}: ${row.definition}`);
        duplicateDefinitionPairs.set(key, pair);
      }
      seen.set(normalized, row.sense_order);
    }
  }
  for (const pair of duplicateDefinitionPairs.values()) {
    const firstSense = senseByOrder.get(Number(pair.firstOrder));
    const secondSense = senseByOrder.get(Number(pair.secondOrder));
    const samePartOfSpeech =
      normalizeMeaning(firstSense?.part_of_speech) === normalizeMeaning(secondSense?.part_of_speech);
    const severity = samePartOfSpeech || pair.languages.length > 1 ? 'error' : 'warning';
    add(
      entry,
      severity === 'error' ? 'duplicate_definition' : 'shared_definition',
      `Shared definition at senses ${pair.firstOrder} and ${pair.secondOrder}: ${pair.definitions.join('; ')}`,
      severity
    );
  }

  const headword = normalizeTerm(entry.headword);
  const normalizedHeadword = normalizeTerm(entry.normalized_headword);
  for (const example of examples) {
    const source = normalizeTerm(example.source_sentence);
    const containsHeadword =
      source.includes(headword) ||
      (normalizedHeadword && normalizedHeadword !== headword && source.includes(normalizedHeadword));
    if (!containsHeadword && isTokenLike(entry.headword)) {
      add(
        entry,
        'example_missing_headword',
        `Example ${example.example_order} for sense ${example.sense_order} does not contain the headword: ${example.source_sentence}`,
        'warning'
      );
    }
  }
}

function add(entry, code, message, severity = 'error') {
  issues.push({
    severity,
    code,
    id: entry.id,
    source_lang: entry.source_lang,
    headword: entry.headword,
    normalized_headword: entry.normalized_headword,
    message
  });
}

function selectAll(sql, params = []) {
  const statement = db.prepare(sql);
  statement.bind(params);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function normalizeTerm(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase();
}

function normalizeMeaning(value) {
  return normalizeTerm(value)
    .replace(/[.,;:!?，。；：！？、\s]+/gu, ' ')
    .trim();
}

function isTokenLike(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(text)) return text.length >= 2;
  return /^[\p{Script=Latin}'-]+$/u.test(text) && text.length >= 2;
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    acc[item[field]] = (acc[item[field]] || 0) + 1;
    return acc;
  }, {});
}
