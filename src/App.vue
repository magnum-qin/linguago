<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useTheme } from './composables/useTheme';
import { useTranslation } from './composables/useTranslation';
import TranslatorCard from './components/TranslatorCard.vue';
import ResultCard from './components/ResultCard.vue';
import BookmarksCard from './components/BookmarksCard.vue';
import HistoryCard from './components/HistoryCard.vue';
import SettingsOverlay from './components/SettingsOverlay.vue';
import { Loader2, AlertTriangle } from 'lucide-vue-next';

const { currentTheme } = useTheme();
const { resultData, isTranslating } = useTranslation();

const hasResult = computed(() => !!resultData.value || isTranslating.value);

// PWA Update Banner State
const showUpdateBanner = ref(false);

const handleUpdateAvailable = () => {
  showUpdateBanner.value = true;
};

const handleUpdated = () => {
  showUpdateBanner.value = true;
  setTimeout(() => {
    window.location.reload();
  }, 1500);
};

// API Global Error Toast State
const showErrorBanner = ref(false);
const errorMessage = ref('');
let errorTimeout: ReturnType<typeof setTimeout> | null = null;

const handleApiError = (event: Event) => {
  const customEvent = event as CustomEvent<{ message: string }>;
  errorMessage.value = customEvent.detail.message;
  showErrorBanner.value = true;

  if (errorTimeout) clearTimeout(errorTimeout);
  errorTimeout = setTimeout(() => {
    showErrorBanner.value = false;
  }, 4000);
};

onMounted(() => {
  window.addEventListener('pwa-update-available', handleUpdateAvailable);
  window.addEventListener('pwa-updated', handleUpdated);
  window.addEventListener('api-error', handleApiError);
});

onUnmounted(() => {
  window.removeEventListener('pwa-update-available', handleUpdateAvailable);
  window.removeEventListener('pwa-updated', handleUpdated);
  window.removeEventListener('api-error', handleApiError);
});
</script>

<template>
  <v-app class="!bg-transparent !font-sans transition-colors duration-300">
    <div class="min-h-dvh flex flex-col items-center w-full relative">
      <!-- Animated spacer for vertical centering -->
      <div
        class="w-full transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0"
        :style="{ height: hasResult ? 'env(safe-area-inset-top, 24px)' : '12vh' }"
      ></div>

      <main
        class="w-full max-w-[720px] mx-auto px-2 sm:px-6 md:px-8 pb-12 flex flex-col relative transition-all duration-700 gap-4"
      >
        <TranslatorCard />
        <ResultCard />
        <BookmarksCard />
        <HistoryCard />
      </main>
    </div>

    <SettingsOverlay />

    <!-- PWA Floating Update Banner -->
    <Transition name="slide-y">
      <div
        v-if="showUpdateBanner"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-4 rounded-[24px] bg-m3-primary text-m3-on-primary shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-md"
      >
        <Loader2 class="w-5 h-5 animate-spin" />
        <div class="flex flex-col">
          <span class="text-sm font-bold tracking-wide">发现新版本，正在应用更新并重载...</span>
          <span class="text-[0.65rem] opacity-80 mt-0.5">Nova versão encontrada, atualizando...</span>
        </div>
      </div>
    </Transition>

    <!-- API Error Floating Banner -->
    <Transition name="slide-y">
      <div
        v-if="showErrorBanner"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] px-6 py-4 rounded-[24px] bg-[#BA1A1A] text-white shadow-2xl flex items-center gap-3 border border-white/10 backdrop-blur-md max-w-[90vw] w-max"
      >
        <AlertTriangle class="w-5 h-5 shrink-0" />
        <div class="flex flex-col">
          <span class="text-sm font-bold tracking-wide leading-snug">{{ errorMessage }}</span>
        </div>
      </div>
    </Transition>
  </v-app>
</template>

<style scoped>
/* Slide-Y Transition for update/error toast */
.slide-y-enter-active,
.slide-y-leave-active {
  transition:
    transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.4s ease;
}
.slide-y-enter-from,
.slide-y-leave-to {
  transform: translate(-50%, 20px) scale(0.95);
  opacity: 0;
}
.slide-y-enter-to,
.slide-y-leave-from {
  transform: translate(-50%, 0) scale(1);
  opacity: 1;
}
</style>
