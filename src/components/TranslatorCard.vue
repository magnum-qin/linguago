<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed, useTemplateRef } from 'vue';
import { Sun, Moon, SunMoon, Settings, X, Languages, Bookmark, Clipboard, History, Square } from 'lucide-vue-next';
import { useTheme } from '@/composables/useTheme';
import { useTranslation } from '@/composables/useTranslation';
import { useBookmarks } from '@/composables/useBookmarks';
import { useHistory } from '@/composables/useHistory';
import { detectSourceLanguage } from '@/utils/detect-source-language';

const { currentTheme, resolvedTheme, toggleTheme } = useTheme();
const { inputText, sourceLangPreference, translate, stopTranslation, clear, resultData, isTranslating } =
  useTranslation();
const { isBookmarksOpen } = useBookmarks();
const { isHistoryOpen } = useHistory();

const hasResult = computed(() => !!resultData.value || isTranslating.value);

const textareaRef = useTemplateRef<HTMLTextAreaElement>('textareaRef');
type SourceLanguage = 'zh' | 'ja' | 'en' | 'pt-BR';

const lastDetectedSourceLanguage = ref<SourceLanguage | 'hidden'>('hidden');
const isComposingText = ref(false);

const sourceLabels: Record<SourceLanguage, string> = {
  zh: '中',
  ja: '日',
  en: 'EN',
  'pt-BR': 'PT'
};

const sourceNames: Record<SourceLanguage, string> = {
  zh: 'Chinese',
  ja: 'Japanese',
  en: 'English',
  'pt-BR': 'Portuguese'
};

const detectedSourceLanguage = computed(() => detectSourceLanguage(inputText.value));
const sourceToggleVisible = computed(() => detectedSourceLanguage.value !== 'hidden');
const sourceToggleLabel = computed(() =>
  sourceLangPreference.value === 'auto' ? '' : sourceLabels[sourceLangPreference.value]
);
const sourceToggleAriaLabel = computed(() => {
  if (sourceLangPreference.value === 'auto') return 'Detected source language';
  return `${sourceNames[sourceLangPreference.value]} source. Click to switch.`;
});

const themeToggleAriaLabel = computed(() => {
  if (currentTheme.value === 'system') {
    return `外观：跟随系统 (${resolvedTheme.value === 'dark' ? '深色' : '浅色'}) | Aparência: Seguir sistema`;
  }
  return currentTheme.value === 'dark'
    ? '外观：深色模式 | Aparência: Modo escuro'
    : '外观：浅色模式 | Aparência: Modo claro';
});

const autoResize = () => {
  if (!textareaRef.value) return;
  const el = textareaRef.value;

  // Use a hidden clone to calculate true scrollHeight without causing page reflow/jumping
  const clone = el.cloneNode() as HTMLTextAreaElement;
  clone.value = el.value;
  clone.style.width = `${el.getBoundingClientRect().width}px`;
  clone.style.height = '1px';
  clone.style.position = 'absolute';
  clone.style.top = '-9999px';
  clone.style.visibility = 'hidden';
  clone.style.overflow = 'hidden';
  document.body.appendChild(clone);

  const targetHeight = clone.scrollHeight;
  document.body.removeChild(clone);

  const currentHeight = el.style.height || '56px';
  if (currentHeight === `${targetHeight}px`) return;

  el.style.transition = 'height 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)';
  el.style.height = `${targetHeight}px`;
  el.style.overflowY = 'hidden';
};

watch(inputText, async (value) => {
  const detected = detectSourceLanguage(value);
  if (detected !== lastDetectedSourceLanguage.value) {
    sourceLangPreference.value = detected === 'hidden' ? 'auto' : detected;
    lastDetectedSourceLanguage.value = detected;
  }

  await nextTick();
  autoResize();
});

const handleGlobalKeydown = (e: KeyboardEvent) => {
  // Ignore if user is already typing in an input/textarea
  if (
    e.target instanceof HTMLInputElement ||
    e.target instanceof HTMLTextAreaElement ||
    (e.target as HTMLElement).isContentEditable
  )
    return;

  if (e.key === '/' || e.code === 'Slash' || e.key === '、') {
    e.preventDefault();
    textareaRef.value?.focus();
  }
};

onMounted(() => {
  autoResize();
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

const openSettings = () => {
  window.dispatchEvent(new CustomEvent('open-settings'));
};

const handlePaste = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    inputText.value = text;
    await nextTick();
    autoResize();
    textareaRef.value?.focus();
  } catch (e) {
    console.error('Failed to read clipboard', e);
    textareaRef.value?.focus();
  }
};

const toggleSourceLang = async () => {
  if (!sourceToggleVisible.value) return;
  if (sourceLangPreference.value === 'zh' || sourceLangPreference.value === 'ja') {
    sourceLangPreference.value = sourceLangPreference.value === 'ja' ? 'zh' : 'ja';
  } else {
    sourceLangPreference.value = sourceLangPreference.value === 'pt-BR' ? 'en' : 'pt-BR';
  }
  if (inputText.value.trim() && hasResult.value && !isTranslating.value) {
    await translate();
  }
};

const handleClear = () => {
  if (window.scrollY > 0) {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  clear();
  requestAnimationFrame(() => {
    textareaRef.value?.focus({ preventScroll: true });
  });
};

const usesMobileKeyboard = () => {
  return window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
};

const handleTranslate = async () => {
  if (!inputText.value.trim() || isTranslating.value) return;

  const translation = translate();
  if (usesMobileKeyboard()) {
    textareaRef.value?.blur();
  }
  await translation;
};

const handlePrimaryAction = () => {
  if (isTranslating.value) {
    stopTranslation();
    return;
  }
  handleTranslate();
};

const handleTextareaKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    handleClear();
    return;
  }

  if (e.key !== 'Enter') return;
  if (e.isComposing || isComposingText.value || e.keyCode === 229) return;

  e.preventDefault();
  handleTranslate();
};
</script>

<template>
  <section class="flex flex-col gap-3 enter">
    <div class="flex items-center justify-between gap-2 px-1 mb-1 min-h-10">
      <Transition name="m3-fade-scale">
        <button
          v-if="sourceToggleVisible"
          type="button"
          class="h-10 min-w-10 rounded-full px-4 text-[0.9rem] font-bold text-m3-on-primary bg-m3-primary hover:opacity-90 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-m3-primary tracking-normal normal-case inline-flex items-center justify-center cursor-pointer"
          @click="toggleSourceLang"
          :aria-label="sourceToggleAriaLabel"
        >
          {{ sourceToggleLabel }}
        </button>
      </Transition>

      <div class="flex items-center justify-end gap-2 ml-auto">
        <button
          type="button"
          class="w-10 h-10 rounded-full inline-flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors cursor-pointer"
          @click="handlePaste"
          aria-label="Paste"
        >
          <Clipboard class="w-5 h-5" />
        </button>

        <button
          type="button"
          class="w-10 h-10 rounded-full inline-flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors cursor-pointer"
          :aria-label="themeToggleAriaLabel"
          :title="themeToggleAriaLabel"
          @click="toggleTheme"
        >
          <Transition name="m3-icon-swap" mode="out-in">
            <SunMoon v-if="currentTheme === 'system'" key="system" class="w-5 h-5" />
            <Sun v-else-if="currentTheme === 'light'" key="light" class="w-5 h-5" />
            <Moon v-else key="dark" class="w-5 h-5" />
          </Transition>
        </button>

        <button
          type="button"
          class="w-10 h-10 rounded-full inline-flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors cursor-pointer"
          @click="isHistoryOpen = true"
          aria-label="Search History"
        >
          <History class="w-5 h-5" />
        </button>

        <button
          type="button"
          class="w-10 h-10 rounded-full inline-flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors cursor-pointer"
          @click="isBookmarksOpen = true"
          aria-label="Bookmarks"
        >
          <Bookmark class="w-5 h-5" />
        </button>

        <button
          type="button"
          class="w-10 h-10 rounded-full inline-flex items-center justify-center text-m3-on-surface-variant hover:bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary transition-colors cursor-pointer"
          @click="openSettings"
          aria-label="Settings"
        >
          <Settings class="w-5 h-5" />
        </button>
      </div>
    </div>

    <div
      class="bg-m3-surface-container rounded-[28px] p-4 sm:p-5 flex flex-col gap-4 shadow-sm transition-all focus-within:shadow-md focus-within:bg-m3-surface-container-high border border-m3-outline-variant/20 relative z-10"
    >
      <textarea
        ref="textareaRef"
        v-model="inputText"
        rows="1"
        autocomplete="off"
        enterkeyhint="go"
        :placeholder="'单词或句子...\nPalavra ou frase...'"
        class="w-full resize-none border-0 outline-none !outline-none !ring-0 !shadow-none focus:!outline-none focus:!ring-0 focus:!shadow-none focus-visible:!outline-none focus-visible:!ring-0 focus-visible:!shadow-none min-h-[56px] bg-transparent text-m3-on-surface !text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] placeholder:text-m3-on-surface-variant/50 overflow-hidden font-display font-medium"
        @keydown="handleTextareaKeydown"
        @compositionstart="isComposingText = true"
        @compositionend="isComposingText = false"
        @input="autoResize"
      ></textarea>

      <div class="flex items-center relative min-h-[44px] mt-3 w-full">
        <Transition name="m3-fade-scale">
          <button
            v-if="inputText.length > 0"
            data-testid="clear-button"
            aria-label="清空 | Limpar"
            type="button"
            class="h-11 flex items-center justify-center rounded-full px-4 sm:px-5 text-[0.85rem] font-bold text-m3-on-surface bg-m3-surface shadow-sm border border-m3-outline-variant/30 hover:bg-m3-surface-container-high transition-all outline-none focus-visible:ring-2 focus-visible:ring-m3-primary absolute left-0 z-10 whitespace-nowrap tracking-normal normal-case cursor-pointer"
            @click="handleClear"
          >
            <X class="w-3.5 h-3.5 mr-1.5 shrink-0" />
            <span class="font-bold">清空</span>
            <span class="text-[0.72rem] opacity-65 font-normal border-l border-m3-outline-variant/50 pl-1.5 ml-1.5 inline-flex items-center">Limpar</span>
          </button>
        </Transition>

        <button
          data-testid="translation-action"
          type="button"
          class="h-11 flex items-center justify-center rounded-[28px] rounded-br-sm px-5 sm:px-6 text-[0.85rem] font-bold text-m3-on-primary hover:opacity-90 transition-colors disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-m3-surface-container focus-visible:ring-m3-primary ml-auto z-10 relative shrink-0 whitespace-nowrap tracking-normal normal-case cursor-pointer"
          :class="isTranslating ? 'bg-[#BA1A1A]' : 'bg-m3-primary'"
          :aria-label="isTranslating ? '中止翻译 | Parar tradução' : '翻译 | Traduzir'"
          @click="handlePrimaryAction"
          :disabled="!isTranslating && !inputText.trim()"
        >
          <Transition name="m3-icon-swap" mode="out-in">
            <span v-if="isTranslating" key="stop" class="inline-flex items-center">
              <Square class="w-3.5 h-3.5 mr-1.5 fill-current shrink-0" />
              <span class="font-bold">中止</span>
              <span class="text-[0.72rem] opacity-75 font-normal border-l border-current/30 pl-1.5 ml-1.5 inline-flex items-center">Parar</span>
            </span>
            <span v-else key="translate" class="inline-flex items-center">
              <Languages class="w-3.5 h-3.5 mr-1.5 shrink-0" />
              <span class="font-bold">翻译</span>
              <span class="text-[0.72rem] opacity-75 font-normal border-l border-current/30 pl-1.5 ml-1.5 inline-flex items-center">Traduzir</span>
            </span>
          </Transition>
        </button>
      </div>
    </div>
  </section>
</template>
