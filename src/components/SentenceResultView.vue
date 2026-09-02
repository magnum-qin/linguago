<script setup lang="ts">
import { computed } from 'vue';
import { Volume2, Copy, Check } from 'lucide-vue-next';
import FuriganaText from './FuriganaText.vue';
import { speak } from '../utils/speech';
import { useCopy } from '../composables/useCopy';

const props = defineProps<{
  resultData: any;
  activeLang: string;
}>();

const { copy, isCopied } = useCopy();

const currentExplanation = computed(() => {
  if (!props.resultData) return '';
  if (props.resultData.type !== 'sentence') return '';
  return props.resultData.explanations?.[props.activeLang] || props.resultData.explanation || '';
});
</script>

<template>
  <div class="flex flex-col w-full">
    <!-- Simple Text Fallback -->
    <div
      v-if="typeof resultData === 'string'"
      class="bg-m3-surface-container rounded-[28px] p-6 text-m3-on-surface font-medium mt-6 flex items-center justify-between gap-3"
    >
      <span>{{ resultData }}</span>
      <button
        @click="copy(resultData, 'raw-result')"
        class="inline-flex items-center justify-center w-8 h-8 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors shrink-0"
        :title="isCopied('raw-result') ? '已复制' : '复制结果'"
        :aria-label="isCopied('raw-result') ? '已复制' : '复制结果'"
      >
        <Check v-if="isCopied('raw-result')" class="w-4 h-4 text-green-600 dark:text-green-400" />
        <Copy v-else class="w-4 h-4 opacity-80" />
      </button>
    </div>

    <!-- Sentence Explanation -->
    <div v-if="currentExplanation" class="flex flex-col pt-3 pb-6 mt-2">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div class="flex items-center gap-2">
          <span class="w-1.5 h-3.5 rounded-full bg-m3-primary"></span>
          <h4 class="text-[0.82rem] font-bold text-m3-on-surface tracking-wide flex items-center gap-2">
            句意解析
            <span class="px-2 py-0.5 rounded-full bg-m3-primary/10 text-m3-primary text-[0.65rem] font-semibold tracking-normal uppercase">
              Explicação
            </span>
          </h4>
        </div>
        <div class="flex items-center gap-1">
          <button
            @click="speak(currentExplanation, activeLang)"
            class="inline-flex items-center justify-center w-8 h-8 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
            title="朗读句意解析 / Pronunciar"
            aria-label="朗读句意解析"
          >
            <Volume2 class="w-4 h-4 opacity-80" />
          </button>
          <button
            @click="copy(currentExplanation, 'sentence-explanation')"
            class="inline-flex items-center justify-center w-8 h-8 rounded-full text-m3-on-surface-variant hover:text-m3-primary hover:bg-m3-primary/10 transition-colors"
            :title="isCopied('sentence-explanation') ? '已复制' : '复制解析'"
            :aria-label="isCopied('sentence-explanation') ? '已复制' : '复制解析'"
          >
            <Check v-if="isCopied('sentence-explanation')" class="w-4 h-4 text-green-600 dark:text-green-400" />
            <Copy v-else class="w-4 h-4 opacity-80" />
          </button>
        </div>
      </div>
      <div class="bg-m3-surface-container rounded-[22px] p-5 border border-m3-outline-variant/15 shadow-inner">
        <p class="text-m3-on-surface text-[1rem] leading-relaxed whitespace-pre-line font-medium">
          <FuriganaText :text="currentExplanation" />
        </p>
      </div>
    </div>
  </div>
</template>
