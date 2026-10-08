const LANGS = ['en', 'pt-BR', 'zh', 'ja'];
const DECISIONS = new Set(['accept', 'reject', 'manual_review']);

export function sourceReviewSystemPrompt(requireDailyPrimary = false) {
  const role = 'You are a conservative multilingual lexicographer screening noisy open-dictionary evidence. ';
  return role + (requireDailyPrimary
    ? 'Judge both exact source-language meaning and modern everyday sense priority. A real dictionary sense alone is insufficient. Reject proper names, brands, named works and narrowly specialized senses from this daily batch. Do not mistake synonymous wording, established loanwords or shared Chinese/Japanese characters for a semantic mismatch. Use manual_review when priority is uncertain; do not invent usage frequency. Return JSON only.'
    : 'Judge only whether the proposed sense is real for the source-language headword. Return JSON only.');
}

export function validateSourceReviewEnvelope(review) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) return ['not_object'];

  const errors = [];
  if (!DECISIONS.has(review.decision)) errors.push('invalid_decision');
  if (typeof review.confidence !== 'number' || review.confidence < 0 || review.confidence > 1) {
    errors.push('invalid_confidence');
  }

  // Rejected and manual rows are terminal review outcomes, not malformed model
  // responses. They may intentionally omit terms and an English anchor.
  if (review.decision === 'accept') {
    if (typeof review.english_anchor !== 'string' || !/[a-z]/iu.test(review.english_anchor)) {
      errors.push('invalid_english_anchor');
    }
    if (!review.preferred_terms || typeof review.preferred_terms !== 'object' || Array.isArray(review.preferred_terms)) {
      errors.push('invalid_preferred_terms');
    } else {
      for (const lang of LANGS) {
        const value = review.preferred_terms[lang];
        if (value !== null && (typeof value !== 'string' || !value.trim())) {
          errors.push(`invalid_preferred_term_${lang}`);
        }
      }
    }
  } else {
    if (review.english_anchor !== null && review.english_anchor !== undefined && typeof review.english_anchor !== 'string') {
      errors.push('invalid_english_anchor');
    }
    if (
      review.preferred_terms !== null &&
      review.preferred_terms !== undefined &&
      (typeof review.preferred_terms !== 'object' || Array.isArray(review.preferred_terms))
    ) {
      errors.push('invalid_preferred_terms');
    }
  }

  if (typeof review.reason !== 'string' || !review.reason.trim()) errors.push('missing_reason');
  if (!Array.isArray(review.evidence) || !review.evidence.length) errors.push('missing_evidence');
  if (
    review.risk_flags !== null &&
    review.risk_flags !== undefined &&
    !Array.isArray(review.risk_flags)
  ) {
    errors.push('invalid_risk_flags');
  }
  return errors;
}

export function validateDefinitionContract(definitionContract, preferredTerms) {
  const errors = [];
  if (!definitionContract || typeof definitionContract !== 'object' || Array.isArray(definitionContract)) {
    return ['invalid_definition_contract'];
  }

  for (const lang of LANGS) {
    const value = definitionContract[lang];
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(`invalid_definition_contract_${lang}`);
      continue;
    }
    if (!definitionContractLanguageLooksRight(value, lang)) {
      errors.push(`definition_contract_language_${lang}`);
    }
    if (definitionContractTooThin(value, lang, preferredTerms?.[lang])) {
      errors.push(`thin_definition_contract_${lang}`);
    }
  }
  return errors;
}

export function definitionContractLanguageLooksRight(value, lang) {
  const text = String(value || '').trim();
  if (lang === 'zh') return /[\u3400-\u9fff]/u.test(text);
  if (lang === 'ja') return /[\u3040-\u30ff]/u.test(text);
  if (lang === 'en') return /[\p{Script=Latin}]/u.test(text) && !hasStrongOppositeLatinLanguage(text, 'en');
  if (lang === 'pt-BR') return /[\p{Script=Latin}]/u.test(text) && !hasStrongOppositeLatinLanguage(text, 'pt-BR');
  return false;
}

export function hasStrongOppositeLatinLanguage(value, expectedLang) {
  const tokens = String(value || '')
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/\p{M}/gu, '')
    .match(/\p{L}+/gu) || [];
  if (tokens.length < 4) return false;
  const counts = { en: 0, 'pt-BR': 0 };
  const english = new Set(['a', 'an', 'and', 'as', 'by', 'especially', 'for', 'from', 'in', 'is', 'of', 'or', 'relating', 'that', 'the', 'to', 'used', 'which', 'with']);
  const portuguese = new Set(['a', 'ao', 'aos', 'as', 'com', 'como', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'especialmente', 'esta', 'este', 'ou', 'para', 'por', 'que', 'relacionado', 'uma', 'um']);
  for (const token of tokens) {
    if (english.has(token)) counts.en++;
    if (portuguese.has(token)) counts['pt-BR']++;
  }
  if (expectedLang === 'pt-BR') return counts.en >= 3 && counts.en >= counts['pt-BR'] + 2;
  if (expectedLang === 'en') return counts['pt-BR'] >= 3 && counts['pt-BR'] >= counts.en + 2;
  return false;
}

export function definitionContractTooThin(value, lang, term) {
  const text = String(value || '').normalize('NFKC').trim();
  const termText = String(term || '').normalize('NFKC').trim();
  if (!text || text.toLocaleLowerCase() === termText.toLocaleLowerCase()) return true;
  return lang === 'en' || lang === 'pt-BR' ? text.length < 12 : text.length < 4;
}
