<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { ArrowRight, History, Trash2, X } from 'lucide-vue-next';
import { useHistory } from '../composables/useHistory';
import { useTranslation } from '../composables/useTranslation';

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

const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isHistoryOpen.value) {
    isHistoryOpen.value = false;
  }
};

onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isHistoryOpen"
        class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity"
        @click="isHistoryOpen = false"
      ></div>
    </Transition>

    <Transition name="slide-right">
      <aside
        v-if="isHistoryOpen"
        class="fixed top-0 right-0 z-50 h-full w-[400px] max-w-[90vw] bg-m3-surface shadow-2xl flex flex-col p-6 overflow-y-auto"
      >
        <div class="flex items-center justify-between mb-4 pb-4 border-b border-m3-outline-variant/20">
          <div class="flex items-center gap-2">
            <History class="w-5 h-5 text-m3-primary" />
            <h2 class="text-lg font-bold font-display text-m3-on-surface">搜索历史 / Histórico</h2>
          </div>
          <button
            @click="isHistoryOpen = false"
            class="w-10 h-10 rounded-full bg-transparent hover:bg-m3-surface-container-highest flex items-center justify-center text-m3-on-surface-variant transition-colors outline-none"
            aria-label="关闭 / Fechar"
          >
            <ArrowRight class="w-5 h-5" />
          </button>
        </div>

        <div
          v-if="historyItems.length === 0"
          class="flex-1 flex flex-col items-center justify-center py-12 text-center"
        >
          <History class="w-12 h-12 text-m3-outline-variant/60 mb-4" />
          <p class="text-m3-on-surface-variant text-sm text-center font-medium">
            还没有搜索记录<br />
            <span class="text-[0.8rem] text-m3-outline mt-0.5 inline-block">Nenhuma busca recente</span>
          </p>
        </div>

        <div v-else class="flex flex-col gap-3">
          <div class="flex justify-end">
            <button
              @click="clearHistory"
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold text-m3-on-surface-variant hover:text-m3-error hover:bg-m3-error/10 transition-colors"
            >
              <X class="w-3.5 h-3.5" /> 清空 / Limpar
            </button>
          </div>

          <div
            v-for="item in historyItems"
            :key="`${item.text}-${item.createdAt}`"
            class="flex items-center justify-between group bg-m3-surface-container hover:bg-m3-surface-container-high rounded-[20px] p-3 pl-4 border border-m3-outline-variant/10 shadow-sm transition-all cursor-pointer hover:shadow-md hover:-translate-y-0.5"
            @click="loadHistory(item.text)"
          >
            <div class="flex flex-col gap-1 overflow-hidden flex-1">
              <span class="text-m3-on-surface font-display font-bold text-lg truncate">{{ item.text }}</span>
              <span class="text-xs font-semibold text-m3-outline truncate">
                {{ formatTime(item.createdAt) }}
              </span>
            </div>
            <div class="flex items-center gap-1">
              <button
                @click.stop="removeHistory(item.text)"
                class="flex items-center justify-center w-10 h-10 rounded-full text-m3-outline-variant hover:text-m3-error hover:bg-m3-error/10 transition-colors shrink-0"
                aria-label="移除历史 / Remover"
              >
                <Trash2 class="w-4 h-4" />
              </button>
              <ArrowRight
                class="w-5 h-5 text-m3-outline-variant/50 group-hover:text-m3-primary transition-colors shrink-0"
              />
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
