<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed } from 'vue';
import { Sun, Moon, Settings, X, Languages, Bookmark } from 'lucide-vue-next';
import { useTheme } from '../composables/useTheme';
import { useTranslation } from '../composables/useTranslation';
import { useBookmarks } from '../composables/useBookmarks';

const { currentTheme, toggleTheme } = useTheme();
const { inputText, translate, clear, resultData, isTranslating } = useTranslation();
const { isBookmarksOpen } = useBookmarks();

const hasResult = computed(() => !!resultData.value || isTranslating.value);

const textareaRef = ref<HTMLTextAreaElement | null>(null);

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

watch(inputText, async () => {
  await nextTick();
  autoResize();
});

onMounted(() => {
  autoResize();
});

const openSettings = () => {
  window.dispatchEvent(new CustomEvent('open-settings'));
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
    <div class="flex items-center justify-end gap-2 px-1 mb-1">
      <button 
        class="flex h-10 w-10 items-center justify-center rounded-full text-m3-on-surface-variant bg-transparent hover:bg-m3-surface-container-high transition-colors focus-visible:ring-2 focus-visible:ring-m3-primary outline-none"
        @click="toggleTheme" 
        aria-label="Toggle Theme"
      >
        <Sun v-if="currentTheme === 'dark'" class="w-5 h-5" />
        <Moon v-else class="w-5 h-5" />
      </button>

      <button 
        class="flex h-10 w-10 items-center justify-center rounded-full text-m3-on-surface-variant bg-transparent hover:bg-m3-surface-container-high transition-colors focus-visible:ring-2 focus-visible:ring-m3-primary outline-none"
        @click="isBookmarksOpen = true" 
        aria-label="Bookmarks"
      >
        <Bookmark class="w-5 h-5" />
      </button>
      
      <button 
        class="flex h-10 w-10 items-center justify-center rounded-full text-m3-on-surface-variant bg-transparent hover:bg-m3-surface-container-high transition-colors focus-visible:ring-2 focus-visible:ring-m3-primary outline-none"
        @click="openSettings" 
        aria-label="Settings"
      >
        <Settings class="w-5 h-5" />
      </button>
    </div>

    <div class="bg-m3-surface-container rounded-[28px] p-4 sm:p-5 flex flex-col gap-4 shadow-sm transition-all focus-within:shadow-md focus-within:bg-m3-surface-container-high border border-m3-outline-variant/20 relative z-10">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        rows="1"
        autocomplete="off"
        :placeholder="'单词或句子...\nPalavra ou frase...'"
        class="w-full resize-none border-0 outline-none min-h-[56px] bg-transparent text-m3-on-surface text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] placeholder:text-m3-on-surface-variant/50 overflow-hidden font-display font-medium"
        @keydown.enter.prevent="handleTranslate"
        @input="autoResize"
      ></textarea>

      <div class="flex items-center relative min-h-[44px] mt-3 w-full">
        <Transition name="fade-up">
          <button 
            v-if="inputText.length > 0"
            class="flex h-11 items-center justify-center gap-1.5 rounded-full px-4 sm:px-5 text-[0.85rem] font-bold text-m3-on-surface bg-m3-surface shadow-sm border border-m3-outline-variant/30 hover:bg-m3-surface-container-high transition-all outline-none focus-visible:ring-2 focus-visible:ring-m3-primary absolute left-0 z-10 whitespace-nowrap" 
            @click="handleClear"
          >
            <X class="w-3.5 h-3.5" />清空 / Limpar
          </button>
        </Transition>
        
        <button 
          class="flex h-11 items-center justify-center gap-2 rounded-full px-5 sm:px-6 text-[0.85rem] font-bold text-m3-on-primary bg-m3-primary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-m3-surface-container focus-visible:ring-m3-primary ml-auto z-10 relative shrink-0 whitespace-nowrap"
          @click="handleTranslate"
          :disabled="!inputText.trim()"
        >
          <Languages class="w-3.5 h-3.5" />翻译 / Traduzir
        </button>
      </div>
    </div>
  </section>
</template>
