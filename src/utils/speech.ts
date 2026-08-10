/**
 * Web Speech API TTS helper
 * Handles localized TTS voice matching, online natural/neural voice prioritization,
 * text normalization (stripping furigana/annotations), and browser compatibility fixes.
 */

const localeMap: Record<string, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
  pt: 'pt-BR',
  'pt-BR': 'pt-BR'
};

export function speak(text: string, lang: string): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  // Pre-warm voices
  window.speechSynthesis.getVoices();

  // Strip any inline Furigana or IPA brackets (e.g. {漢字|かんじ} -> 漢字)
  const cleanTextForSpeech = text.replace(/\{([^|{}]+)\|([^|{}]+)\}/g, '$1');
  const utterance = new SpeechSynthesisUtterance(cleanTextForSpeech);

  const targetLangCode = localeMap[lang] || lang;
  utterance.lang = targetLangCode;

  // Prioritize high-quality voices
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const matchingVoices = voices.filter((v) => {
      const normalizedLang = v.lang.replace('_', '-').toLowerCase();
      const normalizedTarget = targetLangCode.toLowerCase();
      return normalizedLang === normalizedTarget || normalizedLang.startsWith(normalizedTarget.split('-')[0]);
    });

    if (matchingVoices.length > 0) {
      const sortedVoices = [...matchingVoices].sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        const aIsOnline = !a.localService;
        const bIsOnline = !b.localService;
        const aIsNatural =
          aName.includes('natural') || aName.includes('enhanced') || aName.includes('siri') || aName.includes('google');
        const bIsNatural =
          bName.includes('natural') || bName.includes('enhanced') || bName.includes('siri') || bName.includes('google');

        if (aIsNatural && !bIsNatural) return -1;
        if (!aIsNatural && bIsNatural) return 1;
        if (aIsOnline && !bIsOnline) return -1;
        if (!aIsOnline && bIsOnline) return 1;
        return 0;
      });

      utterance.voice = sortedVoices[0];
    }
  }

  window.speechSynthesis.cancel();

  // 50ms delay to resolve Safari/Chrome voice lock bug
  setTimeout(() => {
    window.speechSynthesis.speak(utterance);
  }, 50);
}
