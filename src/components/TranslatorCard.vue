<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { Sun, Moon, Settings, X, Languages, Bookmark, Clipboard, History } from 'lucide-vue-next';
import { useTheme } from '../composables/useTheme';
import { useTranslation } from '../composables/useTranslation';
import { useBookmarks } from '../composables/useBookmarks';
import { useHistory } from '../composables/useHistory';

const { currentTheme, toggleTheme } = useTheme();
const { inputText, sourceLangPreference, translate, clear, resultData, isTranslating } = useTranslation();
const { isBookmarksOpen } = useBookmarks();
const { isHistoryOpen } = useHistory();

const hasResult = computed(() => !!resultData.value || isTranslating.value);

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const lastDetectedCjkMode = ref<'zh' | 'ja' | 'hidden'>('hidden');

const detectCjkMode = (text: string): 'zh' | 'ja' | 'hidden' => {
  const trimmed = text.trim();
  if (!trimmed) return 'hidden';
  if (/[\u3040-\u30ff]/u.test(trimmed)) return 'ja';

  const comparable = trimmed.replace(/[\s\p{P}\p{S}]/gu, '');
  if (!comparable) return 'hidden';
  return /^\p{Script=Han}+$/u.test(comparable) ? 'zh' : 'hidden';
};

const sourceToggleVisible = computed(() => detectCjkMode(inputText.value) !== 'hidden');
const sourceToggleLabel = computed(() => sourceLangPreference.value === 'ja' ? '日' : '中');

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
  const detected = detectCjkMode(value);
  if (detected !== lastDetectedCjkMode.value) {
    sourceLangPreference.value = detected === 'hidden' ? 'auto' : detected;
    lastDetectedCjkMode.value = detected;
  }

  await nextTick();
  autoResize();
});

const handleGlobalKeydown = (e: KeyboardEvent) => {
  // Ignore if user is already typing in an input/textarea
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) return;
  
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

const toggleSourceLang = () => {
  if (!sourceToggleVisible.value) return;
  sourceLangPreference.value = sourceLangPreference.value === 'ja' ? 'zh' : 'ja';
};

const handleClear = () => {
  clear();
  textareaRef.value?.focus();
};

const handleTranslate = () => {
  if (inputText.value.trim()) {
    textareaRef.value?.blur();
    translate();
  }
};
</script>

<template>
  <section class="flex flex-col gap-3 enter">
    <div class="flex items-center justify-between gap-2 px-1 mb-1 min-h-10">
      <Transition name="fade-up">
        <v-btn
          v-if="sourceToggleVisible"
          variant="flat"
          class="!h-10 !min-w-10 !rounded-full !px-4 !text-[0.9rem] !font-bold !text-m3-on-primary !bg-m3-primary hover:!opacity-90 transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-m3-primary !tracking-normal !normal-case"
          @click="toggleSourceLang"
          :aria-label="sourceLangPreference === 'ja' ? 'Japanese source' : 'Chinese source'"
        >
          {{ sourceToggleLabel }}
        </v-btn>
      </Transition>

      <div class="flex items-center justify-end gap-2 ml-auto">
        <v-btn
          icon
          variant="text"
          class="!w-10 !h-10 !text-m3-on-surface-variant hover:!bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary"
          @click="handlePaste"
          aria-label="Paste"
        >
          <Clipboard class="w-5 h-5" />
        </v-btn>

        <v-btn
          icon
          variant="text"
          class="!w-10 !h-10 !text-m3-on-surface-variant hover:!bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary"
          @click="toggleTheme"
          aria-label="Toggle Theme"
        >
          <Sun v-if="currentTheme === 'dark'" class="w-5 h-5" />
          <Moon v-else class="w-5 h-5" />
        </v-btn>

        <v-btn
          icon
          variant="text"
          class="!w-10 !h-10 !text-m3-on-surface-variant hover:!bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary"
          @click="isHistoryOpen = true"
          aria-label="Search History"
        >
          <History class="w-5 h-5" />
        </v-btn>

        <v-btn
          icon
          variant="text"
          class="!w-10 !h-10 !text-m3-on-surface-variant hover:!bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary"
          @click="isBookmarksOpen = true"
          aria-label="Bookmarks"
        >
          <Bookmark class="w-5 h-5" />
        </v-btn>

        <v-btn
          icon
          variant="text"
          class="!w-10 !h-10 !text-m3-on-surface-variant hover:!bg-m3-surface-container-high focus-visible:ring-2 focus-visible:ring-m3-primary"
          @click="openSettings"
          aria-label="Settings"
        >
          <Settings class="w-5 h-5" />
        </v-btn>
      </div>
    </div>

    <v-card elevation="0" class="!bg-m3-surface-container !rounded-[28px] !p-4 sm:!p-5 flex flex-col gap-4 !shadow-sm transition-all focus-within:!shadow-md focus-within:!bg-m3-surface-container-high !border !border-m3-outline-variant/20 relative z-10">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        rows="1"
        autocomplete="off"
        :placeholder="'单词或句子...\nPalavra ou frase...'"
        class="w-full resize-none border-0 outline-none min-h-[56px] bg-transparent text-m3-on-surface !text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] placeholder:text-m3-on-surface-variant/50 overflow-hidden font-display font-medium"
        @keydown.enter.prevent="handleTranslate"
        @keydown.esc.prevent="handleClear"
        @input="autoResize"
      ></textarea>

      <div class="flex items-center relative min-h-[44px] mt-3 w-full">
        <Transition name="fade-up">
          <v-btn 
            v-if="inputText.length > 0"
            variant="flat"
            class="!h-11 !flex !items-center !justify-center !rounded-full !px-4 sm:!px-5 !text-[0.85rem] !font-bold !text-m3-on-surface !bg-m3-surface !shadow-sm !border !border-m3-outline-variant/30 hover:!bg-m3-surface-container-high transition-all outline-none focus-visible:ring-2 focus-visible:ring-m3-primary absolute left-0 z-10 whitespace-nowrap !tracking-normal !normal-case" 
            @click="handleClear"
          >
            <X class="w-3.5 h-3.5 mr-1.5" />清空 / Limpar
          </v-btn>
        </Transition>
        
        <v-btn 
          variant="flat"
          class="!h-11 !flex !items-center !justify-center !rounded-[28px] !rounded-br-sm !px-5 sm:!px-6 !text-[0.85rem] !font-bold !text-m3-on-primary !bg-m3-primary hover:!opacity-90 transition-opacity disabled:!opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-m3-surface-container focus-visible:ring-m3-primary ml-auto z-10 relative shrink-0 whitespace-nowrap !tracking-normal !normal-case"
          @click="handleTranslate"
          :disabled="!inputText.trim()"
        >
          <Languages class="w-3.5 h-3.5 mr-2" />翻译 / Traduzir
        </v-btn>
      </div>
    </v-card>
  </section>
</template>
