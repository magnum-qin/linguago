export function normalizeJapaneseKanaReading(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s・.]+/gu, '')
    .replace(/[ァ-ヶ]/gu, (character) => String.fromCodePoint(character.codePointAt(0) - 0x60));
}

export function isValidJapaneseKanaReading(value) {
  const reading = normalizeJapaneseKanaReading(value);
  return Boolean(reading) && !reading.includes('\uFFFD') && /^[\p{Script=Hiragana}ー]+$/u.test(reading);
}

export function filterValidJapaneseKanaReadings(readings) {
  return new Set([...(readings || [])].filter(isValidJapaneseKanaReading));
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

// Accept phrases such as 街に出る only when every kanji-bearing lexical span
// has an exact dictionary reading and all intervening kana are preserved
// literally. This deliberately does not guess inflections or decompose
// all-kanji compounds character by character.
export function compositionalJapanesePhraseReadings(term, lookupExactReadings, options = {}) {
  const value = String(term || '').trim();
  if (
    !/[\p{Script=Han}]/u.test(value) ||
    !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)
  ) {
    return null;
  }

  const characters = [...value];
  const maxStates = Math.max(8, Number(options.maxStates || 64));
  const states = new Map([[0, [{ reading: '', dictionarySpans: 0 }]]]);

  for (let start = 0; start < characters.length; start++) {
    const current = states.get(start);
    if (!current?.length) continue;

    const character = characters[start];
    if (/^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u.test(character)) {
      appendPhraseStates(
        states,
        start + 1,
        current.map((state) => ({
          ...state,
          reading: `${state.reading}${normalizeJapaneseKanaReading(character)}`
        })),
        maxStates
      );
    }

    for (let end = characters.length; end > start; end--) {
      const segment = characters.slice(start, end).join('');
      if (!/[\p{Script=Han}]/u.test(segment)) continue;
      const readings = lookupExactReadings(segment);
      if (!readings?.size) continue;
      appendPhraseStates(
        states,
        end,
        current.flatMap((state) =>
          [...readings].map((reading) => ({
            reading: `${state.reading}${normalizeJapaneseKanaReading(reading)}`,
            dictionarySpans: state.dictionarySpans + 1
          }))
        ),
        maxStates
      );
    }
  }

  const complete = (states.get(characters.length) || [])
    .filter((state) => state.dictionarySpans > 0)
    .map((state) => state.reading)
    .filter(Boolean);
  return complete.length ? new Set(complete) : null;
}

function appendPhraseStates(states, position, additions, maxStates) {
  const current = states.get(position) || [];
  const unique = new Map(current.map((state) => [`${state.reading}|${state.dictionarySpans}`, state]));
  for (const state of additions) {
    unique.set(`${state.reading}|${state.dictionarySpans}`, state);
    if (unique.size >= maxStates) break;
  }
  states.set(position, [...unique.values()]);
}

const JAPANESE_DIGIT_READINGS = new Map([
  ['一', ['いち']],
  ['二', ['に']],
  ['三', ['さん']],
  ['四', ['よん', 'し']],
  ['五', ['ご']],
  ['六', ['ろく']],
  ['七', ['なな', 'しち']],
  ['八', ['はち']],
  ['九', ['きゅう', 'く']]
]);

const JAPANESE_TENS_READINGS = new Map([
  ['二', ['に']],
  ['三', ['さん']],
  ['四', ['よん']],
  ['五', ['ご']],
  ['六', ['ろく']],
  ['七', ['なな', 'しち']],
  ['八', ['はち']],
  ['九', ['きゅう']]
]);

// JMdict does not enumerate every productive numeral. Keep this deliberately
// narrow: only canonical kanji integers from 1 through 99 are accepted.
export function compositionalJapaneseNumberReadings(term) {
  const value = String(term || '').trim();
  const ordinal = value.startsWith('第');
  const number = ordinal ? value.slice(1) : value;
  const prefix = ordinal ? 'だい' : '';
  const single = JAPANESE_DIGIT_READINGS.get(number);
  if (single) return new Set(single.map((reading) => `${prefix}${reading}`));

  const match = number.match(/^([二三四五六七八九]?)十([一二三四五六七八九]?)$/u);
  if (!match) return null;
  const tens = match[1] ? JAPANESE_TENS_READINGS.get(match[1]) : [''];
  const ones = match[2] ? JAPANESE_DIGIT_READINGS.get(match[2]) : [''];
  if (!tens?.length || !ones?.length) return null;
  return new Set(
    tens.flatMap((tensReading) =>
      ones.map((onesReading) => `${prefix}${tensReading}じゅう${onesReading}`)
    )
  );
}
