<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useTranslation } from '../composables/useTranslation';
import { useBookmarks } from '../composables/useBookmarks';
import FuriganaText from './FuriganaText.vue';
import M3Select from './M3Select.vue';
import { Star, Flag, AlertTriangle, X, Volume2, Sparkles, Loader2 } from 'lucide-vue-next';
import { reportTranslationError } from '../utils/api.js';

const { resultData, isTranslating } = useTranslation();
const { isBookmarked, toggleBookmark } = useBookmarks();

const reportOptions = [
  { value: "", label: "快速一键报告 / Relatório Rápido" },
  { value: "拼写错误", label: "拼写错误 / Erro Ortográfico" },
  { value: "释义不准确", label: "释义不准确 / Definição Imprecisa" },
  { value: "语境不符", label: "语境不符 / Contexto Inadequado" },
  { value: "其他", label: "其他... / Outros..." }
];

const currentWord = computed(() => {
  if (currentWordDetail.value?.word) return currentWordDetail.value.word;
  if (typeof resultData.value === 'string') return resultData.value;
  if (currentTranslation.value?.text) return currentTranslation.value.text;
  return '';
});
const isDesktop = ref(false);
const activeLang = ref('zh');

const isReportModalOpen = ref(false);
const reportReason = ref('');
const isReporting = ref(false);
const isReported = ref(false);

const langs = [
  { code: 'en', label: 'EN' },
  { code: 'pt-BR', label: 'PT' },
  { code: 'zh', label: '中' },
  { code: 'ja', label: '日' }
];

const activeTabIndex = computed(() => {
  return Math.max(0, langs.findIndex(l => l.code === activeLang.value));
});

const selectLang = (index: number, code: string) => {
  if (!document.startViewTransition) {
    activeLang.value = code;
    return;
  }
  
  document.startViewTransition(async () => {
    activeLang.value = code;
    await nextTick();
  });
};

const currentTranslation = computed(() => {
  if (!resultData.value || !resultData.value.translations) return null;
  return resultData.value.translations[activeLang.value] || null;
});

const currentWordDetail = computed(() => {
  if (!resultData.value || !resultData.value.word_details) return null;
  return resultData.value.word_details[activeLang.value] || null;
});

const currentSenses = computed(() => {
  if (!resultData.value || !resultData.value.senses) return [];
  return resultData.value.senses.filter((s: any) => s.definitions && s.definitions[activeLang.value]);
});

const currentExamples = computed(() => {
  if (!resultData.value || !resultData.value.examples) return [];
  return resultData.value.examples.filter((e: any) => e.translations && e.translations[activeLang.value]);
});

const speak = (text: string, lang: string) => {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'zh' ? 'zh-CN' : lang === 'en' ? 'en-US' : lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
};

const updateDesktopState = () => {
  isDesktop.value = window.innerWidth >= 960;
};

const syncBodyClasses = () => {
  if (resultData.value || isTranslating.value) {
    document.body.classList.add('has-result');
    document.body.classList.remove('has-desktop-idle');
  } else if (isDesktop.value) {
    document.body.classList.remove('has-result');
    document.body.classList.add('has-desktop-idle');
  } else {
    document.body.classList.remove('has-result');
    document.body.classList.remove('has-desktop-idle');
  }
};

watch([resultData, isTranslating, isDesktop], syncBodyClasses);

onMounted(() => {
  updateDesktopState();
  syncBodyClasses();
  window.addEventListener('resize', updateDesktopState);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateDesktopState);
});
const submitReport = async () => {
  if (!currentWord.value) return;
  isReporting.value = true;
  try {
    await reportTranslationError({
      term: currentWord.value,
      target_lang: activeLang.value,
      reason: reportReason.value
    });
    isReported.value = true;
    setTimeout(() => {
      isReportModalOpen.value = false;
      isReported.value = false;
    }, 2000);
  } catch (e) {
    alert("Failed to report: " + e);
  } finally {
    isReporting.value = false;
  }
};

</script>

<template>
  <section class="flex flex-col w-full relative z-0">
    <Transition mode="out-in" name="fade">
      <!-- Loading State -->
      <div v-if="isTranslating" class="flex flex-col items-center justify-center py-10 gap-6 mt-4 md:mt-10">
        <div class="relative flex items-center justify-center w-24 h-24 animate-float">
          <div class="absolute inset-0 border-[3px] border-m3-primary/20 rounded-full animate-pulse-ring"></div>
          <div class="absolute inset-0 border-[3px] border-m3-primary/20 rounded-full animate-pulse-ring animation-delay-1500"></div>
          
          <div class="relative bg-m3-surface-container w-16 h-16 rounded-full flex items-center justify-center shadow-sm border border-m3-outline-variant/10 z-10 text-m3-primary/70">
            <Loader2 class="w-7 h-7 animate-spin" />
          </div>
        </div>
        <div class="flex flex-col items-center gap-1.5 opacity-80 animate-float" style="animation-delay: 0.2s;">
          <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
            解析中<br/><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Analisando</span>
          </p>
          <p class="text-m3-outline text-[0.85rem] font-medium text-center">
            正在加载翻译结果...<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Carregando...</span>
          </p>
        </div>
      </div>
      
      <!-- Result State -->
      <div v-else-if="resultData" class="bg-m3-surface-container rounded-[28px] p-5 sm:p-8 shadow-sm border border-m3-outline-variant/20 relative">
        <div class="flex items-center justify-between w-full mb-6">
          <span class="text-[0.7rem] font-bold uppercase tracking-widest text-m3-on-surface-variant flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full" :class="resultData.provider === 'dictionary' ? 'bg-[#ff9800]' : (resultData.cached ? 'bg-m3-primary' : 'bg-[#008053]')"></span>
            <div class="flex flex-col">
              <span>{{ resultData.provider === 'dictionary' ? '核心词典' : (resultData.cached ? '已缓存' : 'AI') }}</span>
              <span class="text-[0.55rem] opacity-70 tracking-normal mt-0.5" v-if="resultData.provider === 'dictionary' || resultData.cached">
                {{ resultData.provider === 'dictionary' ? 'Dicionário Principal' : 'Em cache' }}
              </span>
            </div>
          </span>
          
          <div class="flex gap-2 items-center shrink-0">
            <button 
              v-if="currentWord && resultData?.type !== 'sentence'" 
              @click="toggleBookmark(currentWord)" 
              class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full hover:-translate-y-0.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
              :class="isBookmarked(currentWord) ? 'bg-[#FFD9E2]/80 text-[#82284D] shadow-md hover:bg-[#FFD9E2]' : 'bg-m3-surface-container-highest text-m3-on-surface-variant hover:bg-m3-primary hover:text-m3-on-primary hover:shadow-md'"
              aria-label="收藏单词 / Salvar palavra"
            >
              <Star :class="{ 'fill-current': isBookmarked(currentWord) }" class="w-5 h-5" />
            </button>
            <button 
              v-if="currentWord && resultData?.type !== 'sentence'" 
              @click="isReportModalOpen = true; reportReason = ''"
              class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-m3-surface-container-highest text-m3-on-surface-variant hover:bg-[#FFD9E2] hover:text-[#82284D] hover:shadow-md hover:-translate-y-0.5 transition-all outline-none"
              aria-label="纠错反馈 / Enviar feedback"
            >
              <Flag class="w-5 h-5" />
            </button>
            <button 
              v-if="currentTranslation" 
              @click="speak(currentTranslation.audio_text || currentTranslation.text, activeLang)" 
              class="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full bg-m3-surface-container-highest text-m3-on-surface-variant hover:bg-m3-primary hover:text-m3-on-primary hover:shadow-md hover:-translate-y-0.5 transition-all outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
              aria-label="朗读发音 / Pronunciar"
            >
              <Volume2 class="w-5 h-5" />
            </button>
          </div>
        </div>
        <!-- Segmented Tab Bar -->
        <div class="pb-6 mb-4 border-b border-m3-outline-variant/25">
          <div class="relative grid grid-cols-4 bg-m3-surface-container-high/40 rounded-[18px] p-1.5 shadow-inner border border-m3-outline-variant/10">
            <!-- Sliding Indicator -->
            <div 
              class="absolute top-1.5 bottom-1.5 bg-m3-primary rounded-[14px] shadow-sm transition-transform duration-300 z-0"
              style="transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1); will-change: transform;"
              :style="{ width: `calc((100% - 12px) / ${langs.length})`, transform: `translate3d(${activeTabIndex * 100}%, 0, 0)`, left: '6px' }"
            ></div>

            <button 
              v-for="(lang, i) in langs" 
              :key="lang.code"
              @click="selectLang(i, lang.code)"
              class="rounded-[14px] py-2.5 text-[0.95rem] font-bold outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-m3-primary relative z-10 transition-colors duration-200"
              :class="activeLang === lang.code ? 'text-m3-on-primary' : 'text-m3-on-surface-variant hover:text-m3-on-surface'"
            >
              {{ lang.label }}
            </button>
          </div>
        </div>

        <!-- Hero Header -->
        <div class="flex flex-col items-start justify-start mb-4">
          <h1 class="text-[clamp(1.6rem,5vw,2.25rem)] leading-[1.35] font-display font-black text-m3-on-surface tracking-tight break-words">
            <FuriganaText :text="currentWord" />
          </h1>
        </div>
        
        <!-- Phonetics -->
        <div v-if="currentTranslation?.phonetic" class="flex flex-wrap gap-2 mb-6">
          <span class="inline-flex items-center px-4 py-1.5 rounded-full border border-m3-outline-variant/30 bg-m3-surface text-m3-on-surface-variant text-[0.95rem] font-medium tracking-wide shadow-sm">
            {{ currentTranslation.phonetic }}
          </span>
        </div>

        <!-- Content Area -->
        <div :key="activeLang" class="w-full flex flex-col">
            <!-- Simple Text Fallback -->
            <div v-if="typeof resultData === 'string'" class="bg-m3-surface-container rounded-[28px] p-6 text-m3-on-surface font-medium mt-6">
              {{ resultData }}
            </div>
            <div v-else-if="currentWordDetail && currentWordDetail.definition && currentSenses.length === 0" class="bg-m3-surface-container rounded-[28px] p-6 mt-6 border border-m3-outline-variant/20">
              <p class="text-m3-on-surface text-lg leading-relaxed">{{ currentWordDetail.definition }}</p>
            </div>

            <!-- Content Area -->
            <div class="flex flex-col" v-if="currentSenses.length > 0 || currentExamples.length > 0">
              <!-- Definitions / Senses -->
              <div v-if="currentSenses.length > 0" class="flex flex-col pt-3 pb-6 border-b border-m3-outline-variant/25">
                <h4 class="text-[0.7rem] font-black uppercase tracking-[0.2em] text-m3-primary/80 mb-2 flex items-center gap-2">
                  <span class="w-1 h-3 rounded-full bg-m3-primary/50"></span>
                  <div class="flex flex-col">
                    <span>释义</span>
                    <span class="text-[0.6rem] opacity-70 tracking-widest mt-0.5">Definições</span>
                  </div>
                </h4>
                <div v-for="(sense, i) in currentSenses" :key="i" class="py-4">
                  <div class="flex gap-4 items-start">
                    <span class="flex items-center justify-center w-[26px] h-[26px] rounded-[8px] bg-m3-primary/10 text-m3-primary text-[0.85rem] font-black shrink-0 mt-1">{{ sense.sense_order }}</span>
                    <div class="flex flex-col gap-1.5 w-full pt-0.5">
                      <div class="flex flex-wrap items-center gap-2 mb-0.5">
                        <span v-if="sense.part_of_speech" class="px-2 py-0.5 rounded-[6px] bg-m3-surface-variant/60 text-m3-on-surface-variant text-[0.65rem] font-bold uppercase tracking-widest">{{ sense.part_of_speech }}</span>
                      </div>
                      <span class="text-m3-on-surface text-[1.15rem] sm:text-[1.25rem] font-medium leading-relaxed"><FuriganaText :text="sense.definitions[activeLang]" /></span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Examples -->
              <div v-if="currentExamples.length > 0" class="pt-6 pb-2">
                <h4 class="text-[0.7rem] font-black uppercase tracking-[0.2em] text-m3-primary/80 mb-2 flex items-center gap-2">
                  <span class="w-1 h-3 rounded-full bg-m3-primary/50"></span>
                  <div class="flex flex-col">
                    <span>例句</span>
                    <span class="text-[0.6rem] opacity-70 tracking-widest mt-0.5">Exemplos</span>
                  </div>
                </h4>
                <div class="flex flex-col">
                  <div v-for="(example, i) in currentExamples" :key="i" class="py-4">
                    <div class="flex gap-4 items-start">
                      <span class="flex items-center justify-center w-[26px] h-[26px] shrink-0 mt-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-m3-primary/50"></span>
                      </span>
                      <div class="flex flex-col gap-1.5 w-full pt-0.5">
                        <p class="text-m3-on-surface text-[1.05rem] font-medium leading-relaxed"><FuriganaText :text="example.sentence" :highlight="currentWord" /></p>
                        <p class="text-m3-on-surface-variant text-[0.95rem] leading-relaxed"><FuriganaText :text="example.translations[activeLang]" :highlight="currentWord" /></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
        <!-- Footer Reference -->
        <p class="text-center text-[0.7rem] text-m3-on-surface-variant/50 mt-6 mb-1 font-medium tracking-widest uppercase" v-if="resultData.provider">
          翻译服务由 {{ resultData.provider }} 提供 / Serviço fornecido por {{ resultData.provider }}
        </p>
      </div>
      
      <!-- Empty State -->
      <div v-else class="flex flex-col items-center justify-center py-10 gap-6 mt-4 md:mt-10">
        <div class="relative flex items-center justify-center w-24 h-24 animate-float">
          <div class="absolute inset-0 border-[3px] border-m3-primary/20 rounded-full animate-pulse-ring"></div>
          <div class="absolute inset-0 border-[3px] border-m3-primary/20 rounded-full animate-pulse-ring animation-delay-1500"></div>
          
          <div class="relative bg-m3-surface-container w-16 h-16 rounded-full flex items-center justify-center shadow-sm border border-m3-outline-variant/10 z-10 text-m3-primary/70">
            <Sparkles class="w-7 h-7" />
          </div>
        </div>
        <div class="flex flex-col items-center gap-1.5 opacity-80 animate-float" style="animation-delay: 0.2s;">
          <p class="text-m3-on-surface-variant font-bold tracking-[0.15em] text-[0.8rem] uppercase text-center">
            等待输入<br/><span class="text-[0.7rem] opacity-70 tracking-normal mt-0.5 inline-block">Aguardando</span>
          </p>
          <p class="text-m3-outline text-[0.85rem] font-medium text-center">
            支持中 / 英 / 葡 / 日 自动识别<br/><span class="text-[0.75rem] opacity-70 mt-0.5 inline-block">Suporta detecção auto ZH/EN/PT/JA</span>
          </p>
        </div>
      </div>
    </Transition>

    <!-- Error Report Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="isReportModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div class="bg-m3-surface-container rounded-[28px] shadow-2xl w-full max-w-md p-6 sm:p-8 flex flex-col gap-6">
            <div class="flex items-center justify-between">
              <h3 class="text-xl font-display font-bold text-m3-on-surface flex items-center gap-3">
                <AlertTriangle class="w-6 h-6 text-m3-primary" /> 纠正 / Corrigir
              </h3>
              <button @click="isReportModalOpen = false" class="w-10 h-10 rounded-full bg-transparent hover:bg-m3-surface-container-high flex items-center justify-center text-m3-on-surface-variant transition-colors">
                <X class="w-5 h-5" />
              </button>
            </div>
            
            <p class="text-m3-on-surface-variant text-[0.95rem] leading-relaxed">
              发现 <strong>{{ currentWord }}</strong> 有误？ / Erro em <strong>{{ currentWord }}</strong>?<br/>
              后台模型将进行分析修正。 / A IA analisará e fará a correção.
            </p>

            <div class="flex flex-col gap-3">
              <label class="text-xs font-bold text-m3-on-surface-variant uppercase tracking-wider pl-1">类型 (可选) / Tipo (Opcional)</label>
              <M3Select v-model="reportReason" :options="reportOptions" />
            </div>

            <div class="flex items-center justify-end gap-3 mt-2">
              <button v-if="!isReported && !isReporting" @click="isReportModalOpen = false" class="px-6 py-2.5 rounded-full text-sm font-bold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors">
                取消 / Cancelar
              </button>
              <button 
                v-if="!isReported"
                @click="submitReport"
                :disabled="isReporting"
                class="px-6 py-2.5 rounded-full text-sm font-bold bg-m3-primary text-m3-on-primary hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2"
              >
                <Loader2 v-if="isReporting" class="w-4 h-4 animate-spin" />
                {{ isReporting ? '提交中... / Enviando...' : '提交 / Enviar' }}
              </button>
              <div v-else class="px-6 py-2.5 rounded-full bg-m3-primary/10 text-m3-primary text-sm font-bold flex items-center gap-2">
                <Check class="w-4 h-4" />
                感谢反馈！ / Obrigado!
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
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

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.animate-float {
  animation: float 4s ease-in-out infinite;
}
@keyframes pulse-ring {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(1.5); opacity: 0; }
}
.animate-pulse-ring {
  animation: pulse-ring 3s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}
.animation-delay-1500 {
  animation-delay: 1.5s;
}

/* Modal Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}
.modal-enter-active .bg-m3-surface-container,
.modal-leave-active .bg-m3-surface-container {
  transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .bg-m3-surface-container,
.modal-leave-to .bg-m3-surface-container {
  transform: scale(0.95) translateY(10px);
  opacity: 0;
}

/* Tab Slide Transitions */
.slide-left-enter-active,
.slide-right-enter-active {
  transition: opacity 0.2s cubic-bezier(0.1, 0.9, 0.2, 1), transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1);
}
.slide-left-leave-active,
.slide-right-leave-active {
  transition: opacity 0.1s ease-in, transform 0.1s ease-in;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(10px);
}
.slide-left-leave-to {
  opacity: 0;
  transform: translateX(-10px);
}

.slide-right-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}
.slide-right-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
</style>
