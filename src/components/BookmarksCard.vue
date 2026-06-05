<script setup lang="ts">
import { useBookmarks } from '../composables/useBookmarks';
import { useTranslation } from '../composables/useTranslation';
import { Bookmark, Trash2, ArrowRight, X } from 'lucide-vue-next';

const { bookmarks, isBookmarksOpen, removeBookmark, clearBookmarks } = useBookmarks();
const { inputText, translate } = useTranslation();

const loadWord = (word: string) => {
  inputText.value = word;
  translate();
  isBookmarksOpen.value = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div 
        v-if="isBookmarksOpen" 
        class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity"
        @click="isBookmarksOpen = false"
      ></div>
    </Transition>

    <Transition name="slide-right">
      <aside 
        v-if="isBookmarksOpen" 
        class="fixed top-0 right-0 z-50 h-full w-[400px] max-w-[90vw] bg-m3-surface-container-high shadow-2xl flex flex-col p-6 overflow-y-auto"
      >
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center gap-2">
            <Bookmark class="w-5 h-5 text-m3-primary" />
            <h2 class="text-lg font-bold font-display text-m3-on-surface">生词本 / Caderno</h2>
          </div>
          <div class="flex items-center gap-2">
            <button 
              v-if="bookmarks.length > 0"
              @click="clearBookmarks"
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[0.8rem] font-bold text-m3-error hover:bg-m3-error/10 transition-colors outline-none"
            >
              <Trash2 class="w-4 h-4" /> 清空 / Limpar
            </button>
            <button 
              @click="isBookmarksOpen = false"
              class="w-10 h-10 rounded-full bg-transparent hover:bg-m3-surface-container-highest flex items-center justify-center text-m3-on-surface-variant transition-colors outline-none"
            >
              <X class="w-5 h-5" />
            </button>
          </div>
        </div>

        <div v-if="bookmarks.length === 0" class="flex-1 flex flex-col items-center justify-center py-12 text-center opacity-70">
          <Bookmark class="w-12 h-12 text-m3-outline-variant mb-4" />
          <p class="text-m3-on-surface-variant text-sm text-center">
          还没有收藏任何单词<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Nenhuma palavra salva</span>
          <br/><br/>
          点击结果旁的星标加入生词本<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Clique na estrela ao lado para salvar</span>
        </p>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div 
            v-for="word in bookmarks" 
            :key="word"
            class="flex items-center justify-between group bg-m3-surface hover:bg-m3-surface-container-highest rounded-[20px] p-3 pl-4 border border-m3-outline-variant/10 shadow-sm transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5"
            @click="loadWord(word)"
          >
            <div class="flex items-center gap-3 overflow-hidden flex-1">
              <span class="text-m3-on-surface font-display font-bold text-lg truncate">{{ word }}</span>
            </div>
            <div class="flex items-center gap-1">
              <button 
                @click.stop="removeBookmark(word)"
                class="flex items-center justify-center w-10 h-10 rounded-full text-m3-outline-variant hover:text-m3-error hover:bg-m3-error/10 transition-colors shrink-0"
                aria-label="移除收藏 / Remover"
              >
                <Trash2 class="w-4 h-4" />
              </button>
              <ArrowRight class="w-5 h-5 text-m3-outline-variant/50 group-hover:text-m3-primary transition-colors shrink-0" />
            </div>
          </div>
        </div>
      </aside>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-right-enter-active,
.slide-right-leave-active {
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(100%);
}
</style>
