import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const [inputPath, sourcePath, productPath, outPath] = process.argv.slice(2);
if (![inputPath, sourcePath, productPath, outPath].every(Boolean)) {
  throw new Error('Usage: recovered.json source.db product.db NEW-report.json');
}
if (fs.existsSync(outPath)) throw new Error('Output exists');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const product = new Database(productPath, { readonly: true, fileMustExist: true });
source.pragma('query_only=ON');
product.pragma('query_only=ON');
const entries = source.prepare('SELECT id,word,frequency_rank FROM entries WHERE normalized_key=? AND source_lang=?');
const senses = source.prepare('SELECT id,gloss_key,source,needs_review FROM senses WHERE entry_id=?');
const loc = source.prepare('SELECT lang,reading,reading_system,needs_review FROM sense_localizations WHERE sense_id=?');
const links = product.prepare(`SELECT ps.id,ps.product_entry_id,ps.status
  FROM product_sense_source_links l JOIN product_senses ps ON ps.id=l.product_sense_id
  WHERE l.source_sense_id=?`);
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const cache = new Map(), rows = [], summary = { records: 0 };
try {
  source.exec('BEGIN');
  product.exec('BEGIN');
  for (const row of input.records) {
    const word = norm(row.simplified);
    if (!cache.has(word)) cache.set(word, entries.all(word, 'zh').map(e => ({ ...e, senses: senses.all(e.id) })));
    const found = cache.get(word);
    const all = found.flatMap(e => e.senses.map(s => ({ ...s, entry_id: e.id })));
    const exact = all.filter(s => norm(s.gloss_key) === norm(row.gloss));
    const cedict = exact.filter(s => s.source === 'cc-cedict');
    const matching = cedict.map(s => ({ ...s,
      readings: loc.all(s.id).filter(x => x.lang === 'zh'), links: links.all(s.id)
    }));
    const classification = !found.length ? 'no_source_entry'
      : !cedict.length ? (exact.length ? 'same_gloss_other_source_only' : 'no_exact_source_gloss')
      : matching.some(s => s.readings.some(r => norm(r.reading) === norm(row.reading)))
        ? 'cedict_exact_gloss_and_reading' : 'cedict_exact_gloss_reading_unverified';
    summary.records++;
    summary[classification] = (summary[classification] || 0) + 1;
    rows.push({ ...row, classification,
      source_entries: found.map(({ senses, ...e }) => e), exact_source_matches: matching,
      other_source_matches: exact.filter(s => s.source !== 'cc-cedict').map(s => ({ ...s, links: links.all(s.id) })),
      entry_existing_accepted_links: [...new Set(all.flatMap(s => links.all(s.id)).filter(s => s.status === 'accepted').map(s => s.id))]
    });
    if (rows.length % 500 === 0) console.log(JSON.stringify({ checked: rows.length, total: input.records.length }));
  }
  source.exec('COMMIT');
  product.exec('COMMIT');
} finally {
  source.close();
  product.close();
}
summary.records_with_entry_accepted_links = rows.filter(r => r.entry_existing_accepted_links.length).length;
summary.distinct_simplified_forms = cache.size;
const report = {
  scope: 'current_snapshot_recovery_exact_match_against_remote_not_semantic_coverage_or_historical_loss',
  raw_sha256: input.raw_sha256, generated_at: new Date().toISOString(),
  reading_comparison: 'exact_normalized_text_only_not_pinyin_equivalence',
  accepted_link_counts_are_not_published_sense_counts: true,
  automatic_publication: false, summary, rows
};
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ outPath, summary }, null, 2));
