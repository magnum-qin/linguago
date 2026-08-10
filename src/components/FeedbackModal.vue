<script setup lang="ts">
import { ref } from 'vue';
import { AlertTriangle, ChevronDown, Loader2, Check } from 'lucide-vue-next';
import { reportTranslationError } from '../utils/api.js';

const props = defineProps<{
  isOpen: boolean;
  term: string;
  activeLang: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const reportReason = ref('');
const isReporting = ref(false);
const isReported = ref(false);

const reportOptions = [
  { value: '', label: '快速一键报告 / Relatório Rápido' },
  { value: '拼写错误', label: '拼写错误 / Erro Ortográfico' },
  { value: '释义不准确', label: '释义不准确 / Definição Imprecisa' },
  { value: '语境不符', label: '语境不符 / Contexto Inadequado' },
  { value: '其他', label: '其他... / Outros...' }
];

const submitReport = async () => {
  if (!props.term) return;
  isReporting.value = true;
  try {
    await reportTranslationError({
      term: props.term,
      target_lang: props.activeLang,
      reason: reportReason.value
    });
    isReported.value = true;
    setTimeout(() => {
      emit('close');
      isReported.value = false;
    }, 2000);
  } catch (e) {
    alert('Failed to report: ' + e);
  } finally {
    isReporting.value = false;
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" class="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <!-- Backdrop -->
        <div @click="emit('close')" class="absolute inset-0 bg-black/40 backdrop-blur-sm"></div>

        <!-- Modal Card -->
        <div
          class="relative bg-m3-surface-container rounded-[32px] p-6 sm:p-8 w-full max-w-[460px] shadow-2xl border border-m3-outline-variant/20 flex flex-col gap-4 transform transition-all duration-300"
        >
          <div class="flex items-center gap-3 text-[#BA1A1A]">
            <AlertTriangle class="w-6 h-6" />
            <h3 class="text-xl font-bold font-display tracking-tight text-m3-on-surface">报告翻译问题 / Reportar</h3>
          </div>

          <p class="text-sm text-m3-on-surface-variant leading-relaxed">
            发现翻译结果不准确？提交快速报告以帮助我们不断优化系统。 / Ajude-nos a melhorar.
          </p>

          <div class="flex flex-col gap-1.5 mt-2">
            <v-select
              v-model="reportReason"
              :items="reportOptions"
              item-title="label"
              item-value="value"
              variant="flat"
              density="comfortable"
              class="m3-native-select w-full"
              hide-details
            >
              <template v-slot:append-inner>
                <ChevronDown class="w-5 h-5 text-m3-on-surface-variant opacity-70" />
              </template>
            </v-select>
          </div>

          <div class="flex items-center justify-end gap-3 mt-2">
            <button
              v-if="!isReported && !isReporting"
              @click="emit('close')"
              class="px-6 py-2.5 rounded-full text-sm font-bold text-m3-on-surface-variant hover:bg-m3-surface-container-high transition-colors"
            >
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
            <div
              v-else
              class="px-6 py-2.5 rounded-full bg-m3-primary/10 text-m3-primary text-sm font-bold flex items-center gap-2"
            >
              <Check class="w-4 h-4" />
              感谢反馈！ / Obrigado!
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
:deep(.m3-native-select .v-field) {
  background: var(--color-m3-surface) !important;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 50%, transparent) !important;
  border-radius: 16px !important;
  min-height: 48px !important;
  color: var(--color-m3-on-surface) !important;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05) !important;
}
:deep(.m3-native-select .v-field__input) {
  font-weight: 700 !important;
  font-size: 0.9rem !important;
}

/* Modal Transitions */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
}
.modal-enter-active .bg-m3-surface-container,
.modal-leave-active .bg-m3-surface-container {
  transition:
    transform 0.3s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.3s cubic-bezier(0.2, 0, 0, 1);
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
</style>
