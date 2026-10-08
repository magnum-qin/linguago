export function sourceReviewEvidence(row) {
  const lockedId = Number(row.first_sense_id ?? row.source_sense_id);
  const aligned = Array.isArray(row.sense_alignment?.candidates) ? row.sense_alignment.candidates : [];
  const alternatives = Array.isArray(row.daily_sense_selection?.alternatives) ? row.daily_sense_selection.alternatives : [];
  // Native candidates have no alignment stage. Bind their evidence by exact ID,
  // never by word or array position, which can select a different sense.
  const locked = alternatives.filter((item) => Number(item.id) === lockedId && !item.blocked_reason)
    .map((item) => ({ source: item.source, gloss: item.gloss, source_sense_id: lockedId, part_of_speech: item.part_of_speech || null }));
  const priority = (source) => /^(jmdict|freedict|cc-cedict|ecdict)/u.test(source) ? 0 : source.startsWith('wikdict-') ? 1 : source.startsWith('omw-') ? 2 : 3;
  const others = aligned.filter((item) => item?.source && item?.gloss_key)
    .sort((a, b) => priority(String(a.source).toLowerCase()) - priority(String(b.source).toLowerCase()))
    .map((item) => ({ source: item.source, gloss: item.gloss_key }));
  const seen = new Set();
  return [...locked, ...others].filter((item) => {
    if (!item.source || !item.gloss) return false;
    const key = JSON.stringify([item.source, item.gloss]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}
