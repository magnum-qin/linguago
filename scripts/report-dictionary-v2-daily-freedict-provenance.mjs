import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, token, i, all) => token.startsWith('--') ? [...out, [token.slice(2), all[i + 1]]] : out, []));
if (!args.report || !args.tei || !args.out) throw new Error('Require --report, --tei, --out');
const reportBytes = fs.readFileSync(args.report);
const teiBytes = fs.readFileSync(args.tei);
const report = JSON.parse(reportBytes.toString('utf8'));
const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false, trimValues: true }).parse(teiBytes.toString('utf8'));
const entries = new Map();
for (const entry of collect(parsed, 'entry')) {
  const word = text(collect(entry, 'orth')[0]);
  if (!word) continue;
  const quotes = collect(entry, 'cit').filter((cit) => ['trans', 'translation'].includes(cit['@_type'])).flatMap((cit) => collect(cit, 'quote').map(text));
  entries.set(word, [...(entries.get(word) || []), { translations: quotes }]);
}
const rows = (report.selected || []).filter((row) => row.source_lang === 'pt-BR').map((row) => {
  const sense = row.daily_sense_selection?.alternatives?.find((s) => Number(s.id) === Number(row.first_sense_id || row.source_sense_id));
  const rawEntries = entries.get(row.source_word || row.word) || [];
  return { source_entry_id: row.source_entry_id, source_sense_id: row.first_sense_id || row.source_sense_id, word: row.word, selected_source: sense?.source, selected_gloss: row.gloss_key, raw_entries: rawEntries, exact_raw_translation_match: rawEntries.some((entry) => entry.translations.includes(row.gloss_key)), semantic_approval: false };
});
const output = { scope: 'raw_source_provenance_not_semantic_validation', candidate_sha256: hash(reportBytes), raw_tei_sha256: hash(teiBytes), rows };
fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ inspected: rows.length, raw_translation_matches: rows.filter((row) => row.exact_raw_translation_match).length, out: args.out }));
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function text(value) { return typeof value === 'string' ? value : String(value?.['#text'] || ''); }
function collect(node, tag) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap((item) => collect(item, tag));
  return Object.entries(node).flatMap(([key, value]) => key.split(':').pop() === tag ? (Array.isArray(value) ? value : [value]) : collect(value, tag));
}
