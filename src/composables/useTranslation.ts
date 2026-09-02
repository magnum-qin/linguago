import { ref, shallowRef } from 'vue';
import { openTranslationStream } from '../utils/api.js';
import { settings } from './useSettings';
import { useHistory } from './useHistory';

const inputText = ref('');
const resultData = shallowRef<any>(null);
const isTranslating = ref(false);
const sourceLangPreference = ref<'auto' | 'zh' | 'ja' | 'en' | 'pt-BR'>('auto');
let activeController: AbortController | null = null;
let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let activeRequestId = 0;

export function useTranslation() {
  const { addHistory } = useHistory();

  const translate = async () => {
    if (!inputText.value.trim() || isTranslating.value) return;

    isTranslating.value = true;
    resultData.value = null;
    const text = inputText.value.trim();
    const requestId = ++activeRequestId;
    const controller = new AbortController();
    activeController = controller;

    try {
      const payload = {
        text,
        source_lang: sourceLangPreference.value,
        target_lang: 'zh',
        provider: settings.provider,
        model: settings.model
      };

      const response = await openTranslationStream(payload, controller.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream available');
      activeReader = reader;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (
              parsed.event === 'partial_translation' ||
              parsed.event === 'partial_explanation' ||
              parsed.event === 'final'
            ) {
              resultData.value = parsed.data;
              if (parsed.event === 'final') {
                addHistory({
                  text,
                  targetLang: parsed.data?.target_lang || payload.target_lang,
                  provider: parsed.data?.provider || payload.provider,
                  model: parsed.data?.model || payload.model
                });
              }
            } else if (parsed.event === 'error') {
              throw new Error(parsed.data.message || 'Translation failed');
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON lines
          }
        }
      }
    } catch (e: any) {
      if (controller.signal.aborted || e?.name === 'AbortError') return;
      console.error(e);
      resultData.value = `Error: ${e.message || 'Translation failed'}`;
    } finally {
      if (activeRequestId === requestId) {
        activeController = null;
        activeReader = null;
        isTranslating.value = false;
      }
    }
  };

  const stopTranslation = () => {
    if (!isTranslating.value) return;
    activeController?.abort();
    activeReader?.cancel().catch(() => {});
    isTranslating.value = false;
  };

  const clear = () => {
    stopTranslation();
    inputText.value = '';
    resultData.value = null;
  };

  return {
    inputText,
    sourceLangPreference,
    resultData,
    isTranslating,
    translate,
    stopTranslation,
    clear
  };
}
