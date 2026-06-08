import { ref, shallowRef } from 'vue';
import { openTranslationStream } from '../utils/api.js';
import { settings } from './useSettings';

const inputText = ref('');
const resultData = shallowRef<any>(null);
const isTranslating = ref(false);

export function useTranslation() {
  const translate = async () => {
    if (!inputText.value.trim() || isTranslating.value) return;
    
    isTranslating.value = true;
    resultData.value = null;
    
    try {
      const payload = {
        text: inputText.value,
        source_lang: 'auto',
        target_lang: 'zh',
        provider: settings.provider,
        model: settings.model,
      };
      
      const response = await openTranslationStream(payload);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream available');
      
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
            if (parsed.event === 'partial_translation' || parsed.event === 'partial_explanation' || parsed.event === 'final') {
              resultData.value = parsed.data;
            } else if (parsed.event === 'error') {
              throw new Error(parsed.data.message || 'Translation failed');
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON lines
          }
        }
      }
    } catch (e: any) {
      console.error(e);
      resultData.value = `Error: ${e.message || 'Translation failed'}`;
    } finally {
      isTranslating.value = false;
    }
  };

  const clear = () => {
    inputText.value = '';
    resultData.value = null;
  };

  return {
    inputText,
    resultData,
    isTranslating,
    translate,
    clear
  };
}
