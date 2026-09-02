const PORTUGUESE_WORDS = new Set([
  'agora',
  'ainda',
  'amor',
  'aqui',
  'água',
  'bem',
  'boa',
  'bom',
  'casa',
  'cidade',
  'com',
  'como',
  'comida',
  'da',
  'das',
  'de',
  'dia',
  'do',
  'dos',
  'ela',
  'elas',
  'ele',
  'eles',
  'em',
  'escola',
  'está',
  'estão',
  'estou',
  'eu',
  'foi',
  'gosto',
  'hoje',
  'isso',
  'já',
  'mais',
  'mas',
  'meu',
  'minha',
  'muito',
  'na',
  'não',
  'nas',
  'no',
  'nós',
  'nos',
  'obrigada',
  'obrigado',
  'olá',
  'onde',
  'ou',
  'para',
  'palavra',
  'pessoa',
  'por',
  'porque',
  'quando',
  'que',
  'são',
  'seu',
  'sua',
  'também',
  'tem',
  'tempo',
  'trabalho',
  'uma',
  'você',
  'vocês',
  'vou'
]);

const ENGLISH_WORDS = new Set([
  'about',
  'after',
  'again',
  'all',
  'am',
  'and',
  'are',
  'because',
  'before',
  'but',
  'can',
  'city',
  'day',
  'did',
  'do',
  'does',
  'english',
  'for',
  'from',
  'good',
  'had',
  'has',
  'have',
  'he',
  'hello',
  'here',
  'how',
  'i',
  'in',
  'is',
  'it',
  'like',
  'more',
  'my',
  'not',
  'now',
  'of',
  'on',
  'or',
  'people',
  'school',
  'she',
  'that',
  'the',
  'their',
  'there',
  'these',
  'they',
  'this',
  'time',
  'to',
  'today',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'work',
  'would',
  'you',
  'your'
]);

const PORTUGUESE_SUFFIX = /(?:ções?|mente|dades?|ando|endo|indo|ados?|adas?|idos?|idas?|eiros?|eiras?|osos?|osas?)$/u;
const ENGLISH_SUFFIX = /(?:ing|ed|tion|tions|ness|less|ous|ment|ments)$/u;

export type DetectedSourceLanguage = 'zh' | 'ja' | 'en' | 'pt-BR' | 'hidden';

/**
 * Lightweight UI-language inference. The server remains authoritative after a
 * request; this detector exists so users can see and override the source
 * language before searching.
 */
export function detectSourceLanguage(text: string): DetectedSourceLanguage {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'hidden';
  if (/[぀-ヿ]/u.test(trimmed)) return 'ja';

  const comparable = trimmed.replace(/[\s\p{P}\p{S}]/gu, '');
  if (!comparable) return 'hidden';
  if (/^\p{Script=Han}+$/u.test(comparable)) return 'zh';

  const tokens = trimmed.toLocaleLowerCase('pt-BR').match(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu) || [];
  if (!tokens.length) return 'hidden';

  let portugueseScore = /[áàâãéêíóôõúç]/u.test(trimmed.toLocaleLowerCase('pt-BR')) ? 4 : 0;
  let englishScore = 0;

  for (const token of tokens) {
    if (PORTUGUESE_WORDS.has(token)) portugueseScore += 2;
    if (ENGLISH_WORDS.has(token)) englishScore += 2;
    if (token.length >= 5 && PORTUGUESE_SUFFIX.test(token)) portugueseScore += 1;
    if (token.length >= 5 && ENGLISH_SUFFIX.test(token)) englishScore += 1;
  }

  return portugueseScore > englishScore ? 'pt-BR' : 'en';
}
