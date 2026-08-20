export function candidateEnglishTerms(row) {
  const sourceWord = normalizeEnglishTerm(row?.word);
  const values = [];
  for (const localization of row?.first_sense_localizations || []) {
    if (localization?.lang === 'en') values.push(localization.term, localization.definition);
  }
  const hint = row?.generation_hints?.en;
  if (Array.isArray(hint?.terms)) values.push(...hint.terms);
  return uniqueEnglishTerms(values)
    .filter((term) => term !== sourceWord)
    .filter((term) => term.length >= 2);
}

export function normalizeBlindSenses(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((sense) => {
      if (!sense || typeof sense !== 'object') return null;
      const anchor = String(sense.anchor || '').trim();
      const aliases = uniqueEnglishTerms([anchor, ...(Array.isArray(sense.aliases) ? sense.aliases : [])]);
      if (!anchor || !aliases.length) return null;
      return {
        anchor,
        part_of_speech: String(sense.part_of_speech || '').trim() || null,
        aliases,
        commonness: normalizeCommonness(sense.commonness)
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

export function matchBlindSourceAnchor(row, senses) {
  const candidateTerms = candidateEnglishTerms(row);
  if (!candidateTerms.length) {
    return { matched: false, reason: 'missing_candidate_english_locator', candidate_terms: [] };
  }
  let best = null;
  for (const sense of senses) {
    for (const candidate of candidateTerms) {
      for (const alias of sense.aliases || []) {
        const score = lexicalMatchScore(candidate, alias);
        if (!best || score > best.score) best = { score, candidate, alias, sense };
      }
    }
  }
  if (!best || best.score < 0.9) {
    return {
      matched: false,
      reason: 'no_exact_blind_anchor_match',
      candidate_terms: candidateTerms,
      best_score: best?.score ?? 0
    };
  }
  return {
    matched: true,
    reason: 'exact_blind_anchor_match',
    candidate_terms: candidateTerms,
    matched_candidate: best.candidate,
    matched_alias: best.alias,
    score: best.score,
    sense: best.sense
  };
}

export function normalizeEnglishTerm(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/\([^)]*\)/gu, ' ')
    .replace(/[^a-z0-9' -]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function uniqueEnglishTerms(values) {
  const seen = new Set();
  const terms = [];
  for (const value of values) {
    for (const part of String(value || '').split(/[;,/|]/u)) {
      const normalized = normalizeEnglishTerm(part);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      terms.push(normalized);
    }
  }
  return terms;
}

function lexicalMatchScore(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = new Set(left.split(/\s+/u).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/u).filter(Boolean));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (!intersection) return 0;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function normalizeCommonness(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['common', 'secondary', 'regional', 'technical'].includes(normalized)
    ? normalized
    : 'secondary';
}
