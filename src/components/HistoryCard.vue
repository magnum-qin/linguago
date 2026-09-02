<script setup lang="ts">
import { ArrowRight, History, Trash2, X } from 'lucide-vue-next';
import M3DrawerShell from '@/components/M3DrawerShell.vue';
import { useHistory } from '@/composables/useHistory';
import { useTranslation } from '@/composables/useTranslation';

const { historyItems, isHistoryOpen, removeHistory, clearHistory } = useHistory();
const { inputText, translate } = useTranslation();

const loadHistory = (text: string) => {
  inputText.value = text;
  translate();
  isHistoryOpen.value = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};
</script>

<template>
  <M3DrawerShell
    v-model="isHistoryOpen"
    title="搜索历史 / Histórico"
    title-id="history-drawer-title"
    close-label="关闭搜索历史 / Fechar histórico"
  >
    <template #icon>
      <History class="h-5 w-5 shrink-0 text-m3-primary" aria-hidden="true" />
    </template>

    <Transition name="m3-fade-scale" mode="out-in">
      <div v-if="historyItems.length === 0" key="empty" class="drawer-empty-state">
        <History class="mb-4 h-12 w-12 text-m3-outline-variant/60" aria-hidden="true" />
        <p class="text-sm font-medium text-m3-on-surface-variant">
          还没有搜索记录<br />
          <span class="mt-0.5 inline-block text-[0.8rem] text-m3-outline">Nenhuma busca recente</span>
        </p>
      </div>

      <div v-else key="list" class="drawer-list relative">
        <div class="flex justify-end">
          <button type="button" class="drawer-clear-button" @click="clearHistory">
            <X class="h-3.5 w-3.5" aria-hidden="true" />清空 / Limpar
          </button>
        </div>

        <TransitionGroup tag="div" name="m3-list" class="relative">
          <article
            v-for="item in historyItems"
            :key="`${item.text}-${item.createdAt}`"
            class="drawer-item"
            tabindex="0"
            role="button"
            @click="loadHistory(item.text)"
            @keydown.enter="loadHistory(item.text)"
            @keydown.space.prevent="loadHistory(item.text)"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate text-lg font-bold text-m3-on-surface">{{ item.text }}</div>
              <div class="truncate text-xs font-semibold text-m3-outline">{{ formatTime(item.createdAt) }}</div>
            </div>
            <button
              type="button"
              class="drawer-item-action"
              :aria-label="`移除历史 ${item.text} / Remover ${item.text}`"
              @click.stop="removeHistory(item.text)"
            >
              <Trash2 class="h-4 w-4" aria-hidden="true" />
            </button>
            <ArrowRight class="h-5 w-5 shrink-0 text-m3-outline-variant/60" aria-hidden="true" />
          </article>
        </TransitionGroup>
      </div>
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

.drawer-clear-button {
  min-height: 40px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 14px;
  color: var(--color-m3-on-surface-variant);
  font-size: 0.75rem;
  font-weight: 800;
}

.drawer-clear-button:hover {
  color: var(--color-m3-error);
  background: color-mix(in srgb, var(--color-m3-error) 10%, transparent);
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
.drawer-clear-button:focus-visible,
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
