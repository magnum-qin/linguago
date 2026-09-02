<script setup lang="ts">
import { ArrowRight, Bookmark, Trash2 } from 'lucide-vue-next';
import M3DrawerShell from '@/components/M3DrawerShell.vue';
import { useBookmarks } from '@/composables/useBookmarks';
import { useTranslation } from '@/composables/useTranslation';

const { bookmarks, isBookmarksOpen, removeBookmark } = useBookmarks();
const { inputText, translate } = useTranslation();

const loadWord = (word: string) => {
  inputText.value = word;
  translate();
  isBookmarksOpen.value = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
</script>

<template>
  <M3DrawerShell
    v-model="isBookmarksOpen"
    title="生词本 / Caderno"
    title-id="bookmarks-drawer-title"
    close-label="关闭生词本 / Fechar caderno"
  >
    <template #icon>
      <Bookmark class="h-5 w-5 shrink-0 text-m3-primary" aria-hidden="true" />
    </template>

    <Transition name="m3-fade-scale" mode="out-in">
      <div v-if="bookmarks.length === 0" key="empty" class="drawer-empty-state">
        <Bookmark class="mb-4 h-12 w-12 text-m3-outline-variant/60" aria-hidden="true" />
        <p class="text-sm font-medium text-m3-on-surface-variant">
          还没有收藏任何单词<br />
          <span class="mt-0.5 inline-block text-[0.8rem] text-m3-outline">Nenhuma palavra salva</span>
        </p>
        <p class="mt-5 text-xs leading-relaxed text-m3-outline">
          点击结果旁的星标加入生词本<br />Clique na estrela ao lado para salvar
        </p>
      </div>

      <TransitionGroup v-else key="list" tag="div" name="m3-list" class="drawer-list relative">
        <article
          v-for="word in bookmarks"
          :key="word"
          class="drawer-item"
          tabindex="0"
          role="button"
          @click="loadWord(word)"
          @keydown.enter="loadWord(word)"
          @keydown.space.prevent="loadWord(word)"
        >
          <span class="min-w-0 flex-1 truncate text-lg font-bold text-m3-on-surface">{{ word }}</span>
          <button
            type="button"
            class="drawer-item-action"
            :aria-label="`移除收藏 ${word} / Remover ${word}`"
            @click.stop="removeBookmark(word)"
          >
            <Trash2 class="h-4 w-4" aria-hidden="true" />
          </button>
          <ArrowRight class="h-5 w-5 shrink-0 text-m3-outline-variant/60" aria-hidden="true" />
        </article>
      </TransitionGroup>
    </Transition>
  </M3DrawerShell>
</template>

<style scoped>
.drawer-empty-state {
  min-height: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  text-align: center;
}

.drawer-list {
  display: grid;
  gap: 12px;
}

.drawer-item {
  min-height: 68px;
  padding: 10px 10px 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 18%, transparent);
  border-radius: 18px;
  background: var(--color-m3-surface-container);
  cursor: pointer;
  transition:
    background-color 150ms ease,
    box-shadow 150ms ease;
}

.drawer-item:hover {
  background: var(--color-m3-surface-container-high);
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.08);
}

.drawer-item:focus-visible,
.drawer-item-action:focus-visible {
  outline: 2px solid var(--color-m3-primary);
  outline-offset: 2px;
}

.drawer-item-action {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--color-m3-outline);
}

.drawer-item-action:hover {
  color: var(--color-m3-error);
  background: color-mix(in srgb, var(--color-m3-error) 10%, transparent);
}
</style>
