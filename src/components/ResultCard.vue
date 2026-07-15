<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useTranslation } from '../composables/useTranslation';
import { useBookmarks } from '../composables/useBookmarks';
import FuriganaText from './FuriganaText.vue';
import { Star, Flag, AlertTriangle, X, Volume2, Sparkles, Loader2, ChevronDown, Check } from 'lucide-vue-next';
import { reportTranslationError } from '../utils/api.js';

import { settings } from '../composables/useSettings';

const { resultData, isTranslating } = useTranslation();
const { isBookmarked, toggleBookmark } = useBookmarks();
const colorScheme = computed(() => settings.colorScheme || 'blue');

const reportOptions = [
  { value: "", label: "快速一键报告 / Relatório Rápido" },
  { value: "拼写错误", label: "拼写错误 / Erro Ortográfico" },
  { value: "释义不准确", label: "释义不准确 / Definição Imprecisa" },
  { value: "语境不符", label: "语境不符 / Contexto Inadequado" },
  { value: "其他", label: "其他... / Outros..." }
];

const currentWord = computed(() => {
  if (currentWordDetail.value?.word) return currentWordDetail.value.word;
  if (typeof resultData.value === 'string') return resultData.value;
  if (currentTranslation.value?.text) return currentTranslation.value.text;
  return '';
});
const isDesktop = ref(false);
const DEFAULT_RESULT_LANG = 'en';
const activeLang = ref(DEFAULT_RESULT_LANG);

const isReportModalOpen = ref(false);
const reportReason = ref('');
const isReporting = ref(false);
const isReported = ref(false);

const langs = [
  { code: 'en', label: 'EN' },
  { code: 'pt-BR', label: 'PT' },
  { code: 'zh', label: '中' },
  { code: 'ja', label: '日' }
];

const activeTabIndex = computed(() => {
  return Math.max(0, langs.findIndex(l => l.code === activeLang.value));
});

const transitionName = ref('slide-left');
const expandedSenseKeys = ref<Set<string>>(new Set());

const selectLang = (index: number, code: string) => {
  if (activeLang.value === code) return;
  const isSlideRight = index > activeTabIndex.value;
  transitionName.value = isSlideRight ? 'slide-left' : 'slide-right';
  activeLang.value = code;
};

const tabContainerRef = ref<HTMLElement | null>(null);
const indicatorStyle = ref({ width: '25%', transform: 'translate3d(0,0,0)', left: '6px' });

const updateIndicator = () => {
  if (!tabContainerRef.value) return;
  const content = tabContainerRef.value.querySelector('.v-slide-group__content');
  if (!content) return;
  
  const tabs = content.querySelectorAll('.v-tab');
  const activeBtn = tabs[activeTabIndex.value] as HTMLElement;
  if (activeBtn) {
    indicatorStyle.value = {
      width: `${activeBtn.offsetWidth}px`,
      transform: `translate3d(${activeBtn.offsetLeft}px, 0, 0)`,
      left: '6px'
    };
  }
};

watch(activeTabIndex, async () => {
  await nextTick();
  updateIndicator();
});

watch(resultData, async (value) => {
  if (value && typeof value !== 'string') {
    activeLang.value = DEFAULT_RESULT_LANG;
  }
  await nextTick();
  setTimeout(updateIndicator, 50);
});

onMounted(() => {
  setTimeout(updateIndicator, 50);
  window.addEventListener('resize', updateIndicator);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateIndicator);
});

const currentTranslation = computed(() => {
  if (!resultData.value || !resultData.value.translations) return null;
  return resultData.value.translations[activeLang.value] || null;
});

const currentWordDetail = computed(() => {
  if (!resultData.value || !resultData.value.word_details) return null;
  return resultData.value.word_details[activeLang.value] || null;
});

const currentSenses = computed(() => {
  if (!resultData.value) return [];
  const groupedSenses = Array.isArray(resultData.value.pronunciation_groups)
    ? resultData.value.pronunciation_groups.flatMap((group: any) => Array.isArray(group.senses) ? group.senses : [])
    : [];
  const source = groupedSenses.length > 0 ? groupedSenses : (resultData.value.senses || []);
  return source.filter((s: any) => senseDefinition(s, activeLang.value));
});

const currentSenseGroups = computed(() => {
  const groups: Array<{ key: string; label: string; system: string; senses: any[] }> = [];
  const index = new Map<string, { key: string; label: string; system: string; senses: any[] }>();
  const sourceLang = resultData.value?.detected_source_lang || resultData.value?.source_lang || '';

  if (resultData.value && Array.isArray(resultData.value.pronunciation_groups)) {
    let groupedSenseCount = 0;
    for (const group of resultData.value.pronunciation_groups) {
      const senses = Array.isArray(group.senses)
        ? group.senses.filter((sense: any) => senseDefinition(sense, activeLang.value))
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
    const reading = senseReading(sense, activeLang.value);
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
  return resultData.value?.provider === 'dictionary' && currentSenses.value.length > 0;
});

const showSenseGroups = computed(() => {
  return currentSenseGroups.value.some((group) => group.label) && currentSenseGroups.value.length > 1;
});

const currentExamples = computed(() => {
  if (!resultData.value || !resultData.value.examples) return [];
  return resultData.value.examples.filter((e: any) => exampleTranslation(e, activeLang.value));
});

const currentExplanation = computed(() => {
  if (!resultData.value) return '';
  if (resultData.value.type !== 'sentence') return '';
  return resultData.value.explanations?.[activeLang.value] || resultData.value.explanation || '';
});

const senseDefinition = (sense: any, lang: string) => {
  return sense?.localizations?.[lang]?.definition || sense?.definitions?.[lang] || '';
};

const senseTerm = (sense: any, lang: string) => {
  return sense?.localizations?.[lang]?.term || '';
};

const stripInlineAnnotations = (value: string) => {
  return String(value || '').replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1');
};

const ENGLISH_HIGHLIGHT_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'be', 'by', 'for', 'from', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with'
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
  return [
    ...(IRREGULAR_ENGLISH_HIGHLIGHT_FORMS[lower] || []),
    ...regularEnglishForms(term)
  ];
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
  return splitHighlightTerms(currentWord.value, currentTranslation.value?.text);
});

const senseExampleHighlightTerms = (sense: any) => {
  const sourceLang = resultData.value?.detected_source_lang || resultData.value?.source_lang || '';
  return splitHighlightTerms(
    currentWord.value,
    currentTranslation.value?.text,
    senseTerm(sense, activeLang.value),
    sourceLang ? senseTerm(sense, sourceLang) : ''
  );
};

const senseReading = (sense: any, lang: string) => {
  const localization = sense?.localizations?.[lang] || {};
  const group = sense?.pronunciation_group || {};
  const label =
    localization.reading ||
    localization.pronunciation ||
    (group.lang === lang ? group.reading : '') ||
    '';
  const key =
    (group.lang === lang ? group.reading_key : '') ||
    label.toLocaleLowerCase();
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

const isSenseExpanded = (sense: any) => {
  return expandedSenseKeys.value.has(senseKey(sense));
};

const toggleSenseExpanded = (sense: any) => {
  const next = new Set(expandedSenseKeys.value);
  const key = senseKey(sense);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedSenseKeys.value = next;
};

const senseLocalization = (sense: any, lang: string) => {
  return sense?.localizations?.[lang] || {};
};

const senseExamples = (sense: any) => {
  return Array.isArray(sense?.examples)
    ? sense.examples.filter((example: any) => exampleTranslation(example, activeLang.value))
    : [];
};

const hasSenseScopedExamples = computed(() => {
  return currentSenses.value.some((sense: any) => senseExamples(sense).length > 0);
});

const langDisplay = (lang: string) => {
  return langs.find((item) => item.code === lang)?.label || lang;
};

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

const speak = (text: string, lang: string) => {
  if (!window.speechSynthesis) return;
  
  // Pre-warm voices if not loaded
  window.speechSynthesis.getVoices();
  
  // Strip any inline Furigana or IPA brackets (e.g. {漢字|かんじ} -> 漢字)
  const cleanTextForSpeech = text.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, "$1");
  const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech);
  
  // Strict locale mapping to prevent fallback to system default voice
  const localeMap: Record<string, string> = {
    'zh': 'zh-CN',
    'en': 'en-US',
    'ja': 'ja-JP',
    'pt': 'pt-BR',
    'pt-BR': 'pt-BR'
  };
  const targetLangCode = localeMap[lang] || lang;
  utterance.lang = targetLangCode;
  
  // Explicitly assign a matching high-quality voice. We prioritize online neural/natural voices,
  // enhanced local voices, and Chrome/Edge specific high-quality voices over standard mechanical local voices.
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const matchingVoices = voices.filter(v => {
      const normalizedLang = v.lang.replace('_', '-').toLowerCase();
      const normalizedTarget = targetLangCode.toLowerCase();
      return normalizedLang === normalizedTarget || normalizedLang.startsWith(normalizedTarget.split('-')[0]);
    });

    if (matchingVoices.length > 0) {
      const sortedVoices = [...matchingVoices].sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aIsOnline = !a.localService;
        const bIsOnline = !b.localService;
        const aIsNatural = aName.includes('natural') || aName.includes('enhanced') || aName.includes('siri') || aName.includes('google');
        const bIsNatural = bName.includes('natural') || bName.includes('enhanced') || bName.includes('siri') || bName.includes('google');

        if (aIsNatural && !bIsNatural) return -1;
        if (!aIsNatural && bIsNatural) return 1;
        if (aIsOnline && !bIsOnline) return -1;
        if (!aIsOnline && bIsOnline) return 1;
        return 0;
      });

      utterance.voice = sortedVoices[0];
    }
  }
  
  window.speechSynthesis.cancel();
  
  // A slight delay after cancel() fixes a known browser bug 
  // where synchronous cancel + speak causes a 1-2 second delay or dropped audio
  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 50);
};

const updateDesktopState = () => {
  isDesktop.value = window.innerWidth >= 960;
};

const syncBodyClasses = () => {
  if (resultData.value || isTranslating.value) {
    document.body.classList.add('has-result');
    document.body.classList.remove('has-desktop-idle');
  } else if (isDesktop.value) {
    document.body.classList.remove('has-result');
    document.body.classList.add('has-desktop-idle');
  } else {
    document.body.classList.remove('has-result');
    document.body.classList.remove('has-desktop-idle');
  }
};

watch([resultData, isTranslating, isDesktop], syncBodyClasses);

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isReportModalOpen.value) {
    isReportModalOpen.value = false;
  }
};

onMounted(() => {
  updateDesktopState();
  syncBodyClasses();
  window.addEventListener('resize', updateDesktopState);
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateDesktopState);
  window.removeEventListener('keydown', handleKeydown);
});
const submitReport = async () => {
  if (!currentWord.value) return;
  isReporting.value = true;
  try {
    await reportTranslationError({
      term: currentWord.value,
      target_lang: activeLang.value,
      reason: reportReason.value
    });
    isReported.value = true;
    setTimeout(() => {
      isReportModalOpen.value = false;
      isReported.value = false;
    }, 2000);
  } catch (e) {
    alert("Failed to report: " + e);
  } finally {
    isReporting.value = false;
  }
};

</script>

<template>
  <section class="flex flex-col w-full relative z-0">
    <Transition mode="out-in" name="fade" @enter="updateIndicator">
      <!-- Result State -->
      <div v-if="resultData" class="bg-m3-surface-container rounded-[28px] p-5 sm:p-8 shadow-sm border border-m3-outline-variant/20 relative">
        <div class="flex items-center justify-between w-full mb-6">
          <span class="text-[0.7rem] font-bold uppercase tracking-widest text-m3-on-surface-variant flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full" :class="resultData.provider === 'dictionary' ? 'bg-[#ff9800]' : ((resultData.cache_hit ?? resultData.cached) ? 'bg-m3-primary' : 'bg-[#008053]')"></span>
            <div class="flex flex-col">
              <span class="flex items-center gap-1.5">
                {{ resultData.provider === 'dictionary' ? '核心词典' : ((resultData.cache_hit ?? resultData.cached) ? '已缓存' : 'AI') }}
                <Loader2 v-if="isTranslating && resultData.provider !== 'dictionary' && !(resultData.cache_hit ?? resultData.cached)" class="w-3 h-3.5 animate-spin text-m3-primary" />
              </span>
              <span class="text-[0.55rem] opacity-70 tracking-normal mt-0.5" v-if="resultData.provider === 'dictionary' || (resultData.cache_hit ?? resultData.cached)">
                {{ resultData.provider === 'dictionary' ? 'Dicionário Principal' : 'Em cache' }}
              </span>
              <span class="text-[0.55rem] opacity-70 tracking-normal mt-0.5 uppercase" v-else>
                {{ resultData.provider }}<template v-if="resultData.model"> / {{ resultData.model }}</template>
              </span>
            </div>
          </span>
          
          <div class="flex gap-2 items-center shrink-0">
            <v-btn 
              v-if="currentWord && resultData?.type !== 'sentence'" 
              icon
              variant="flat"
              @click="toggleBookmark(currentWord)" 
              class="!w-[44px] !h-[44px] shrink-0 hover:-translate-y-0.5 transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
              :class="isBookmarked(currentWord) ? '!bg-[#FFD9E2]/80 !text-[#82284D] !shadow-md hover:!bg-[#FFD9E2]' : '!bg-m3-surface-container-highest !text-m3-on-surface-variant hover:!bg-m3-primary hover:!text-m3-on-primary hover:!shadow-md'"
              aria-label="收藏单词 / Salvar palavra"
            >
              <Star :class="{ 'fill-current': isBookmarked(currentWord) }" class="w-5 h-5" />
            </v-btn>
            <v-btn 
              v-if="currentWord && resultData?.type !== 'sentence'" 
              icon
              variant="flat"
              @click="isReportModalOpen = true; reportReason = ''"
              class="!w-[44px] !h-[44px] shrink-0 !bg-m3-surface-container-highest !text-m3-on-surface-variant hover:!bg-[#FFD9E2] hover:!text-[#82284D] hover:!shadow-md hover:-translate-y-0.5 transition-all"
              aria-label="纠错反馈 / Enviar feedback"
            >
              <Flag class="w-5 h-5" />
            </v-btn>
            <v-btn 
              v-if="currentTranslation" 
              icon
              variant="flat"
              @click="speak(currentTranslation.audio_text || currentTranslation.text, activeLang)" 
              class="!w-[44px] !h-[44px] shrink-0 !bg-m3-surface-container-highest !text-m3-on-surface-variant hover:!bg-m3-primary hover:!text-m3-on-primary hover:!shadow-md hover:-translate-y-0.5 transition-all focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
              aria-label="朗读发音 / Pronunciar"
            >
              <Volume2 class="w-5 h-5" />
            </v-btn>
          </div>
        </div>
        <div class="mb-6">
          <div class="relative bg-m3-surface-container-high/40 rounded-[18px] p-1.5 shadow-inner border border-m3-outline-variant/10">
            <!-- Sliding Indicator -->
            <div 
              class="absolute top-1.5 bottom-1.5 bg-m3-primary rounded-[14px] shadow-sm transition-all duration-300 z-0"
              style="transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform, width;"
              :style="indicatorStyle"
            ></div>

            <div ref="tabContainerRef" class="w-full">
              <v-tabs
                v-model="activeLang"
                hide-slider
                height="auto"
                class="custom-tabs relative z-10 !bg-transparent"
              >
              <v-tab 
                v-for="(lang, i) in langs" 
                :key="lang.code"
                :value="lang.code"
                :ripple="false"
                class="!rounded-[14px] !py-2.5 !text-[0.95rem] !font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary relative z-10 transition-colors duration-200 !min-w-0 !normal-case !tracking-normal"
                :class="activeLang === lang.code ? '!text-m3-on-primary' : '!text-m3-on-surface-variant hover:!text-m3-on-surface'"
              >
                {{ lang.label }}
              </v-tab>
            </v-tabs>
            </div>
          </div>
        </div>

        <!-- Hero Header -->
        <div v-if="!hasDictionarySenses" class="flex flex-col items-start justify-start mb-4">
          <h1 class="text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] font-display font-black text-m3-on-surface tracking-tight break-words">
            <FuriganaText :text="currentWord" />
          </h1>
        </div>
        
        <!-- Phonetics -->
        <div v-if="!hasDictionarySenses && currentTranslation?.phonetic" class="flex flex-wrap gap-2 mb-6">
          <button 
            @click="speak(currentTranslation.audio_text || currentTranslation.text, activeLang)"
            class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-m3-outline-variant/30 bg-m3-surface text-m3-on-surface-variant text-[0.95rem] font-medium tracking-wide shadow-sm cursor-pointer hover:bg-m3-primary hover:text-m3-on-primary hover:border-transparent hover:shadow-md transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary active:scale-95"
            aria-label="朗读音标发音 / Pronunciar"
          >
            <Volume2 class="w-3.5 h-3.5 opacity-70" />
            {{ currentTranslation.phonetic }}
          </button>
        </div>

        <!-- Content Area -->
        <div :key="activeLang" class="w-full flex flex-col">
            <!-- Simple Text Fallback -->
            <div v-if="typeof resultData === 'string'" class="bg-m3-surface-container rounded-[28px] p-6 text-m3-on-surface font-medium mt-6">
              {{ resultData }}
            </div>
            <div v-else-if="currentWordDetail && currentWordDetail.definition && currentSenses.length === 0" class="bg-m3-surface-container rounded-[28px] p-6 mt-6 border border-m3-outline-variant/20">
              <p class="text-m3-on-surface text-lg leading-relaxed">{{ currentWordDetail.definition }}</p>
            </div>

            <!-- Sentence Explanation -->
            <div v-if="resultData && resultData.type === 'sentence' && currentExplanation" class="flex flex-col pt-3 pb-6 mt-2">
              <h4 class="text-[0.7rem] font-black uppercase tracking-[0.2em] text-m3-primary/80 mb-3 flex items-center gap-2">
                <span class="w-1 h-3 rounded-full bg-m3-primary/50"></span>
                <div class="flex flex-col">
                  <span>句意解析</span>
                  <span class="text-[0.6rem] opacity-70 tracking-widest mt-0.5">Explicação</span>
                </div>
              </h4>
              <div class="bg-m3-surface-container rounded-[22px] p-5 border border-m3-outline-variant/15 shadow-inner">
                <p class="text-m3-on-surface text-[1rem] leading-relaxed whitespace-pre-line font-medium">
                  <FuriganaText :text="currentExplanation" />
                </p>
              </div>
            </div>

            <!-- Content Area -->
            <div class="flex flex-col" v-if="currentSenses.length > 0 || currentExamples.length > 0">
              <!-- Definitions / Senses -->
              <div v-if="currentSenses.length > 0" class="flex flex-col pt-3 pb-6" :class="(!hasSenseScopedExamples && currentExamples.length > 0) ? 'border-b border-m3-outline-variant/25' : ''">
                <h4 class="text-[0.7rem] font-black uppercase tracking-[0.2em] text-m3-primary/80 mb-2 flex items-center gap-2">
                  <span class="w-1 h-3 rounded-full bg-m3-primary/50"></span>
                  <div class="flex flex-col">
                    <span>释义</span>
                    <span class="text-[0.6rem] opacity-70 tracking-widest mt-0.5">Definições</span>
                  </div>
                </h4>
                <div v-for="group in currentSenseGroups" :key="group.key" class="py-2">
                  <div v-if="showSenseGroups && group.label" class="sticky top-0 z-[1] -mx-1 mb-2 px-1 py-2 bg-m3-surface-container/95 backdrop-blur-sm">
                    <span class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-m3-primary/10 text-m3-primary text-[0.95rem] font-black tracking-wide">
                      <Volume2 class="w-3.5 h-3.5 opacity-80" />
                      {{ group.label }}
                      <span v-if="group.system" class="text-[0.62rem] uppercase tracking-widest opacity-70">{{ group.system }}</span>
                    </span>
                  </div>
                  <div v-for="sense in group.senses" :key="`${group.key}-${sense.sense_order}-${sense.gloss_key}`" class="py-5">
                    <div class="flex gap-4 items-start">
                      <span class="flex items-center justify-center w-[30px] h-[30px] rounded-[9px] bg-m3-primary/10 text-m3-primary text-[0.95rem] font-black shrink-0 mt-1.5">{{ sense.sense_order }}</span>
                      <div class="flex flex-col gap-2 w-full pt-0.5">
                        <div class="flex flex-wrap items-center gap-2">
                          <span v-if="sense.part_of_speech" class="px-2 py-0.5 rounded-[6px] bg-m3-surface-variant/60 text-m3-on-surface-variant text-[0.65rem] font-bold uppercase tracking-widest">{{ sense.part_of_speech }}</span>
                        </div>
                        <div class="flex flex-wrap items-center gap-2.5">
                          <span v-if="senseTerm(sense, activeLang)" class="text-m3-on-surface text-[1.35rem] sm:text-[1.65rem] font-black leading-tight"><FuriganaText :text="senseTerm(sense, activeLang)" /></span>
                          <button
                            v-if="sensePronunciation(sense, activeLang).label"
                            @click="speak(senseTerm(sense, activeLang) || senseDefinition(sense, activeLang), activeLang)"
                            class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-primary/10 text-m3-primary text-[0.8rem] sm:text-[0.85rem] font-black tracking-wide hover:bg-m3-primary hover:text-m3-on-primary transition-all"
                            aria-label="Pronunciar sentido"
                          >
                            <Volume2 class="w-3.5 h-3.5 opacity-80" />
                            {{ sensePronunciation(sense, activeLang).label }}
                            <span v-if="sensePronunciation(sense, activeLang).system" class="text-[0.58rem] uppercase tracking-widest opacity-70">{{ sensePronunciation(sense, activeLang).system }}</span>
                          </button>
                          <button
                            v-if="sense.localizations"
                            @click="toggleSenseExpanded(sense)"
                            class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface-variant text-[0.78rem] font-black hover:bg-m3-surface-container-high transition-all"
                            aria-label="Toggle multilingual sense details"
                          >
                            四语
                            <ChevronDown class="w-3.5 h-3.5 transition-transform" :class="isSenseExpanded(sense) ? 'rotate-180' : ''" />
                          </button>
                        </div>
                        <span class="text-m3-on-surface text-[1.05rem] sm:text-[1.22rem] font-medium leading-relaxed"><FuriganaText :text="senseDefinition(sense, activeLang)" /></span>

                        <div v-if="isSenseExpanded(sense)" class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div
                            v-for="lang in langs"
                            :key="`${senseKey(sense)}-${lang.code}`"
                            class="rounded-[14px] bg-m3-surface/70 border border-m3-outline-variant/20 p-3 flex flex-col gap-1.5"
                          >
                            <div class="flex items-center justify-between gap-2">
                              <span class="text-[0.65rem] font-black tracking-widest text-m3-primary uppercase">{{ langDisplay(lang.code) }}</span>
                              <span v-if="sensePronunciation(sense, lang.code).label" class="text-[0.72rem] font-bold text-m3-on-surface-variant">
                                {{ sensePronunciation(sense, lang.code).label }}
                              </span>
                            </div>
                            <span class="text-m3-on-surface text-[1rem] font-black leading-snug"><FuriganaText :text="senseLocalization(sense, lang.code).term" /></span>
                            <span class="text-m3-on-surface-variant text-[0.9rem] leading-relaxed"><FuriganaText :text="senseLocalization(sense, lang.code).definition" /></span>
                          </div>
                        </div>

                        <div v-if="senseExamples(sense).length > 0" class="mt-4 flex flex-col gap-3">
                          <div
                            v-for="(example, i) in senseExamples(sense)"
                            :key="`${senseKey(sense)}-example-${i}`"
                            class="flex gap-3 items-start rounded-[14px] bg-m3-surface/55 border border-m3-outline-variant/15 p-3"
                          >
                            <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/50 mt-2.5 shrink-0"></span>
                            <div class="flex flex-col gap-1">
                              <p class="text-m3-on-surface text-[0.98rem] font-medium leading-relaxed"><FuriganaText :text="example.sentence" :highlight="senseExampleHighlightTerms(sense)" /></p>
                              <p v-if="shouldShowExampleTranslation(example, activeLang)" class="text-m3-on-surface-variant text-[0.9rem] leading-relaxed"><FuriganaText :text="exampleTranslation(example, activeLang)" :highlight="senseExampleHighlightTerms(sense)" /></p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Examples -->
              <div v-if="currentExamples.length > 0 && !hasSenseScopedExamples" class="pt-6 pb-2">
                <h4 class="text-[0.7rem] font-black uppercase tracking-[0.2em] text-m3-primary/80 mb-2 flex items-center gap-2">
                  <span class="w-1 h-3 rounded-full bg-m3-primary/50"></span>
                  <div class="flex flex-col">
                    <span>例句</span>
                    <span class="text-[0.6rem] opacity-70 tracking-widest mt-0.5">Exemplos</span>
                  </div>
                </h4>
                <div class="flex flex-col">
                  <div v-for="(example, i) in currentExamples" :key="i" class="py-4">
                    <div class="flex gap-4 items-start">
                      <span class="flex items-center justify-center w-[26px] h-[26px] shrink-0 mt-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/50"></span>
                      </span>
                      <div class="flex flex-col gap-1.5 w-full pt-0.5">
                        <p class="text-m3-on-surface text-[1.05rem] font-medium leading-relaxed"><FuriganaText :text="example.sentence" :highlight="currentExampleHighlightTerms" /></p>
                        <p v-if="shouldShowExampleTranslation(example, activeLang)" class="text-m3-on-surface-variant text-[0.95rem] leading-relaxed"><FuriganaText :text="exampleTranslation(example, activeLang)" :highlight="currentExampleHighlightTerms" /></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
      </div>

      <!-- Shared Loading / Empty State -->
      <div v-else class="flex flex-col items-center justify-center py-10 gap-6 mt-4 md:mt-10">
        <!-- Themed Unified Loader Container -->
        <div 
          class="relative flex items-center justify-center w-28 h-28" 
          :class="`theme-loader-${colorScheme}`"
        >
          <!-- Idle decor elements (fade in/out smoothly) -->
          <div 
            class="absolute inset-0 theme-decor-idle-1 transition-all duration-500 ease-spring"
            :class="isTranslating ? 'opacity-0 scale-90' : 'opacity-100 scale-100'"
          ></div>
          <div 
            class="absolute inset-0 theme-decor-idle-2 transition-all duration-500 ease-spring"
            :class="isTranslating ? 'opacity-0 scale-90' : 'opacity-100 scale-100'"
          ></div>

          <!-- Active decor elements (fade in/out smoothly) -->
          <div 
            class="absolute inset-0 theme-decor-active-1 transition-all duration-500 ease-spring"
            :class="isTranslating ? 'opacity-100 scale-100' : 'opacity-0 scale-90'"
          ></div>
          <div 
            class="absolute inset-0 theme-decor-active-2 transition-all duration-500 ease-spring"
            :class="isTranslating ? 'opacity-100 scale-100' : 'opacity-0 scale-90'"
          ></div>
          
          <!-- Inner circle with smooth icon transition -->
          <div class="relative bg-m3-surface-container w-16 h-16 rounded-full flex items-center justify-center shadow-sm border border-m3-outline-variant/10 z-10 text-m3-primary/70 transition-all duration-500">
            <!-- Sparkles (Idle) -->
            <Sparkles 
              class="w-7 h-7 absolute transition-all duration-500 ease-spring"
              :class="isTranslating ? 'scale-0 rotate-45 opacity-0' : 'scale-100 rotate-0 opacity-100'"
            />
            <!-- Loader2 (Active) -->
            <Loader2 
              class="w-7 h-7 absolute transition-all duration-500 ease-spring"
              :class="isTranslating ? 'scale-100 rotate-180 opacity-100 animate-spin' : 'scale-0 rotate-0 opacity-0'"
            />
          </div>
        </div>
        <div class="flex flex-col items-center gap-1.5 opacity-80" :class="{ 'animate-float': !isTranslating }" style="animation-delay: 0.2s;">
          <template v-if="isTranslating">
            <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
              解析中<br/><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Analisando</span>
            </p>
            <p class="text-m3-outline text-[0.85rem] font-medium text-center">
              正在加载翻译结果...<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Carregando...</span>
            </p>
          </template>
          <template v-else>
            <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
              等待输入<br/><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Aguardando</span>
            </p>
            <p class="text-m3-outline text-[0.85rem] font-medium text-center">
              支持中 / 英 / 葡 / 日 自动识别<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Suporta detecção auto ZH/EN/PT/JA</span>
            </p>
          </template>
        </div>
      </div>
    </Transition>

    <!-- Error Report Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="isReportModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div class="bg-m3-surface-container rounded-[28px] shadow-2xl w-full max-w-md p-6 sm:p-8 flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <h3 class="text-xl font-display font-bold text-m3-on-surface flex items-center gap-3">
                <AlertTriangle class="w-6 h-6 text-m3-primary" /> 纠正 / Corrigir
              </h3>
              <button @click="isReportModalOpen = false" class="w-10 h-10 rounded-full bg-transparent hover:bg-m3-surface-container-high flex items-center justify-center text-m3-on-surface-variant transition-colors">
                <X class="w-5 h-5" />
              </button>
            </div>
            
            <p class="text-m3-on-surface-variant text-[0.95rem] leading-relaxed">
              发现 <strong>{{ currentWord }}</strong> 有误？ / Erro em <strong>{{ currentWord }}</strong>?<br/>
              后台模型将进行分析修正。 / A IA analisará e fará a correção.
            </p>

            <div class="flex flex-col gap-3">
              <label class="text-xs font-bold text-m3-on-surface-variant uppercase tracking-wider pl-1">类型 (可选) / Tipo (Opcional)</label>
              <v-select 
                v-model="reportReason" 
                :items="reportOptions" 
                item-title="label" 
                item-value="value"
                variant="solo"
                flat
                hide-details
                class="m3-native-select"
                menu-icon="none"
                :menu-props="{ contentClass: 'm3-select-menu-content' }"
              >
                <template v-slot:append-inner>
                  <ChevronDown class="w-5 h-5 text-m3-on-surface-variant opacity-70" />
                </template>
              </v-select>
            </div>

            <div class="flex items-center justify-end gap-3 mt-2">
              <button v-if="!isReported && !isReporting" @click="isReportModalOpen = false" class="px-6 py-2.5 rounded-full text-sm font-bold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors">
                取消 / Cancelar
              </button>
              <button 
                v-if="!isReported"
                @click="submitReport"
                :disabled="isReporting"
                class="px-6 py-2.5 rounded-full text-sm font-bold bg-m3-primary text-m3-on-primary hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2"
              >
                <Loader2 v-if="isReporting" class="w-4 h-4 animate-spin" />
                {{ isReporting ? '提交中... / Enviando...' : '提交 / Enviar' }}
              </button>
              <div v-else class="px-6 py-2.5 rounded-full bg-m3-primary/10 text-m3-primary text-sm font-bold flex items-center gap-2">
                <Check class="w-4 h-4" />
                感谢反馈！ / Obrigado!
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
:deep(.m3-native-select .v-field) {
  background: var(--color-m3-surface) !important;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 50%, transparent) !important;
  border-radius: 16px !important;
  min-height: 48px !important;
  color: var(--color-m3-on-surface) !important;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05) !important;
}
:deep(.m3-native-select .v-field__input) {
  font-weight: 700 !important;
  font-size: 0.9rem !important;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.animate-float {
  animation: float 4s ease-in-out infinite;
}
@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(1.5); opacity: 0; }
}
.animate-pulse-ring {
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}
.animation-delay-1500 {
  animation-delay: 1.5s;
}

/* Modal Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}
.modal-enter-active .bg-m3-surface-container,
.modal-leave-active .bg-m3-surface-container {
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .bg-m3-surface-container,
.modal-leave-to .bg-m3-surface-container {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

/* Tab Slide Transitions */
.slide-left-enter-active,
.slide-right-enter-active {
  transition: opacity 0.2s cubic-bezier(0.1, 0.9, 0.2, 1), transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
}
.slide-left-leave-active,
.slide-right-leave-active {
  transition: opacity 0.1s ease-in, transform 0.1s ease-in;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

:deep(.custom-tabs .v-slide-group__content) {
  display: grid !important;
  grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
  width: 100% !important;
  position: relative;
}

/* --- Themed wait/load loader animations --- */

.theme-decor-idle-1, .theme-decor-idle-2,
.theme-decor-active-1, .theme-decor-active-2 {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  pointer-events: none;
}

/* --- Blue Theme --- */
.theme-loader-blue .theme-decor-idle-1 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}
.theme-loader-blue .theme-decor-idle-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 15%, transparent);
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
  animation-delay: 1.5s;
}
.theme-loader-blue .theme-decor-active-1 {
  border-style: double;
  border-width: 4px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
  animation: classic-gear-cw 3s linear infinite;
}
.theme-loader-blue .theme-decor-active-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 40%, transparent);
  animation: classic-gear-ccw 5s linear infinite;
  margin: -4px;
}

/* --- Rose Theme --- */
.theme-loader-rose .theme-decor-idle-1,
.theme-loader-rose .theme-decor-idle-2 {
  border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
}
.theme-loader-rose .theme-decor-idle-1 {
  animation: rose-heartbeat 2.4s ease-in-out infinite;
}
.theme-loader-rose .theme-decor-idle-2 {
  animation: rose-heartbeat 2.4s ease-in-out infinite;
  animation-delay: 1.2s;
}
.theme-loader-rose .theme-decor-active-1 {
  animation: rose-morph 4s ease-in-out infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
}
.theme-loader-rose .theme-decor-active-2 {
  animation: rose-morph 6s ease-in-out infinite;
  animation-delay: -2s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  margin: -4px;
}

/* --- Mint Theme --- */
.theme-loader-mint .theme-decor-idle-1,
.theme-loader-mint .theme-decor-idle-2 {
  border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
}
.theme-loader-mint .theme-decor-idle-1 {
  animation: mint-breath 4s ease-in-out infinite;
}
.theme-loader-mint .theme-decor-idle-2 {
  animation: mint-breath 4s ease-in-out infinite;
  animation-delay: 2s;
}
.theme-loader-mint .theme-decor-active-1 {
  animation: mint-spin-cw 5s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-mint .theme-decor-active-2 {
  animation: mint-spin-ccw 7s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -6px;
}

/* --- Amber Theme --- */
.theme-loader-amber .theme-decor-idle-1,
.theme-loader-amber .theme-decor-idle-2 {
  border-style: dashed;
  border-width: 2px;
  border-color: color-mix(in srgb, var(--color-m3-primary) 35%, transparent);
}
.theme-loader-amber .theme-decor-idle-1 {
  animation: amber-flare 2.5s ease-out infinite;
}
.theme-loader-amber .theme-decor-idle-2 {
  animation: amber-flare 2.5s ease-out infinite;
  animation-delay: 1.25s;
}
.theme-loader-amber .theme-decor-active-1 {
  animation: amber-spin 3s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 60%, transparent);
}
.theme-loader-amber .theme-decor-active-2 {
  animation: amber-spin 4s linear infinite;
  animation-delay: -1.5s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
  margin: -5px;
}

/* --- Violet Theme --- */
.theme-loader-violet .theme-decor-idle-1,
.theme-loader-violet .theme-decor-idle-2 {
  border-radius: 35% 65% 35% 65% / 65% 35% 65% 35%;
  border-color: color-mix(in srgb, var(--color-m3-primary) 30%, transparent);
}
.theme-loader-violet .theme-decor-idle-1 {
  animation: violet-twinkle 4s ease-in-out infinite;
}
.theme-loader-violet .theme-decor-idle-2 {
  animation: violet-twinkle 4s ease-in-out infinite;
  animation-delay: 2s;
}
.theme-loader-violet .theme-decor-active-1 {
  animation: violet-spin 6s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-violet .theme-decor-active-2 {
  animation: violet-spin 9s linear infinite;
  animation-delay: -3s;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -5px;
}

/* --- Classic Theme --- */
.theme-loader-classic .theme-decor-idle-1,
.theme-loader-classic .theme-decor-idle-2 {
  border-color: color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
}
.theme-loader-classic .theme-decor-idle-1 {
  animation: classic-tick 4s steps(4, end) infinite;
}
.theme-loader-classic .theme-decor-idle-2 {
  animation: classic-tick 4s steps(4, end) infinite;
  animation-delay: 2s;
}
.theme-loader-classic .theme-decor-active-1 {
  border-style: dotted;
  border-width: 3px;
  animation: classic-gear-cw 12s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 50%, transparent);
}
.theme-loader-classic .theme-decor-active-2 {
  border-style: dotted;
  border-width: 3px;
  animation: classic-gear-ccw 18s linear infinite;
  border-color: color-mix(in srgb, var(--color-m3-primary) 20%, transparent);
  margin: -6px;
}

/* --- Keyframe Animations --- */
@keyframes rose-heartbeat {
  0% { transform: scale(0.9); opacity: 0.7; }
  15% { transform: scale(1.12); opacity: 0.95; }
  30% { transform: scale(0.96); opacity: 0.8; }
  45% { transform: scale(1.22); opacity: 0.45; }
  70%, 100% { transform: scale(1.4); opacity: 0; }
}

@keyframes rose-morph {
  0%, 100% { border-radius: 50% 50% 50% 50% / 40% 40% 60% 60%; transform: rotate(0deg); }
  50% { border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%; transform: rotate(180deg); }
}

@keyframes mint-breath {
  0%, 100% { transform: scale(0.85) rotate(-15deg); opacity: 0.6; }
  50% { transform: scale(1.08) rotate(15deg); opacity: 0.85; }
}

@keyframes mint-spin-cw {
  0% { transform: rotate(0deg); border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%; }
  100% { transform: rotate(360deg); border-radius: 60% 40% 60% 40% / 40% 60% 40% 60%; }
}
@keyframes mint-spin-ccw {
  0% { transform: rotate(0deg); border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%; }
  100% { transform: rotate(-360deg); border-radius: 40% 60% 40% 60% / 60% 40% 60% 40%; }
}

@keyframes amber-flare {
  0% { transform: scale(0.8) rotate(0deg); opacity: 0.7; }
  100% { transform: scale(1.45) rotate(45deg); opacity: 0; }
}

@keyframes amber-spin {
  0% { transform: rotate(0deg) scale(0.95); filter: blur(0.5px); }
  50% { transform: rotate(180deg) scale(1.06); filter: blur(1.5px); }
  100% { transform: rotate(360deg) scale(0.95); filter: blur(0.5px); }
}

@keyframes violet-twinkle {
  0%, 100% { transform: scale(0.8) rotate(0deg); opacity: 0.45; }
  50% { transform: scale(1.12) rotate(90deg); opacity: 0.95; }
}

@keyframes violet-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes classic-tick {
  0%, 100% { transform: scale(0.88); opacity: 0.85; }
  25% { transform: scale(0.94); opacity: 0.7; }
  50% { transform: scale(1.0); opacity: 0.55; }
  75% { transform: scale(1.06); opacity: 0.35; }
}

@keyframes classic-gear-cw {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
@keyframes classic-gear-ccw {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(-360deg); }
}

</style>
