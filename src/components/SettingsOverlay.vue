<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { X, ChevronDown, Loader2, Check, RefreshCw } from 'lucide-vue-next';
import { settings, getModelsForProvider } from '../composables/useSettings';
import { verifyTranslation } from '../utils/api.js';
import { checkForPwaUpdate } from '../utils/pwa-update';

const isOpen = ref(false);
const isVerifying = ref(false);
const verifyStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
const isEditingModels = ref(false);
const updateStatus = ref<'idle' | 'checking' | 'current' | 'updating' | 'error'>('idle');

let originalSettings = {
  provider: settings.provider,
  model: settings.model,
  colorScheme: settings.colorScheme,
  modelOptions: JSON.stringify(settings.modelOptions)
};

window.addEventListener('open-settings', () => {
  originalSettings = {
    provider: settings.provider,
    model: settings.model,
    colorScheme: settings.colorScheme,
    modelOptions: JSON.stringify(settings.modelOptions)
  };
  isOpen.value = true;
  isEditingModels.value = false;
  updateStatus.value = 'idle';
});

const close = () => {
  // Revert settings to original state
  settings.provider = originalSettings.provider;
  settings.model = originalSettings.model;
  settings.colorScheme = originalSettings.colorScheme;
  if (originalSettings.modelOptions) {
    settings.modelOptions = JSON.parse(originalSettings.modelOptions);
  }

  isOpen.value = false;
  verifyStatus.value = 'idle';
};

const onDialogUpdate = (val: boolean) => {
  if (!val) close();
};

import { onMounted, onUnmounted } from 'vue';
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isOpen.value) {
    close();
  }
};
onMounted(() => window.addEventListener('keydown', handleKeydown));
onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

const saveAndClose = () => {
  isOpen.value = false;
  verifyStatus.value = 'idle';
};

const verifyModelSetting = async () => {
  if (isVerifying.value) return;
  isVerifying.value = true;
  verifyStatus.value = 'loading';

  try {
    await verifyTranslation({
      text: 'hello',
      source_lang: 'auto',
      target_lang: 'zh',
      provider: settings.provider,
      model: settings.model
    });

    verifyStatus.value = 'success';
    setTimeout(() => {
      if (verifyStatus.value === 'success') verifyStatus.value = 'idle';
    }, 3000);
  } catch (error: any) {
    verifyStatus.value = 'error';
    setTimeout(() => {
      if (verifyStatus.value === 'error') verifyStatus.value = 'idle';
    }, 3000);
  } finally {
    isVerifying.value = false;
  }
};

const checkUpdate = async () => {
  if (updateStatus.value === 'checking' || updateStatus.value === 'updating') return;
  updateStatus.value = 'checking';

  try {
    updateStatus.value = await checkForPwaUpdate();
  } catch {
    updateStatus.value = 'error';
  }
};

const EDITABLE_PROVIDERS = ['cloudflare', 'dashscope', 'gemini', 'deepseek'];
const isEditableProvider = computed(() => EDITABLE_PROVIDERS.includes(settings.provider));

const newModelName = ref('');

const editableModels = computed({
  get() {
    return settings.modelOptions?.[settings.provider] || getModelsForProvider(settings.provider);
  },
  set(val: string[]) {
    if (!settings.modelOptions) settings.modelOptions = {};
    settings.modelOptions[settings.provider] = val;
    if (!val.includes(settings.model) && val.length > 0) {
      settings.model = val[0];
    }
  }
});

const addModel = () => {
  const name = newModelName.value.trim();
  if (name && !editableModels.value.includes(name)) {
    editableModels.value = [...editableModels.value, name];
    newModelName.value = '';
  }
};

const removeModel = (model: string) => {
  editableModels.value = editableModels.value.filter((m: string) => m !== model);
};

const providerOptions = [
  { value: 'auto', label: '智能路由 / Auto' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'dashscope', label: '阿里云百炼 / DashScope' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' }
];

const currentModels = computed(() => getModelsForProvider(settings.provider));

// When provider changes, ensure the model is valid for that provider
watch(
  () => settings.provider,
  (newProvider) => {
    const models = getModelsForProvider(newProvider);
    if (!models.includes(settings.model)) {
      settings.model = models[0];
    }
  }
);
</script>

<template>
  <v-dialog
    :model-value="isOpen"
    @update:model-value="onDialogUpdate"
    max-width="420"
    scrim="black"
    :scrim-opacity="0.4"
    transition="settings-dialog-transition"
    :content-props="{ class: 'settings-dialog-content' }"
  >
    <v-card
      class="settings-panel w-full max-w-[420px] mx-auto grid grid-cols-1 gap-4 !rounded-[26px] !p-5 !bg-m3-surface-container !shadow-2xl"
    >
      <div class="settings-head flex items-center justify-between px-1 pb-2">
        <strong class="text-lg font-bold text-m3-on-surface">设置 / Configurações</strong>
        <v-btn
          icon
          variant="text"
          class="!h-10 !w-10 !rounded-[14px] !text-m3-on-surface hover:!bg-m3-surface-container-highest"
          @click="close"
        >
          <X class="w-5 h-5" />
        </v-btn>
      </div>

      <div class="setting-field grid gap-2">
        <label class="text-xs font-black uppercase tracking-[0.08em] text-m3-on-surface-variant"
          >翻译服务 / Provedor</label
        >
        <v-select
          v-model="settings.provider"
          :items="providerOptions"
          item-title="label"
          item-value="value"
          variant="solo"
          flat
          hide-details
          class="m3-native-select"
          menu-icon="none"
          :menu-props="{ contentClass: 'm3-select-menu-content' }"
        >
          <template v-slot:append-inner>
            <ChevronDown class="w-5 h-5 text-m3-on-surface-variant opacity-70" />
          </template>
        </v-select>
      </div>

      <div class="setting-field grid gap-2">
        <label class="text-xs font-black uppercase tracking-[0.08em] text-m3-on-surface-variant"
          >AI 模型 / Modelo</label
        >

        <Transition mode="out-in" name="fade">
          <div v-if="!isEditingModels">
            <v-select
              v-model="settings.model"
              :items="currentModels"
              variant="solo"
              flat
              hide-details
              class="m3-native-select"
              menu-icon="none"
              :loading="verifyStatus === 'loading'"
              :menu-props="{ contentClass: 'm3-select-menu-content' }"
            >
              <template v-slot:append-inner>
                <ChevronDown class="w-5 h-5 text-m3-on-surface-variant opacity-70" />
              </template>
            </v-select>
          </div>
          <div
            v-else
            class="model-list-editor grid gap-3 rounded-[20px] border border-m3-outline-variant/30 bg-m3-surface-container p-3.5"
          >
            <TransitionGroup name="list" tag="div" class="flex flex-wrap gap-2">
              <div
                v-for="model in editableModels"
                :key="model"
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-[12px] bg-m3-primary/10 text-m3-primary border border-m3-primary/20 text-[0.85rem] font-medium transition-colors hover:bg-m3-primary/20"
              >
                <span>{{ model }}</span>
                <button
                  @click="removeModel(model)"
                  class="flex items-center justify-center w-5 h-5 rounded-full hover:bg-m3-primary/20 transition-colors"
                  aria-label="Remove model"
                >
                  <X class="w-3.5 h-3.5" />
                </button>
              </div>
            </TransitionGroup>

            <div class="flex items-center gap-2 mt-1 relative">
              <input
                v-model="newModelName"
                @keydown.enter="addModel"
                placeholder="输入模型标识... / Inserir ID do modelo..."
                class="flex-1 h-[40px] rounded-[12px] border border-m3-outline-variant/50 bg-m3-surface px-3 text-[0.85rem] text-m3-on-surface outline-none focus:ring-2 focus:ring-m3-primary/50 transition-shadow"
              />
              <button
                @click="addModel"
                :disabled="!newModelName.trim()"
                class="h-[40px] px-4 rounded-[12px] bg-m3-secondary-container text-m3-on-secondary-container text-[0.85rem] font-bold transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed outline-none focus-visible:ring-2 focus-visible:ring-m3-primary"
              >
                添加 / Adic.
              </button>
            </div>
          </div>
        </Transition>

        <div class="grid grid-cols-2 gap-2 mt-1">
          <v-btn
            variant="flat"
            @click="verifyModelSetting"
            :disabled="isVerifying"
            class="!h-[44px] !rounded-[16px] !bg-m3-secondary-container !text-m3-on-secondary-container !font-bold !text-[0.8rem] !normal-case !tracking-normal focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
          >
            <template v-if="verifyStatus === 'loading'">
              <Loader2 class="w-4 h-4 animate-spin mr-1 shrink-0" /> <span class="truncate">验证 / Validando</span>
            </template>
            <template v-else-if="verifyStatus === 'success'">
              <Check class="w-4 h-4 mr-1 shrink-0" /> <span class="truncate">成功 / OK</span>
            </template>
            <template v-else-if="verifyStatus === 'error'">
              <X class="w-4 h-4 mr-1 shrink-0" /> <span class="truncate">失败 / Erro</span>
            </template>
            <template v-else>
              <span class="truncate">测试连接 / Testar</span>
            </template>
          </v-btn>
          <v-btn
            variant="flat"
            v-if="isEditableProvider"
            @click="isEditingModels = !isEditingModels"
            class="!h-[44px] !rounded-[16px] !bg-m3-primary/10 !text-m3-primary !font-bold !text-[0.85rem] !normal-case !tracking-normal focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
          >
            {{ isEditingModels ? '完成 / Concluído' : '编辑 / Editar' }}
          </v-btn>
          <div v-else></div>
        </div>
      </div>

      <div class="setting-field grid gap-3 mt-1">
        <label class="text-xs font-black uppercase tracking-[0.08em] text-m3-on-surface-variant"
          >个性化主题 / Temas</label
        >
        <div class="flex items-center gap-4 px-1 pb-1">
          <button
            v-for="color in ['blue', 'rose', 'mint', 'amber', 'violet', 'classic']"
            :key="color"
            @click="settings.colorScheme = color"
            class="w-9 h-9 rounded-full transition-all outline-none"
            :class="[
              settings.colorScheme === color
                ? 'ring-2 ring-offset-2 ring-m3-on-surface scale-110 shadow-lg'
                : 'opacity-70 hover:opacity-100 hover:scale-110 hover:shadow-md cursor-pointer',
              {
                'bg-[#4A90E2]': color === 'blue',
                'bg-[#FF758F]': color === 'rose',
                'bg-[#42B883]': color === 'mint',
                'bg-[#F5A623]': color === 'amber',
                'bg-[#8A63D2]': color === 'violet',
                'bg-[#B4492B]': color === 'classic'
              }
            ]"
            :aria-label="`切换到 ${color} 主题 / Mudar para o tema ${color}`"
          ></button>
        </div>
      </div>

      <v-btn
        data-testid="check-pwa-update"
        variant="flat"
        :disabled="updateStatus === 'checking' || updateStatus === 'updating'"
        class="!h-[48px] !rounded-[16px] !bg-m3-secondary-container !text-m3-on-secondary-container !font-bold !text-[0.85rem] !normal-case !tracking-normal focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
        @click="checkUpdate"
      >
        <Loader2
          v-if="updateStatus === 'checking' || updateStatus === 'updating'"
          class="w-4 h-4 mr-2 animate-spin shrink-0"
        />
        <Check v-else-if="updateStatus === 'current'" class="w-4 h-4 mr-2 shrink-0" />
        <RefreshCw v-else class="w-4 h-4 mr-2 shrink-0" />
        <span v-if="updateStatus === 'checking'">检查中 / Verificando</span>
        <span v-else-if="updateStatus === 'current'">已是最新版本 / Atualizado</span>
        <span v-else-if="updateStatus === 'updating'">正在更新 / Atualizando</span>
        <span v-else-if="updateStatus === 'error'">检查失败，请重试 / Tentar novamente</span>
        <span v-else>检查更新 / Verificar atualização</span>
      </v-btn>

      <div class="model-tools grid grid-cols-2 gap-2.5 mt-2">
        <v-btn
          variant="flat"
          class="!h-[58px] !rounded-[18px] !bg-m3-surface-container-highest !text-m3-on-surface-variant hover:!bg-m3-outline-variant/20 flex flex-col items-center justify-center font-black !normal-case !tracking-normal focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
          @click="close"
        >
          <div class="flex flex-col items-center justify-center">
            <span class="text-[1.02rem] leading-[1.06] mb-[0.12rem]">取消</span>
            <span class="text-[0.94rem] leading-[1.06]">Cancelar</span>
          </div>
        </v-btn>
        <v-btn
          variant="flat"
          class="!h-[58px] !rounded-[18px] !bg-m3-primary !text-m3-on-primary hover:opacity-90 flex flex-col items-center justify-center font-black !normal-case !tracking-normal focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-m3-primary"
          @click="saveAndClose"
        >
          <div class="flex flex-col items-center justify-center">
            <span class="text-[1.02rem] leading-[1.06] mb-[0.12rem]">确认</span>
            <span class="text-[0.94rem] leading-[1.06]">Confirmar</span>
          </div>
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
:global(.settings-dialog-content) {
  overscroll-behavior: none;
  touch-action: pan-y;
}

.settings-panel {
  max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 24px);
  overflow-y: auto !important;
  overscroll-behavior-y: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

:global(.settings-dialog-transition-enter-active) {
  transition:
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 140ms linear;
  will-change: transform, opacity;
}

:global(.settings-dialog-transition-leave-active) {
  transition:
    transform 120ms cubic-bezier(0.4, 0, 1, 1),
    opacity 100ms linear;
  will-change: transform, opacity;
}

:global(.settings-dialog-transition-enter-from),
:global(.settings-dialog-transition-leave-to) {
  transform: translate3d(0, 12px, 0) scale(0.985);
  opacity: 0;
}

@media (max-width: 600px) {
  :global(.settings-dialog-content) {
    width: calc(100% - 24px) !important;
    max-width: calc(100% - 24px) !important;
    max-height: calc(100% - 24px) !important;
    margin: 12px !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  :global(.settings-dialog-transition-enter-active),
  :global(.settings-dialog-transition-leave-active) {
    transition-duration: 1ms;
  }
}

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
</style>
