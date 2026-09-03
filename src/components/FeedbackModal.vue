<script setup lang="ts">
import { ref, watch } from 'vue';
import { AlertTriangle, Check, Loader2 } from 'lucide-vue-next';
import M3ModalShell from '@/components/M3ModalShell.vue';
import M3Select from '@/components/M3Select.vue';
import { reportTranslationError } from '@/utils/api';

const { isOpen, term, activeLang } = defineProps<{
  isOpen: boolean;
  term: string;
  activeLang: string;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
}>();

const reportReason = ref('');
const isReporting = ref(false);
const isReported = ref(false);
const reportError = ref('');

const reportOptions = [
  { value: '', label: '快速一键报告 | Relatório rápido' },
  { value: '拼写错误', label: '拼写错误 | Erro ortográfico' },
  { value: '语法错误', label: '语法错误 | Erro gramatical' },
  { value: '语境不符', label: '语境不符 | Contexto incorreto' },
  { value: '发音不准确', label: '发音不准确 | Pronúncia imprecisa' },
  { value: '其他问题', label: '其他问题 | Outro' }
];

const close = () => {
  emit('close');
};

const submitReport = async () => {
  if (isReporting.value || isReported.value) return;

  isReporting.value = true;
  reportError.value = '';

  try {
    await reportTranslationError({
      term,
      target_lang: activeLang,
      reason: reportReason.value
    });
    isReported.value = true;
    setTimeout(() => emit('close'), 1600);
  } catch {
    reportError.value = '提交失败，请重试 | Falha ao enviar. Tente novamente.';
  } finally {
    isReporting.value = false;
  }
};

watch(
  () => isOpen,
  (open) => {
    if (!open) {
      reportReason.value = '';
      isReported.value = false;
      reportError.value = '';
    }
  }
);
</script>

<template>
  <M3ModalShell
    :model-value="isOpen"
    title="报告翻译问题 | Reportar"
    title-id="feedback-dialog-title"
    :max-width="460"
    close-label="关闭反馈 | Fechar relatório"
    @update:model-value="close"
  >
    <template #title-icon>
      <AlertTriangle class="h-5 w-5 shrink-0 text-m3-error" aria-hidden="true" />
    </template>

    <div class="feedback-content">
      <p class="feedback-description flex flex-col gap-0.5">
        <span>发现翻译结果不准确？提交快速报告以帮助我们优化系统。</span>
        <span class="text-[0.75rem] opacity-70">Ajude-nos a melhorar a tradução.</span>
      </p>

      <div class="feedback-field">
        <label class="feedback-label flex items-center" for="feedback-reason">
          <span>问题类型</span>
          <span class="text-[0.68rem] opacity-60 font-medium border-l border-m3-outline-variant/40 pl-1.5 ml-1.5">Tipo de problema</span>
        </label>
        <M3Select
          id="feedback-reason"
          v-model="reportReason"
          :items="reportOptions"
        />
      </div>

      <Transition name="m3-expand">
        <p v-if="reportError" class="feedback-error" role="alert">{{ reportError }}</p>
      </Transition>
      <Transition name="m3-expand">
        <div v-if="isReported" class="feedback-success inline-flex items-center" role="status">
          <Check class="h-4 w-4 mr-1.5" aria-hidden="true" />
          <span>感谢反馈</span>
          <span class="text-[0.78rem] opacity-75 font-normal border-l border-current/30 pl-1.5 ml-1.5">Obrigado!</span>
        </div>
      </Transition>
    </div>

    <template #actions>
      <div class="feedback-actions">
        <button
          type="button"
          class="m3-button m3-button--cancel inline-flex items-center justify-center"
          :disabled="isReporting || isReported"
          @click="close"
        >
          <span>取消</span><span class="text-[0.78rem] opacity-75 font-normal border-l border-current/30 pl-1.5 ml-1.5">Cancelar</span>
        </button>
        <button
          type="button"
          class="m3-button m3-button--primary inline-flex items-center justify-center"
          :disabled="isReporting || isReported"
          @click="submitReport"
        >
          <Loader2 v-if="isReporting" class="mr-2 h-4 w-4 animate-spin inline-block" aria-hidden="true" />
          <span v-if="isReporting" class="inline-flex items-center">
            <span>提交中</span><span class="text-[0.78rem] opacity-80 font-normal border-l border-current/30 pl-1.5 ml-1.5">Enviando</span>
          </span>
          <span v-else class="inline-flex items-center">
            <span>提交</span><span class="text-[0.78rem] opacity-80 font-normal border-l border-current/30 pl-1.5 ml-1.5">Enviar</span>
          </span>
        </button>
      </div>
    </template>
  </M3ModalShell>
</template>

<style scoped>
.feedback-content {
  display: grid;
  gap: 18px;
}

.feedback-description {
  color: var(--color-m3-on-surface-variant);
  font-size: 0.9rem;
  line-height: 1.65;
}

.feedback-field {
  display: grid;
  gap: 8px;
}

.feedback-label {
  color: var(--color-m3-on-surface-variant);
  font-size: 0.75rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.feedback-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.feedback-error,
.feedback-success {
  padding: 10px 12px;
  border-radius: 14px;
  font-size: 0.82rem;
  font-weight: 700;
}

.feedback-error {
  color: var(--color-m3-error);
  background: color-mix(in srgb, var(--color-m3-error) 10%, transparent);
}

.feedback-success {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-m3-primary);
  background: color-mix(in srgb, var(--color-m3-primary) 10%, transparent);
}

:deep(.m3-native-select .v-field) {
  min-height: 52px !important;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 50%, transparent) !important;
  border-radius: 16px !important;
  background: var(--color-m3-surface) !important;
  color: var(--color-m3-on-surface) !important;
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.05) !important;
}

:deep(.m3-native-select .v-field__input) {
  min-width: 0;
  font-size: 0.86rem !important;
  font-weight: 700 !important;
  text-transform: none !important;
}
</style>
