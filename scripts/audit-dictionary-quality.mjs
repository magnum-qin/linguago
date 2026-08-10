import fs from 'node:fs';
import path from 'node:path';

const inputFile = path.resolve(process.argv[2] || 'data/processed/deepseek-v4-pro-200-revalidated.accepted.jsonl');
const reportFile = path.resolve(process.argv[3] || 'data/processed/dictionary-quality-report.json');
const LANGS = ['zh', 'en', 'pt-BR', 'ja'];

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}

const rows = fs
  .readFileSync(inputFile, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line, index) => ({ line: index + 1, data: JSON.parse(line) }));

const issues = [];
const summary = {
  input_file: path.relative(process.cwd(), inputFile),
  generated_at: new Date().toISOString(),
  total_rows: rows.length,
  by_type: {},
  issue_counts: {},
  warning_counts: {},
  score: 100
};

for (const row of rows) {
  const entry = row.data.entry || row.data;
  summary.by_type[entry.type || 'missing'] = (summary.by_type[entry.type || 'missing'] || 0) + 1;
  auditEntry(row.line, row.data.term || entry.source_text || '', entry);
}

for (const issue of issues) {
  const bucket = issue.severity === 'warning' ? summary.warning_counts : summary.issue_counts;
  bucket[issue.code] = (bucket[issue.code] || 0) + 1;
}

summary.score = Math.max(0, 100 - Object.values(summary.issue_counts).reduce((sum, count) => sum + count, 0));

const report = {
  summary,
  issues: issues.slice(0, 500)
};

fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[done] audited rows=${summary.total_rows}`);
console.log(`[done] issue types=${Object.keys(summary.issue_counts).length}`);
console.log(`[done] score=${summary.score}`);
console.log(`[done] wrote ${path.relative(process.cwd(), reportFile)}`);

function auditEntry(line, term, entry) {
  if (!entry || typeof entry !== 'object') {
    add(line, term, 'entry_missing', 'Entry is missing or not an object.');
    return;
  }

  if (!['word', 'sentence'].includes(entry.type))
    add(line, term, 'type_invalid', 'Entry type must be word or sentence.');

  for (const lang of LANGS) {
    if (!isText(entry.translations?.[lang]?.text))
      add(line, term, 'translation_missing', `Missing translation text for ${lang}.`);
    if (!isText(entry.translations?.[lang]?.audio_text))
      add(line, term, 'audio_text_missing', `Missing audio_text for ${lang}.`);
  }

  if (entry.type === 'word') auditWord(line, term, entry);
  if (entry.type === 'sentence') auditSentence(line, term, entry);
}

function auditWord(line, term, entry) {
  for (const lang of LANGS) {
    if (!isText(entry.word_details?.[lang]?.word))
      add(line, term, 'word_detail_word_missing', `Missing word_details.${lang}.word.`);
    if (!isText(entry.word_details?.[lang]?.definition)) {
      add(line, term, 'word_detail_definition_missing', `Missing word_details.${lang}.definition.`);
    }
  }

  const senses = Array.isArray(entry.senses) ? entry.senses : [];
  if (!senses.length) {
    add(line, term, 'senses_missing', 'Word entry has no senses array.', 'warning');
  } else {
    const senseOrders = new Set();
    for (const [index, sense] of senses.entries()) {
      const order = Number(sense.sense_order || index + 1);
      if (senseOrders.has(order)) add(line, term, 'sense_order_duplicate', `Duplicate sense_order ${order}.`);
      senseOrders.add(order);
      if (!isText(sense.gloss_key)) add(line, term, 'sense_gloss_missing', `Missing gloss_key for sense ${order}.`);
      for (const lang of LANGS) {
        if (!isText(sense.definitions?.[lang]))
          add(line, term, 'sense_definition_missing', `Missing ${lang} definition for sense ${order}.`);
      }
    }
  }

  const examples = Array.isArray(entry.examples) ? entry.examples : [];
  if (!examples.length) {
    add(line, term, 'example_missing', 'Word entry has no examples.');
    return;
  }

  const validSenseOrders = new Set(senses.map((sense, index) => Number(sense.sense_order || index + 1)));
  for (const [index, example] of examples.entries()) {
    if (!isText(example.sentence))
      add(line, term, 'example_sentence_missing', `Missing example sentence ${index + 1}.`);
    if (example.sense_order && validSenseOrders.size && !validSenseOrders.has(Number(example.sense_order))) {
      add(
        line,
        term,
        'example_sense_unknown',
        `Example ${index + 1} points to unknown sense_order ${example.sense_order}.`
      );
    }
    for (const lang of LANGS) {
      if (!isText(example.translations?.[lang]))
        add(line, term, 'example_translation_missing', `Missing ${lang} example translation ${index + 1}.`);
    }
  }
}

function auditSentence(line, term, entry) {
  for (const lang of LANGS) {
    if (!isText(entry.explanations?.[lang]))
      add(line, term, 'sentence_explanation_missing', `Missing ${lang} sentence explanation.`);
  }
}

function add(line, term, code, message, severity = 'error') {
  issues.push({ line, term, severity, code, message });
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
