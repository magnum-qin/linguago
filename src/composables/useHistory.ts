import { ref, watch } from 'vue';
import { HISTORY_KEY } from './useSettings';

export interface HistoryItem {
  text: string;
  targetLang: string;
  provider?: string;
  model?: string;
  createdAt: string;
}

const historyItems = ref<HistoryItem[]>([]);
const isHistoryOpen = ref(false);

try {
  const stored = localStorage.getItem(HISTORY_KEY);
  historyItems.value = stored ? JSON.parse(stored) : [];
} catch (e) {
  console.error('Failed to load history', e);
}

watch(historyItems, (items) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}, { deep: true });

function addHistory(item: Omit<HistoryItem, 'createdAt'>) {
  const text = item.text.trim();
  if (!text) return;

  const existingIndex = historyItems.value.findIndex((entry) => entry.text === text);
  if (existingIndex !== -1) {
    historyItems.value.splice(existingIndex, 1);
  }

  historyItems.value.unshift({
    ...item,
    text,
    createdAt: new Date().toISOString()
  });

  if (historyItems.value.length > 100) {
    historyItems.value = historyItems.value.slice(0, 100);
  }
}

function removeHistory(text: string) {
  const index = historyItems.value.findIndex((entry) => entry.text === text);
  if (index !== -1) {
    historyItems.value.splice(index, 1);
  }
}

function clearHistory() {
  historyItems.value = [];
}

export function useHistory() {
  return {
    historyItems,
    isHistoryOpen,
    addHistory,
    removeHistory,
    clearHistory
  };
}
