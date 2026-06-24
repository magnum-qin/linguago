<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from './composables/useTheme';
import { useTranslation } from './composables/useTranslation';
import TranslatorCard from './components/TranslatorCard.vue';
import ResultCard from './components/ResultCard.vue';
import BookmarksCard from './components/BookmarksCard.vue';
import HistoryCard from './components/HistoryCard.vue';
import SettingsOverlay from './components/SettingsOverlay.vue';

const { currentTheme } = useTheme();
const { resultData, isTranslating } = useTranslation();

const hasResult = computed(() => !!resultData.value || isTranslating.value);

</script>

<template>
  <v-app class="!bg-transparent !font-sans transition-colors duration-300">
    <div class="min-h-dvh flex flex-col items-center w-full relative">
      <!-- Animated spacer for vertical centering -->
      <div 
        class="w-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0" 
        :style="{ height: hasResult ? 'env(safe-area-inset-top, 24px)' : '12vh' }"
      ></div>
      
      <main class="w-full max-w-[720px] mx-auto px-2 sm:px-6 md:px-8 pb-12 flex flex-col relative transition-all duration-700 gap-4">
        <TranslatorCard />
        <ResultCard />
        <BookmarksCard />
        <HistoryCard />
      </main>
    </div>
    
    <SettingsOverlay />
  </v-app>
</template>
