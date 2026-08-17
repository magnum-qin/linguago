const LANGS = ['en', 'pt-BR', 'zh', 'ja'];

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
