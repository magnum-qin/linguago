<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useTranslation } from '../composables/useTranslation';
import { useBookmarks } from '../composables/useBookmarks';
import FuriganaText from './FuriganaText.vue';
import ResultLoader from './ResultLoader.vue';
import FeedbackModal from './FeedbackModal.vue';
import WordResultView from './WordResultView.vue';
import SentenceResultView from './SentenceResultView.vue';
import { Star, Flag, Volume2, Loader2, Copy, Check } from 'lucide-vue-next';
import { settings } from '../composables/useSettings';
import { speak } from '../utils/speech';
import { useCopy } from '../composables/useCopy';
import type { WordResponse, SentenceResponse, WordSense, LocalizedText, WordDetail } from '../types/translation';

const { resultData, isTranslating } = useTranslation();
const { isBookmarked, toggleBookmark } = useBookmarks();
const { copy, isCopied } = useCopy();
const colorScheme = computed(() => settings.colorScheme || 'blue');

const sourceLanguageCode = computed(() => {
  return resultData.value?.detected_source_lang || resultData.value?.source_lang || 'en';
});

const currentWord = computed(() => {
  if (currentWordDetail.value?.word) return currentWordDetail.value.word;
  if (typeof resultData.value === 'string') return resultData.value;
  if (currentTranslation.value?.text) return currentTranslation.value.text;
  return '';
});

const DEFAULT_RESULT_LANG = 'en';
const activeLang = ref(DEFAULT_RESULT_LANG);

const isReportModalOpen = ref(false);

const langs = [
  { code: 'en', label: 'EN' },
  { code: 'pt-BR', label: 'PT' },
  { code: 'zh', label: '中' },
  { code: 'ja', label: '日' }
];

const activeTabIndex = computed(() => {
  return Math.max(
    0,
    langs.findIndex((l) => l.code === activeLang.value)
  );
});

const transitionName = ref('slide-left');

const selectLang = (index: number, code: string) => {
  if (activeLang.value === code) return;
  const isSlideRight = index > activeTabIndex.value;
  transitionName.value = isSlideRight ? 'slide-left' : 'slide-right';
  activeLang.value = code;
};

const tabContainerRef = ref<HTMLElement | null>(null);
const indicatorStyle = ref({ width: '0px', transform: 'translate3d(0,0,0)', left: '0', opacity: 0 });

const updateIndicator = () => {
  if (!tabContainerRef.value) return;
  const content = tabContainerRef.value.querySelector('.custom-tabs-content');
  if (!content) return;

  const tabs = content.querySelectorAll('.custom-tab-btn');
  const activeBtn = tabs[activeTabIndex.value] as HTMLElement;
  if (activeBtn) {
    indicatorStyle.value = {
      width: `${activeBtn.offsetWidth}px`,
      transform: `translate3d(${activeBtn.offsetLeft}px, 0, 0)`,
      left: '0',
      opacity: 1
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

const wordResult = computed<WordResponse | null>(() => {
  if (resultData.value && typeof resultData.value === 'object' && resultData.value.type === 'word') {
    return resultData.value as WordResponse;
  }
  return null;
});

const currentTranslation = computed<LocalizedText | null>(() => {
  if (!resultData.value || typeof resultData.value === 'string' || !resultData.value.translations) return null;
  return resultData.value.translations[activeLang.value] || null;
});

const currentWordDetail = computed<WordDetail | null>(() => {
  return wordResult.value?.word_details?.[activeLang.value] || null;
});

const currentSenses = computed<WordSense[]>(() => {
  if (!wordResult.value) return [];
  const groupedSenses = Array.isArray(wordResult.value.pronunciation_groups)
    ? wordResult.value.pronunciation_groups.flatMap((group) => (Array.isArray(group.senses) ? group.senses : []))
    : [];
  const source = groupedSenses.length > 0 ? groupedSenses : wordResult.value.senses || [];
  return source.filter(
    (s: WordSense) => s?.localizations?.[activeLang.value]?.definition || s?.definitions?.[activeLang.value]
  );
});

const hasDictionarySenses = computed(() => {
  return resultData.value && typeof resultData.value === 'object' && resultData.value.provider === 'dictionary' && currentSenses.value.length > 0;
});

const headwordPhonetic = computed(() => {
  if (currentTranslation.value?.phonetic) {
    return currentTranslation.value.phonetic;
  }
  if (currentSenses.value.length > 0) {
    const first = currentSenses.value[0];
    const loc = first?.localizations?.[activeLang.value];
    return loc?.pronunciation || loc?.reading || '';
  }
  return '';
});

const headwordPhoneticSystem = computed(() => {
  if (currentSenses.value.length > 0) {
    const first = currentSenses.value[0];
    const loc = first?.localizations?.[activeLang.value];
    return loc?.pronunciation_system || loc?.reading_system || '';
  }
  return '';
});

const copyAllResult = () => {
  if (!resultData.value) return;
  if (typeof resultData.value === 'string') {
    copy(resultData.value, 'all-result');
    return;
  }
  const lines: string[] = [];
  if (currentWord.value) lines.push(currentWord.value);
  if (currentTranslation.value?.phonetic) lines.push(`[${currentTranslation.value.phonetic}]`);
  if (currentTranslation.value?.text && currentTranslation.value.text !== currentWord.value) {
    lines.push(currentTranslation.value.text);
  }
  if (currentSenses.value.length > 0) {
    currentSenses.value.forEach((s: WordSense) => {
      const def = s?.localizations?.[activeLang.value]?.definition || s?.definitions?.[activeLang.value] || '';
      const term = s?.localizations?.[activeLang.value]?.term || '';
      if (term && def) lines.push(`${s.sense_order}. ${term}: ${def}`);
      else if (def) lines.push(`${s.sense_order}. ${def}`);
    });
  } else if (currentWordDetail.value?.definition) {
    lines.push(currentWordDetail.value.definition);
  }
  copy(lines.join('\n'), 'all-result');
};

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isReportModalOpen.value) {
    isReportModalOpen.value = false;
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <section class="flex flex-col w-full relative z-0">
    <Transition mode="out-in" name="fade" @enter="updateIndicator">
      <!-- Result State -->
      <div
        v-if="resultData"
        class="bg-m3-surface-container rounded-[28px] p-5 sm:p-8 shadow-sm border border-m3-outline-variant/20 relative"
      >
        <div class="flex items-center justify-between w-full mb-6">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-m3-surface border border-m3-outline-variant/30 text-m3-on-surface-variant text-[0.72rem] font-bold shadow-xs">
            <span
              class="w-2 h-2 rounded-full shrink-0"
              :class="
                resultData.provider === 'dictionary'
                  ? 'bg-[#ff9800]'
                  : (resultData.cache_hit ?? resultData.cached)
                    ? 'bg-m3-primary'
                    : 'bg-[#008053]'
              "
            ></span>
            <span class="tracking-wide">
              {{
                resultData.provider === 'dictionary'
                  ? '核心词典'
                  : (resultData.cache_hit ?? resultData.cached)
                    ? '已缓存'
                    : 'AI'
              }}
            </span>
            <span class="text-[0.68rem] opacity-70 font-medium border-l border-m3-outline-variant/40 pl-2">
              {{
                resultData.provider === 'dictionary'
                  ? 'Dicionário'
                  : (resultData.cache_hit ?? resultData.cached)
                    ? 'Cache'
                    : (resultData.model || resultData.provider)
              }}
            </span>
            <Loader2
              v-if="
                isTranslating &&
                resultData.provider !== 'dictionary' &&
                !(resultData.cache_hit ?? resultData.cached)
              "
              class="w-3.5 h-3.5 animate-spin text-m3-primary ml-0.5 shrink-0"
            />
          </div>

          <div class="flex gap-2 items-center shrink-0">
            <button
              type="button"
              class="w-9 h-9 inline-flex items-center justify-center bg-transparent hover:bg-m3-surface-variant/50 rounded-full text-m3-on-surface-variant transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-m3-primary"
              @click="copyAllResult"
              :aria-label="isCopied('all-result') ? '已复制结果' : '复制翻译结果 / Copiar'"
              @title="isCopied('all-result') ? '已复制结果' : '复制翻译结果 / Copiar'"
            >
              <Transition name="m3-icon-swap" mode="out-in">
                <Check v-if="isCopied('all-result')" key="check" class="w-4.5 h-4.5 text-green-600 dark:text-green-400" />
                <Copy v-else key="copy" class="w-4.5 h-4.5" />
              </Transition>
            </button>
            <button
              v-if="currentWord && resultData?.type !== 'sentence'"
              type="button"
              class="w-9 h-9 inline-flex items-center justify-center rounded-full text-m3-on-surface-variant transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-m3-primary"
              :class="
                isBookmarked(currentWord)
                  ? 'text-m3-primary bg-m3-primary/10'
                  : 'bg-transparent hover:bg-m3-surface-variant/50'
              "
              @click="toggleBookmark(currentWord)"
              aria-label="收藏 / Favorito"
            >
              <Star class="w-5 h-5" :class="isBookmarked(currentWord) ? 'fill-current' : ''" />
            </button>
            <button
              v-if="currentWord"
              type="button"
              class="w-9 h-9 inline-flex items-center justify-center bg-transparent hover:bg-m3-surface-variant/50 rounded-full text-m3-on-surface-variant transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-m3-primary"
              @click="isReportModalOpen = true"
              aria-label="报告翻译问题 / Reportar"
            >
              <Flag class="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        <!-- Language Selection Slider Tabs -->
        <div
          v-if="typeof resultData !== 'string' && resultData.translations"
          ref="tabContainerRef"
          class="custom-tabs-container relative bg-m3-surface border border-m3-outline-variant/30 rounded-[20px] p-[6px] w-full min-h-[48px] overflow-hidden flex"
        >
          <!-- Sliding Indicator -->
          <div
            class="absolute top-[6px] bottom-[6px] bg-m3-primary rounded-[14px] shadow-sm transition-all duration-500 ease-spring pointer-events-none z-0"
            :style="indicatorStyle"
          ></div>

          <div class="custom-tabs-content z-10 w-full grid grid-cols-4 gap-0">
            <button
              v-for="(lang, i) in langs"
              :key="lang.code"
              @click="selectLang(i, lang.code)"
              class="custom-tab-btn w-full px-4 py-2.5 rounded-[14px] text-sm font-bold tracking-wide uppercase transition-all duration-300 select-none outline-none text-center cursor-pointer flex items-center justify-center"
              :class="
                activeLang === lang.code
                  ? '!text-m3-on-primary'
                  : '!text-m3-on-surface-variant/75 hover:!text-m3-on-surface'
              "
            >
              {{ lang.label }}
            </button>
          </div>
        </div>

        <!-- Translation Main Result -->
        <div class="mt-6 flex flex-col">
          <!-- Header Text / Query Word with Phonetics -->
          <div class="flex flex-wrap items-center gap-3 mb-4" v-if="currentWord">
            <h1
              class="text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] font-display font-black text-m3-on-surface tracking-tight break-words"
            >
              <FuriganaText :text="currentWord" />
            </h1>
            <button
              v-if="headwordPhonetic"
              @click="speak(currentTranslation?.audio_text || currentWord, activeLang)"
              class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-primary/10 text-m3-primary text-[0.85rem] font-bold tracking-wide hover:bg-m3-primary hover:text-m3-on-primary transition-all shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-m3-primary active:scale-95"
              title="朗读发音 / Pronunciar"
              aria-label="朗读发音"
            >
              <Volume2 class="w-3.5 h-3.5 opacity-80" />
              {{ headwordPhonetic }}
              <span v-if="headwordPhoneticSystem" class="text-[0.58rem] uppercase tracking-widest opacity-70">
                {{ headwordPhoneticSystem }}
              </span>
            </button>
            <div class="flex items-center gap-1 shrink-0 ml-auto">
              <button
                v-if="!headwordPhonetic"
                @click="speak(currentWord, activeLang)"
                class="inline-flex items-center justify-center w-9 h-9 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                title="朗读词条 / Pronunciar"
                aria-label="朗读词条"
              >
                <Volume2 class="w-5 h-5 opacity-80" />
              </button>
              <button
                @click="copy(currentWord, 'main-word')"
                class="inline-flex items-center justify-center w-9 h-9 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
                :title="isCopied('main-word') ? '已复制' : '复制词条'"
                :aria-label="isCopied('main-word') ? '已复制' : '复制词条'"
              >
                <Transition name="m3-icon-swap" mode="out-in">
                  <Check v-if="isCopied('main-word')" key="check" class="w-5 h-5 text-green-600 dark:text-green-400" />
                  <Copy v-else key="copy" class="w-5 h-5 opacity-80" />
                </Transition>
              </button>
            </div>
          </div>

          <!-- Content Area Component Routing -->
          <Transition :name="transitionName" mode="out-in">
            <component
              :is="resultData.type === 'sentence' ? SentenceResultView : WordResultView"
              :key="activeLang"
              :result-data="resultData"
              :active-lang="activeLang"
              :langs="langs"
            />
          </Transition>
        </div>
      </div>

      <!-- Waiting / Loading State -->
      <ResultLoader v-else :is-translating="isTranslating" :color-scheme="colorScheme" />
    </Transition>

    <!-- Feedback / Error Report Dialog -->
    <FeedbackModal
      :is-open="isReportModalOpen"
      :term="currentWord"
      :active-lang="activeLang"
      @close="isReportModalOpen = false"
    />
  </section>
</template>

<style scoped>
.fade-enter-active {
  transition:
    opacity 280ms var(--m3-ease-emphasized-decelerate),
    transform 280ms var(--m3-ease-emphasized-decelerate);
}
.fade-leave-active {
  transition:
    opacity 160ms var(--m3-ease-emphasized-accelerate),
    transform 160ms var(--m3-ease-emphasized-accelerate);
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.985);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.99);
}

/* Tab Slide Transitions */
.slide-left-enter-active,
.slide-right-enter-active {
  transition:
    opacity 240ms var(--m3-ease-emphasized-decelerate),
    transform 240ms var(--m3-ease-emphasized-decelerate);
}
.slide-left-leave-active,
.slide-right-leave-active {
  transition:
    opacity 140ms var(--m3-ease-emphasized-accelerate),
    transform 140ms var(--m3-ease-emphasized-accelerate);
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(12px) scale(0.99);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-12px) scale(0.99);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-12px) scale(0.99);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(12px) scale(0.99);
}
</style>
