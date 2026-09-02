/**
 * Word Morphology & Highlighting Extraction Utilities
 */

export const ENGLISH_HIGHLIGHT_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with'
]);

export const IRREGULAR_ENGLISH_HIGHLIGHT_FORMS: Record<string, string[]> = {
  be: ['am', 'is', 'are', 'was', 'were', 'been', 'being'],
  become: ['became', 'becomes', 'becoming'],
  begin: ['began', 'begun', 'begins', 'beginning'],
  break: ['broke', 'broken', 'breaks', 'breaking'],
  bring: ['brought', 'brings', 'bringing'],
  buy: ['bought', 'buys', 'buying'],
  choose: ['chose', 'chosen', 'chooses', 'choosing'],
  come: ['came', 'comes', 'coming'],
  do: ['did', 'done', 'does', 'doing'],
  drink: ['drank', 'drunk', 'drinks', 'drinking'],
  eat: ['ate', 'eaten', 'eats', 'eating'],
  fall: ['fell', 'fallen', 'falls', 'falling'],
  feel: ['felt', 'feels', 'feeling'],
  find: ['found', 'finds', 'finding'],
  get: ['got', 'gotten', 'gets', 'getting'],
  give: ['gave', 'given', 'gives', 'giving'],
  go: ['went', 'gone', 'goes', 'going'],
  have: ['had', 'has', 'having'],
  keep: ['kept', 'keeps', 'keeping'],
  know: ['knew', 'known', 'knows', 'knowing'],
  leave: ['left', 'leaves', 'leaving'],
  make: ['made', 'makes', 'making'],
  meet: ['met', 'meets', 'meeting'],
  run: ['ran', 'runs', 'running'],
  say: ['said', 'says', 'saying'],
  see: ['saw', 'seen', 'sees', 'seeing'],
  sell: ['sold', 'sells', 'selling'],
  send: ['sent', 'sends', 'sending'],
  take: ['took', 'taken', 'takes', 'taking'],
  tell: ['told', 'tells', 'telling'],
  think: ['thought', 'thinks', 'thinking'],
  win: ['won', 'wins', 'winning'],
  write: ['wrote', 'written', 'writes', 'writing']
};

export function stripInlineAnnotations(value: string): string {
  return String(value || '').replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1');
}

export function normalizeComparableText(value: unknown): string {
  return String(value || '')
    .replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1')
    .replace(/\s+/g, '')
    .trim();
}

export function isEnglishWord(value: string): boolean {
  return /^[A-Za-z][A-Za-z'’-]*$/u.test(value);
}

export function regularEnglishForms(term: string): string[] {
  const lower = term.toLocaleLowerCase();
  if (!isEnglishWord(term) || lower.length < 3 || ENGLISH_HIGHLIGHT_STOPWORDS.has(lower)) return [];
  const forms = new Set<string>();

  forms.add(`${lower}s`);
  if (lower.endsWith('e')) {
    forms.add(`${lower}d`);
    forms.add(`${lower.slice(0, -1)}ing`);
  } else if (/^[a-z]+[^aeiou][aeiou][^aeiouwxy]$/u.test(lower)) {
    const last = lower.at(-1) || '';
    forms.add(`${lower}${last}ed`);
    forms.add(`${lower}${last}ing`);
  } else {
    forms.add(`${lower}ed`);
    forms.add(`${lower}ing`);
  }

  if (lower.endsWith('y') && !/[aeiou]y$/u.test(lower)) {
    forms.add(`${lower.slice(0, -1)}ies`);
    forms.add(`${lower.slice(0, -1)}ied`);
  }

  return [...forms];
}

export function expandedHighlightForms(term: string): string[] {
  const lower = term.toLocaleLowerCase();
  return [...(IRREGULAR_ENGLISH_HIGHLIGHT_FORMS[lower] || []), ...regularEnglishForms(term)];
}

export function splitHighlightTerms(...values: Array<unknown>): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerm = (term: string) => {
    if (!term) return;
    if (/^[\p{Script=Latin}\p{N}_'’-]$/u.test(term)) return;
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  const addTermWithForms = (term: string) => {
    addTerm(term);
    for (const form of expandedHighlightForms(term)) {
      addTerm(form);
    }
  };

  for (const value of values) {
    const cleaned = stripInlineAnnotations(String(value || ''));
    for (const rawTerm of cleaned.split(/\s*(?:[;；,，、/]|(?:\bor\b)|(?:\band\b))\s*/giu)) {
      const term = rawTerm.trim();
      if (!term) continue;
      addTermWithForms(term);
      for (const word of term.split(/\s+/u)) {
        const cleanWord = word.trim();
        if (!isEnglishWord(cleanWord)) continue;
        if (ENGLISH_HIGHLIGHT_STOPWORDS.has(cleanWord.toLocaleLowerCase())) continue;
        addTermWithForms(cleanWord);
      }
    }
  }

  return terms;
}
