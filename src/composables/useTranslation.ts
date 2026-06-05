import { ref } from 'vue';
import { verifyTranslation } from '../utils/api.js';
import { settings } from './useSettings';

const inputText = ref('');
const resultData = ref<string | null>(null);
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
      
      const response = await verifyTranslation(payload);
      resultData.value = response;
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
