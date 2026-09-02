<script setup lang="ts">
import { computed } from 'vue';
import { Volume2, Copy, Check } from 'lucide-vue-next';
import FuriganaText from './FuriganaText.vue';
import { speak } from '../utils/speech';
import { useCopy } from '../composables/useCopy';

const props = defineProps<{
  resultData: any;
  activeLang: string;
  langs?: Array<{ code: string; label: string }>;
}>();

const { copy, isCopied } = useCopy();

const sourceLanguageCode = computed(() => {
  return props.resultData?.detected_source_lang || props.resultData?.source_lang || 'en';
});

const currentWord = computed(() => {
  if (currentWordDetail.value?.word) return currentWordDetail.value.word;
  if (typeof props.resultData === 'string') return props.resultData;
  if (props.resultData?.translations?.[props.activeLang]?.text)
    return props.resultData.translations[props.activeLang].text;
  return '';
});

const currentWordDetail = computed(() => {
  if (!props.resultData || !props.resultData.word_details) return null;
  return props.resultData.word_details[props.activeLang] || null;
});

const currentSenses = computed(() => {
  if (!props.resultData) return [];
  const groupedSenses = Array.isArray(props.resultData.pronunciation_groups)
    ? props.resultData.pronunciation_groups.flatMap((group: any) => (Array.isArray(group.senses) ? group.senses : []))
    : [];
  const source = groupedSenses.length > 0 ? groupedSenses : props.resultData.senses || [];
  return source.filter((s: any) => senseDefinition(s, props.activeLang));
});

const currentSenseGroups = computed(() => {
  const groups: Array<{ key: string; label: string; system: string; senses: any[] }> = [];
  const index = new Map<string, { key: string; label: string; system: string; senses: any[] }>();
  const sourceLang = props.resultData?.detected_source_lang || props.resultData?.source_lang || '';

  if (props.resultData && Array.isArray(props.resultData.pronunciation_groups)) {
    let groupedSenseCount = 0;
    for (const group of props.resultData.pronunciation_groups) {
      const senses = Array.isArray(group.senses)
        ? group.senses.filter((sense: any) => senseDefinition(sense, props.activeLang))
        : [];
      if (senses.length === 0) continue;
      if (group.lang !== sourceLang || !group.reading) continue;
      groupedSenseCount += senses.length;
      groups.push({
        key: group.reading_key || group.reading || `group-${groups.length + 1}`,
        label: group.reading || '',
        system: group.reading_system || '',
        senses
      });
    }
    if (groups.length > 0 && groupedSenseCount === currentSenses.value.length) return groups;
    groups.length = 0;
  }

  for (const sense of currentSenses.value) {
    const reading = senseReading(sense, props.activeLang);
    const key = reading.key || '__ungrouped';
    let group = index.get(key);
    if (!group) {
      group = { key, label: reading.label, system: reading.system, senses: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.senses.push(sense);
  }

  return groups;
});

const hasDictionarySenses = computed(() => {
  return props.resultData?.provider === 'dictionary' && currentSenses.value.length > 0;
});

const showSenseGroups = computed(() => {
  return currentSenseGroups.value.some((group) => group.label) && currentSenseGroups.value.length > 1;
});

const currentExamples = computed(() => {
  if (!props.resultData || !props.resultData.examples) return [];
  return props.resultData.examples.filter((e: any) => exampleTranslation(e, props.activeLang));
});

const senseDefinition = (sense: any, lang: string) => {
  return sense?.localizations?.[lang]?.definition || sense?.definitions?.[lang] || '';
};

const senseTerm = (sense: any, lang: string) => {
  return sense?.localizations?.[lang]?.term || '';
};

const shouldShowSenseTerm = (sense: any) => {
  const term = senseTerm(sense, props.activeLang);
  if (!term) return false;
  const current = currentWord.value;
  if (!current) return true;
  const normTerm = stripInlineAnnotations(term).trim().toLowerCase();
  const normCurrent = stripInlineAnnotations(current).trim().toLowerCase();
  return normTerm !== normCurrent;
};

const stripInlineAnnotations = (value: string) => {
  return String(value || '').replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1');
};

const ENGLISH_HIGHLIGHT_STOPWORDS = new Set([
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

const IRREGULAR_ENGLISH_HIGHLIGHT_FORMS: Record<string, string[]> = {
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

const isEnglishWord = (value: string) => /^[A-Za-z][A-Za-z'’-]*$/u.test(value);

const regularEnglishForms = (term: string) => {
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
};

const expandedHighlightForms = (term: string) => {
  const lower = term.toLocaleLowerCase();
  return [...(IRREGULAR_ENGLISH_HIGHLIGHT_FORMS[lower] || []), ...regularEnglishForms(term)];
};

const splitHighlightTerms = (...values: Array<unknown>) => {
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
};

const currentExampleHighlightTerms = computed(() => {
  const currentTranslationText = props.resultData?.translations?.[props.activeLang]?.text;
  return splitHighlightTerms(currentWord.value, currentTranslationText);
});

const senseExampleHighlightTerms = (sense: any) => {
  const sourceLang = props.resultData?.detected_source_lang || props.resultData?.source_lang || '';
  const currentTranslationText = props.resultData?.translations?.[props.activeLang]?.text;
  return splitHighlightTerms(
    currentWord.value,
    currentTranslationText,
    senseTerm(sense, props.activeLang),
    sourceLang ? senseTerm(sense, sourceLang) : ''
  );
};

const senseReading = (sense: any, lang: string) => {
  const localization = sense?.localizations?.[lang] || {};
  const group = sense?.pronunciation_group || {};
  const label = localization.reading || localization.pronunciation || (group.lang === lang ? group.reading : '') || '';
  const key = (group.lang === lang ? group.reading_key : '') || label.toLocaleLowerCase();
  const system =
    localization.reading_system ||
    localization.pronunciation_system ||
    (group.lang === lang ? group.reading_system : '') ||
    '';
  return { label, key, system };
};

const sensePronunciation = (sense: any, lang: string) => {
  const localization = sense?.localizations?.[lang] || {};
  const label = localization.pronunciation || localization.reading || '';
  const system = localization.pronunciation_system || localization.reading_system || '';
  return { label, system };
};

const senseKey = (sense: any) => {
  return `${sense?.sense_order || ''}:${sense?.gloss_key || ''}`;
};

const formatSenseCopyText = (sense: any) => {
  const term = senseTerm(sense, props.activeLang);
  const definition = senseDefinition(sense, props.activeLang);
  return term ? `${term}: ${definition}` : definition;
};

const formatExampleCopyText = (example: any) => {
  const sentence = stripInlineAnnotations(example?.sentence || '');
  const translation = shouldShowExampleTranslation(example, props.activeLang)
    ? stripInlineAnnotations(exampleTranslation(example, props.activeLang))
    : '';
  return translation ? `${sentence}\n${translation}` : sentence;
};

const senseExamples = (sense: any) => {
  return Array.isArray(sense?.examples)
    ? sense.examples.filter((example: any) => exampleTranslation(example, props.activeLang))
    : [];
};

const hasSenseScopedExamples = computed(() => {
  return currentSenses.value.some((sense: any) => senseExamples(sense).length > 0);
});

const exampleTranslation = (example: any, lang: string) => {
  return example?.localizations?.[lang]?.text || example?.translations?.[lang] || '';
};

const shouldShowExampleTranslation = (example: any, lang: string) => {
  const translation = exampleTranslation(example, lang);
  if (!translation) return false;
  return normalizeComparableText(example?.sentence) !== normalizeComparableText(translation);
};

const normalizeComparableText = (value: any) => {
  return String(value || '')
    .replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1')
    .replace(/\s+/g, '')
    .trim();
};
</script>

<template>
  <div class="flex flex-col w-full">
    <!-- Simple Text Fallback -->
    <div
      v-if="typeof resultData === 'string'"
      class="bg-m3-surface-container rounded-[28px] p-6 text-m3-on-surface font-medium mt-6"
    >
      {{ resultData }}
    </div>

    <div
      v-else-if="currentWordDetail && currentWordDetail.definition && currentSenses.length === 0"
      class="bg-m3-surface-container rounded-[28px] p-6 mt-6 border border-m3-outline-variant/20"
    >
      <p class="text-m3-on-surface text-lg leading-relaxed">{{ currentWordDetail.definition }}</p>
    </div>

    <!-- Senses and Examples -->
    <div class="flex flex-col" v-if="currentSenses.length > 0 || currentExamples.length > 0">
      <!-- Definitions / Senses -->
      <div
        v-if="currentSenses.length > 0"
        class="flex flex-col pt-3 pb-6"
        :class="!hasSenseScopedExamples && currentExamples.length > 0 ? 'border-b border-m3-outline-variant/25' : ''"
      >
        <div class="flex items-center gap-2 mb-3">
          <span class="w-1.5 h-3.5 rounded-full bg-m3-primary"></span>
          <h4 class="text-[0.82rem] font-bold text-m3-on-surface tracking-wide flex items-center gap-2">
            释义
            <span class="px-2 py-0.5 rounded-full bg-m3-primary/10 text-m3-primary text-[0.65rem] font-semibold tracking-normal uppercase">
              Definições
            </span>
          </h4>
        </div>

        <div v-for="group in currentSenseGroups" :key="group.key" class="py-2">
          <div
            v-if="showSenseGroups && group.label"
            class="sticky top-0 z-[1] -mx-1 mb-2 px-1 py-2 bg-m3-surface-container/95 backdrop-blur-sm"
          >
            <span
              class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-m3-primary/10 text-m3-primary text-[0.95rem] font-black tracking-wide"
            >
              <Volume2 class="w-3.5 h-3.5 opacity-80" />
              {{ group.label }}
              <span v-if="group.system" class="text-[0.62rem] uppercase tracking-widest opacity-70">{{
                group.system
              }}</span>
            </span>
          </div>

          <div v-for="sense in group.senses" :key="`${group.key}-${sense.sense_order}-${sense.gloss_key}`" class="py-5">
            <div class="flex gap-4 items-start">
              <span
                class="flex items-center justify-center w-[30px] h-[30px] rounded-[9px] bg-m3-primary/10 text-m3-primary text-[0.95rem] font-black shrink-0 mt-1.5"
                >{{ sense.sense_order }}</span
              >
              <div class="flex flex-col gap-2 w-full pt-0.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    v-if="sense.part_of_speech"
                    class="px-2 py-0.5 rounded-[6px] bg-m3-surface-variant/60 text-m3-on-surface-variant text-[0.65rem] font-bold uppercase tracking-widest"
                    >{{ sense.part_of_speech }}</span
                  >
                </div>
                <div
                  v-if="shouldShowSenseTerm(sense) || sensePronunciation(sense, activeLang).label"
                  class="flex flex-wrap items-center gap-2.5"
                >
                  <span
                    v-if="shouldShowSenseTerm(sense)"
                    class="text-m3-on-surface text-[1.35rem] sm:text-[1.65rem] font-black leading-tight"
                    ><FuriganaText :text="senseTerm(sense, activeLang)"
                  /></span>
                  <button
                    v-if="sensePronunciation(sense, activeLang).label"
                    @click="speak(senseTerm(sense, activeLang) || senseDefinition(sense, activeLang), activeLang)"
                    class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-primary/10 text-m3-primary text-[0.8rem] sm:text-[0.85rem] font-black tracking-wide hover:bg-m3-primary hover:text-m3-on-primary transition-all"
                    aria-label="Pronunciar sentido"
                  >
                    <Volume2 class="w-3.5 h-3.5 opacity-80" />
                    {{ sensePronunciation(sense, activeLang).label }}
                    <span
                      v-if="sensePronunciation(sense, activeLang).system"
                      class="text-[0.58rem] uppercase tracking-widest opacity-70"
                      >{{ sensePronunciation(sense, activeLang).system }}</span
                    >
                  </button>
                  <button
                    @click="copy(formatSenseCopyText(sense), `sense-${senseKey(sense)}`)"
                    class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                    :aria-label="isCopied(`sense-${senseKey(sense)}`) ? '已复制' : '复制释义'"
                    :title="isCopied(`sense-${senseKey(sense)}`) ? '已复制' : '复制释义'"
                  >
                    <Check v-if="isCopied(`sense-${senseKey(sense)}`)" class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                    <Copy v-else class="w-3.5 h-3.5 opacity-70" />
                  </button>
                </div>
                <div class="flex items-baseline gap-2">
                  <span class="text-m3-on-surface text-[1.05rem] sm:text-[1.22rem] font-medium leading-relaxed flex-1"
                    ><FuriganaText :text="senseDefinition(sense, activeLang)"
                  /></span>
                  <button
                    v-if="!shouldShowSenseTerm(sense) && !sensePronunciation(sense, activeLang).label"
                    @click="copy(formatSenseCopyText(sense), `sense-${senseKey(sense)}`)"
                    class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors shrink-0"
                    :aria-label="isCopied(`sense-${senseKey(sense)}`) ? '已复制' : '复制释义'"
                    :title="isCopied(`sense-${senseKey(sense)}`) ? '已复制' : '复制释义'"
                  >
                    <Check v-if="isCopied(`sense-${senseKey(sense)}`)" class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                    <Copy v-else class="w-3.5 h-3.5 opacity-70" />
                  </button>
                </div>

                <!-- Sense Scoped Examples -->
                <div v-if="senseExamples(sense).length > 0" class="mt-4 flex flex-col gap-3">
                  <div
                    v-for="(example, i) in senseExamples(sense)"
                    :key="`${senseKey(sense)}-example-${i}`"
                    class="flex gap-3 items-start rounded-[14px] bg-m3-surface/55 border border-m3-outline-variant/15 p-3"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/50 mt-2.5 shrink-0"></span>
                    <div class="flex flex-col gap-1 flex-1 min-w-0">
                      <p class="text-m3-on-surface text-[0.98rem] font-medium leading-relaxed">
                        <FuriganaText :text="example.sentence" :highlight="senseExampleHighlightTerms(sense)" />
                      </p>
                      <p
                        v-if="shouldShowExampleTranslation(example, activeLang)"
                        class="text-m3-on-surface-variant text-[0.9rem] leading-relaxed"
                      >
                        <FuriganaText
                          :text="exampleTranslation(example, activeLang)"
                          :highlight="senseExampleHighlightTerms(sense)"
                        />
                      </p>
                    </div>
                    <div class="flex items-center gap-1 shrink-0 ml-1 pt-0.5">
                      <button
                        @click="speak(example.sentence, sourceLanguageCode)"
                        class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                        title="朗读例句 / Pronunciar"
                        aria-label="朗读例句"
                      >
                        <Volume2 class="w-3.5 h-3.5 opacity-75" />
                      </button>
                      <button
                        @click="copy(formatExampleCopyText(example), `scoped-ex-${senseKey(sense)}-${i}`)"
                        class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                        :title="isCopied(`scoped-ex-${senseKey(sense)}-${i}`) ? '已复制' : '复制例句'"
                        :aria-label="isCopied(`scoped-ex-${senseKey(sense)}-${i}`) ? '已复制' : '复制例句'"
                      >
                        <Check v-if="isCopied(`scoped-ex-${senseKey(sense)}-${i}`)" class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                        <Copy v-else class="w-3.5 h-3.5 opacity-75" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- General Examples (when not scoped to senses) -->
      <div v-if="currentExamples.length > 0 && !hasSenseScopedExamples" class="pt-6 pb-2">
        <div class="flex items-center gap-2 mb-3">
          <span class="w-1.5 h-3.5 rounded-full bg-m3-primary"></span>
          <h4 class="text-[0.82rem] font-bold text-m3-on-surface tracking-wide flex items-center gap-2">
            例句
            <span class="px-2 py-0.5 rounded-full bg-m3-primary/10 text-m3-primary text-[0.65rem] font-semibold tracking-normal uppercase">
              Exemplos
            </span>
          </h4>
        </div>
        <div class="flex flex-col">
          <div v-for="(example, i) in currentExamples" :key="i" class="py-4">
            <div class="flex gap-4 items-start">
              <span class="flex items-center justify-center w-[26px] h-[26px] shrink-0 mt-1">
                <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/50"></span>
              </span>
              <div class="flex flex-col gap-1.5 flex-1 min-w-0 pt-0.5">
                <p class="text-m3-on-surface text-[1.05rem] font-medium leading-relaxed">
                  <FuriganaText :text="example.sentence" :highlight="currentExampleHighlightTerms" />
                </p>
                <p
                  v-if="shouldShowExampleTranslation(example, activeLang)"
                  class="text-m3-on-surface-variant text-[0.95rem] leading-relaxed"
                >
                  <FuriganaText
                    :text="exampleTranslation(example, activeLang)"
                    :highlight="currentExampleHighlightTerms"
                  />
                </p>
              </div>
              <div class="flex items-center gap-1 shrink-0 ml-1 pt-1">
                <button
                  @click="speak(example.sentence, sourceLanguageCode)"
                  class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                  title="朗读例句 / Pronunciar"
                  aria-label="朗读例句"
                >
                  <Volume2 class="w-3.5 h-3.5 opacity-75" />
                </button>
                <button
                  @click="copy(formatExampleCopyText(example), `general-ex-${i}`)"
                  class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                  :title="isCopied(`general-ex-${i}`) ? '已复制' : '复制例句'"
                  :aria-label="isCopied(`general-ex-${i}`) ? '已复制' : '复制例句'"
                >
                  <Check v-if="isCopied(`general-ex-${i}`)" class="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                  <Copy v-else class="w-3.5 h-3.5 opacity-75" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
