export function compactRetryFeedback(row, gloss) {
  const errors = Array.isArray(row.latest_errors) ? [...new Set(row.latest_errors)] : [];
  if (!errors.length) return [];
  const lines = [`Previous output failed validation: ${errors.join(', ')}. Correct these errors; do not repeat the same output.`];
  if (errors.includes('en_term_gloss_mismatch')) {
    lines.push(`Preserve the exact sense and grammatical role of ${JSON.stringify(gloss)}. Where this is already a natural English dictionary term, retain it instead of replacing it with a synonym. Explain that same sense in en.definition. Do not add an anchor word to an unrelated definition merely to pass a check.`);
  }
  if (errors.includes('ja_term_not_in_jmdict')) {
    lines.push(`The previous Japanese term ${JSON.stringify(row.latest_ja_term || '')} was not found in the Japanese lexical index. Use an established Japanese equivalent of the same sense, not Chinese characters copied into Japanese. If unsure, do not invent a word.`);
  }
  for (const lang of ['zh', 'ja']) {
    const readings = row[`latest_${lang}_expected_readings`];
    const term = row[`latest_${lang}_term`];
    if (term && Array.isArray(readings) && readings.length) {
      lines.push(`For ${lang} term ${JSON.stringify(term)}, attested readings are ${JSON.stringify(readings)}. Choose the reading appropriate to the locked sense; these readings do not apply to a different term.`);
    }
  }
  if (errors.some((error) => /(?:reading|pronunciation)/u.test(error))) {
    lines.push('Readings must match their own terms: Chinese pinyin, Japanese kana, and English/Portuguese IPA. Remove replacement characters and corrupt encoding; do not guess an unrelated reading.');
  }
  if (errors.some((error) => /example/u.test(error))) {
    lines.push('Provide the required example object with one Simplified Chinese source sentence and all four translations of that same sentence. Each must naturally demonstrate the localized term in the locked sense.');
  }
  return lines;
}
