export function normalizeJapaneseKanaReading(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s・.]+/gu, '')
    .replace(/[ァ-ヶ]/gu, (character) => String.fromCodePoint(character.codePointAt(0) - 0x60));
}

export function selectCanonicalJapaneseReading(currentReading, expectedReadings) {
  const readings = [...(expectedReadings || [])].filter(Boolean);
  if (!readings.length) return null;
  const normalizedCurrent = normalizeJapaneseKanaReading(currentReading);
  const matching = readings.find(
    (reading) => normalizeJapaneseKanaReading(reading) === normalizedCurrent
  );
  return matching || readings[0];
}

export function transparentJapaneseCompoundReadings(term, lookupExactReadings) {
  const value = String(term || '').trim();
  const match = value.match(/^(\p{Script=Han}+)([\p{Script=Hiragana}\p{Script=Katakana}ー]+)$/u);
  if (!match) return null;

  const [, prefix, suffix] = match;
  const prefixReadings = lookupExactReadings(prefix);
  if (!prefixReadings?.size) return null;

  const normalizedSuffix = normalizeJapaneseKanaReading(suffix);
  if (!normalizedSuffix) return null;
  return new Set(
    [...prefixReadings].map(
      (reading) => `${normalizeJapaneseKanaReading(reading)}${normalizedSuffix}`
    )
  );
}
