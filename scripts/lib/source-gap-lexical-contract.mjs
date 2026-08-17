const NAME_CONNECTORS = new Set([
  'and', 'of', 'the', 'de', 'da', 'do', 'dos', 'das', 'e'
]);

export function bidirectionalTokenCoverage(anchorTokens, sourceTokens) {
  if (!anchorTokens.size || !sourceTokens.size) {
    return { overlap: 0, anchor_coverage: 0, source_coverage: 0 };
  }
  let overlap = 0;
  for (const token of anchorTokens) {
    if (sourceTokens.has(token)) overlap += 1;
  }
  return {
    overlap,
    anchor_coverage: overlap / anchorTokens.size,
    source_coverage: overlap / sourceTokens.size
  };
}

export function looksProperOrNamedEnglishAnchor(value) {
  const tokens = String(value || '').trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return false;

  let namedTokens = 0;
  for (const token of tokens) {
    const normalized = token.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/gu, '');
    if (!normalized) return false;
    if (NAME_CONNECTORS.has(normalized.toLowerCase())) continue;
    if (!/^[A-Z][A-Za-z'-]*$/u.test(normalized)) return false;
    namedTokens += 1;
  }
  return namedTokens >= 1;
}

export function canonicalEnglishSpellingVariant(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/litres?\b/gu, (match) => match.endsWith('s') ? 'liters' : 'liter')
    .replace(/metres?\b/gu, (match) => match.endsWith('s') ? 'meters' : 'meter');
}
