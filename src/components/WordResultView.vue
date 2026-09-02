<script setup lang="ts">
import { Volume2, Copy, Check } from 'lucide-vue-next';
import FuriganaText from './FuriganaText.vue';
import { speak } from '@/utils/speech';
import { useCopy } from '@/composables/useCopy';
import { useDictionaryEntry } from '@/composables/useDictionaryEntry';
import { splitTranslations } from '@/utils/text-utils';
import type { TranslateResponse } from '@/types/translation';

const {
  resultData,
  activeLang,
  langs = []
} = defineProps<{
  resultData: TranslateResponse | string | null;
  activeLang: string;
  langs?: Array<{ code: string; label: string }>;
}>();

const { copy, isCopied } = useCopy();

const {
  currentWord,
  currentSenses,
  currentSenseGroups,
  hasDictionarySenses,
  showSenseGroups,
  currentExamples,
  hasSenseScopedExamples,
  currentExampleHighlightTerms,
  senseDefinition,
  senseTerm,
  shouldShowSenseTerm,
  senseReading,
  sensePronunciation,
  senseKey,
  formatSenseCopyText,
  formatExampleCopyText,
  senseExamples,
  exampleTranslation,
  shouldShowExampleTranslation,
  senseExampleHighlightTerms
} = useDictionaryEntry(
  () => resultData,
  () => activeLang
);

const splitDefinitions = (text: string) => {
  return splitTranslations(text);
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
            <div class="flex gap-3.5 items-start">
              <span
                class="flex items-center justify-center w-7 h-7 rounded-lg bg-m3-primary/10 text-m3-primary text-[0.88rem] font-black shrink-0"
                >{{ sense.sense_order }}</span
              >
              <div class="flex flex-col gap-1.5 w-full">
                <div v-if="sense.part_of_speech" class="flex flex-wrap items-center gap-2">
                  <span
                    class="px-2 py-0.5 rounded-[6px] bg-m3-surface-variant/60 text-m3-on-surface-variant text-[0.65rem] font-bold uppercase tracking-widest"
                    >{{ sense.part_of_speech }}</span
                  >
                </div>
                <div
                  v-if="shouldShowSenseTerm(sense)"
                  class="flex flex-wrap items-center gap-2.5 mb-1"
                >
                  <span class="text-m3-on-surface text-[1.25rem] sm:text-[1.45rem] font-black leading-tight">
                    <FuriganaText :text="senseTerm(sense, activeLang)" />
                  </span>
                  <button
                    v-if="sensePronunciation(sense, activeLang).label"
                    @click="speak(senseTerm(sense, activeLang), activeLang)"
                    class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-m3-primary/10 text-m3-primary text-[0.8rem] font-bold tracking-wide hover:bg-m3-primary hover:text-m3-on-primary transition-all shadow-xs"
                    title="朗读发音 / Pronunciar"
                    aria-label="朗读发音"
                  >
                    <Volume2 class="w-3.5 h-3.5 opacity-80" />
                    {{ sensePronunciation(sense, activeLang).label }}
                    <span
                      v-if="sensePronunciation(sense, activeLang).system"
                      class="text-[0.58rem] uppercase tracking-widest opacity-70"
                      >{{ sensePronunciation(sense, activeLang).system }}</span
                    >
                  </button>
                </div>
                <div class="flex items-start justify-between gap-3">
                  <div
                    v-if="splitDefinitions(senseDefinition(sense, activeLang)).length > 1"
                    class="flex flex-col gap-1.5 flex-1"
                  >
                    <div
                      v-for="(defItem, dIdx) in splitDefinitions(senseDefinition(sense, activeLang))"
                      :key="dIdx"
                      class="flex items-start gap-2 text-m3-on-surface text-[1.02rem] sm:text-[1.12rem] font-medium leading-relaxed"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/70 shrink-0 mt-2.5"></span>
                      <span class="flex-1">
                        <FuriganaText :text="defItem" />
                      </span>
                    </div>
                  </div>
                  <p v-else class="text-m3-on-surface text-[1.05rem] sm:text-[1.18rem] font-medium leading-relaxed flex-1">
                    <FuriganaText :text="senseDefinition(sense, activeLang)" />
                  </p>
                  <button
                    @click="copy(formatSenseCopyText(sense), `sense-${senseKey(sense)}`)"
                    class="inline-flex items-center justify-center w-7 h-7 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors shrink-0 mt-0.5"
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
