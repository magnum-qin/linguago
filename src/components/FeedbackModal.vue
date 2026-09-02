<script setup lang="ts">
import { ref, watch } from 'vue';
import { AlertTriangle, Check, ChevronDown, Loader2 } from 'lucide-vue-next';
import M3ModalShell from './M3ModalShell.vue';
import { reportTranslationError } from '../utils/api';

const props = defineProps<{
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
  { value: '', label: '快速一键报告 / Relatório rápido' },
  { value: '拼写错误', label: '拼写错误 / Erro ortográfico' },
  { value: '释义不准确', label: '释义不准确 / Definição imprecisa' },
  { value: '语境不符', label: '语境不符 / Contexto inadequado' },
  { value: '其他', label: '其他 / Outros' }
];

const selectMenuProps = {
  contentClass: 'm3-select-menu-content',
  maxHeight: 240,
  location: 'top' as const
};

const close = () => {
  if (!isReporting.value) emit('close');
};

const submitReport = async () => {
  if (!props.term || isReporting.value) return;
  isReporting.value = true;
  reportError.value = '';
  try {
    await reportTranslationError({
      term: props.term,
      target_lang: props.activeLang,
      reason: reportReason.value
    });
    isReported.value = true;
    setTimeout(() => emit('close'), 1600);
  } catch {
    reportError.value = '提交失败，请重试 / Falha ao enviar. Tente novamente.';
  } finally {
    isReporting.value = false;
  }
};

watch(
  () => props.isOpen,
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
    title="报告翻译问题 / Reportar"
    title-id="feedback-dialog-title"
    :max-width="460"
    close-label="关闭反馈 / Fechar relatório"
    @update:model-value="close"
  >
    <template #title-icon>
      <AlertTriangle class="h-5 w-5 shrink-0 text-m3-error" aria-hidden="true" />
    </template>

    <div class="feedback-content">
      <p class="feedback-description">
        发现翻译结果不准确？提交快速报告以帮助我们优化系统。 / Ajude-nos a melhorar a tradução.
      </p>

      <div class="feedback-field">
        <label class="feedback-label" for="feedback-reason">问题类型 / Tipo de problema</label>
        <v-select
          id="feedback-reason"
          v-model="reportReason"
          :items="reportOptions"
          item-title="label"
          item-value="value"
          variant="solo"
          flat
          hide-details
          class="m3-native-select"
          menu-icon="none"
          :menu-props="selectMenuProps"
        >
          <template #append-inner>
            <ChevronDown class="h-5 w-5 text-m3-on-surface-variant opacity-70" aria-hidden="true" />
          </template>
        </v-select>
      </div>

      <p v-if="reportError" class="feedback-error" role="alert">{{ reportError }}</p>
      <div v-if="isReported" class="feedback-success" role="status">
        <Check class="h-4 w-4" aria-hidden="true" />
        感谢反馈 / Obrigado!
      </div>
    </div>

    <template #actions>
      <div class="feedback-actions">
        <v-btn variant="flat" class="m3-button m3-button--cancel" :disabled="isReporting || isReported" @click="close">
          取消 / Cancelar
        </v-btn>
        <v-btn
          variant="flat"
          class="m3-button m3-button--primary"
          :disabled="isReporting || isReported"
          @click="submitReport"
        >
          <Loader2 v-if="isReporting" class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          {{ isReporting ? '提交中 / Enviando' : '提交 / Enviar' }}
        </v-btn>
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
