export function japaneseReverseLookupVariants(value) {
  const term = String(value || '').normalize('NFKC').trim();
  const variants = new Set([term]);
  if (term.endsWith('する') && term.length > 2) variants.add(term.slice(0, -2));
  if (term.endsWith('な') && term.length > 1) variants.add(term.slice(0, -1));
  if (term.endsWith('の') && term.length > 1) variants.add(term.slice(0, -1));

  // Keep the surface form and query likely JMdict lemma spellings.
  for (const suffix of ['した', 'して']) {
    if (!term.endsWith(suffix) || term.length <= suffix.length) continue;
    const stem = term.slice(0, -suffix.length);
    variants.add(stem);
    variants.add(`${stem}する`);
  }

  return [...variants];
}
