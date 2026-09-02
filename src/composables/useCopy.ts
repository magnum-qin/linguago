import { ref } from 'vue';

const copiedId = ref<string | null>(null);
let resetTimer: ReturnType<typeof setTimeout> | null = null;

export function useCopy() {
  const isCopied = (id: string) => copiedId.value === id;

  const copy = async (text: string, id?: string): Promise<boolean> => {
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      if (id) {
        copiedId.value = id;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
          if (copiedId.value === id) {
            copiedId.value = null;
          }
        }, 1500);
      }
      return true;
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
      return false;
    }
  };

  return {
    copy,
    isCopied,
    copiedId
  };
}
