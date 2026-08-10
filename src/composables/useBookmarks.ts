import { ref, watch } from 'vue';

const STORAGE_KEY = 'linguago_bookmarks';

// Global state
const bookmarks = ref<string[]>([]);
const isBookmarksOpen = ref(false);

// Initialize from localStorage
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    bookmarks.value = JSON.parse(stored);
  }
} catch (e) {
  console.error('Failed to load bookmarks', e);
}

// Persist to localStorage whenever it changes
watch(
  bookmarks,
  (newVal) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newVal));
  },
  { deep: true }
);

export function useBookmarks() {
  const toggleBookmark = (word: string) => {
    if (!word) return;
    const index = bookmarks.value.indexOf(word);
    if (index > -1) {
      bookmarks.value.splice(index, 1);
    } else {
      bookmarks.value.unshift(word);
    }
  };

  const isBookmarked = (word: string) => {
    if (!word) return false;
    return bookmarks.value.includes(word);
  };

  const clearBookmarks = () => {
    bookmarks.value = [];
  };

  const removeBookmark = (word: string) => {
    const index = bookmarks.value.indexOf(word);
    if (index > -1) {
      bookmarks.value.splice(index, 1);
    }
  };

  return {
    bookmarks,
    isBookmarksOpen,
    toggleBookmark,
    isBookmarked,
    clearBookmarks,
    removeBookmark
  };
}
