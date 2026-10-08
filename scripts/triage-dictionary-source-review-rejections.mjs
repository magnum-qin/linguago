import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function triageRejections(pool, reviews) {
  const candidates = new Map();
  for (const row of pool.selected || []) {
    const key = `${row.source_entry_id}:${row.first_sense_id ?? row.source_sense_id}`;
    if (candidates.has(key)) throw new Error(`Duplicate candidate ${key}`);
    candidates.set(key, row);
  }
  const rows = [], seen = new Set();
  for (const review of reviews.reviews || []) {
    const key = `${review.source_entry_id}:${review.source_sense_id}`;
    if (seen.has(key)) throw new Error(`Duplicate review ${key}`);
    seen.add(key);
    const source = candidates.get(key);
    if (!source || source.word !== review.word || source.gloss_key !== review.gloss_key) throw new Error(`Unbound review ${key}`);
    if (review.approved === true && review.valid === true && review.decision === 'accept') continue;
    const alternatives = (source.daily_sense_selection?.alternatives || []).filter((item) =>
      Number(item.id) !== Number(review.source_sense_id) && Number.isInteger(Number(item.id)) && Number(item.id) > 0 &&
      item.source && item.gloss && !item.blocked_reason && !item.linked_product_sense
    ).map(({ id, source, gloss, part_of_speech }) => ({ id, source, gloss, part_of_speech }));
    rows.push({ key, word: source.word, source_lang: source.source_lang, locked_gloss: source.gloss_key,
      decision: review.decision, reason: review.reason, model_suggested_anchor: review.english_anchor,
      disposition: alternatives.length ? 'alternate_sense_review_required' : 'source_reviewer_disagreement_manual',
      alternatives, automatic_selection: false });
  }
  return { automatic_publication: false, automatic_selection: false, reviewed: seen.size, nonaccepted: rows.length,
    alternate_review: rows.filter((r) => r.alternatives.length).length,
    no_alternate: rows.filter((r) => !r.alternatives.length).length, rows };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [pool, reviews, out] = process.argv.slice(2);
  if (!pool || !reviews || !out) throw new Error('Usage: triage-dictionary-source-review-rejections.mjs pool.json reviews.json out.json');
  const result = triageRejections(JSON.parse(fs.readFileSync(pool, 'utf8')), JSON.parse(fs.readFileSync(reviews, 'utf8')));
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  const { rows, ...summary } = result;
  console.log(JSON.stringify(summary));
}
