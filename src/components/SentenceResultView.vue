<script setup lang="ts">
import { computed } from 'vue';
import FuriganaText from './FuriganaText.vue';

const props = defineProps<{
  resultData: any;
  activeLang: string;
}>();

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
      class="bg-m3-surface-container rounded-[28px] p-6 text-m3-on-surface font-medium mt-6"
    >
      {{ resultData }}
    </div>

    <!-- Sentence Explanation -->
    <div v-if="currentExplanation" class="flex flex-col pt-3 pb-6 mt-2">
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
  </div>
</template>
