<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { ArrowLeft, Check, ChevronDown, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-vue-next';
import M3ModalShell from './M3ModalShell.vue';
import { EDITABLE_PROVIDERS, getModelsForProvider, settings } from '../composables/useSettings';
import { verifyTranslation } from '../utils/api.js';
import { checkForPwaUpdate } from '../utils/pwa-update';

const isOpen = ref(false);
const isVerifying = ref(false);
const verifyStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle');
const activePage = ref<'settings' | 'models'>('settings');
const updateStatus = ref<'idle' | 'checking' | 'current' | 'updating' | 'error'>('idle');
const newModelName = ref('');

let originalSettings = {
  provider: settings.provider,
  model: settings.model,
  colorScheme: settings.colorScheme,
  modelOptions: JSON.stringify(settings.modelOptions)
};

const providerOptions = [
  { value: 'auto', label: '智能路由 / Auto' },
  { value: 'cloudflare', label: 'Cloudflare Workers AI' },
  { value: 'dashscope', label: '阿里云百炼 / DashScope' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'deepseek', label: 'DeepSeek' }
];

const selectMenuProps = {
  contentClass: 'm3-select-menu-content',
  maxHeight: 240,
  location: 'bottom' as const
};

const isEditingModels = computed(() => activePage.value === 'models');
const isEditableProvider = computed(() => EDITABLE_PROVIDERS.includes(settings.provider));
const currentModels = computed(() => getModelsForProvider(settings.provider));
const dialogTitle = computed(() => (isEditingModels.value ? '模型管理 / Modelos' : '设置 / Configurações'));

const editableModels = computed({
  get: () => settings.modelOptions?.[settings.provider] || getModelsForProvider(settings.provider),
  set(value: string[]) {
    if (!settings.modelOptions) settings.modelOptions = {};
    settings.modelOptions[settings.provider] = value;
    if (!value.includes(settings.model) && value.length > 0) settings.model = value[0];
  }
});

const resetViewState = () => {
  activePage.value = 'settings';
  newModelName.value = '';
  verifyStatus.value = 'idle';
  updateStatus.value = 'idle';
};

const openSettings = () => {
  originalSettings = {
    provider: settings.provider,
    model: settings.model,
    colorScheme: settings.colorScheme,
    modelOptions: JSON.stringify(settings.modelOptions)
  };
  resetViewState();
  isOpen.value = true;
};

const close = () => {
  settings.provider = originalSettings.provider;
  settings.model = originalSettings.model;
  settings.colorScheme = originalSettings.colorScheme;
  settings.modelOptions = JSON.parse(originalSettings.modelOptions || '{}');
  isOpen.value = false;
  resetViewState();
};

const saveAndClose = () => {
  isOpen.value = false;
  resetViewState();
};

const onDialogUpdate = (value: boolean) => {
  if (!value) close();
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && isOpen.value && isEditingModels.value) {
    event.stopPropagation();
    activePage.value = 'settings';
  }
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
    setTimeout(() => verifyStatus.value === 'success' && (verifyStatus.value = 'idle'), 3000);
  } catch {
    verifyStatus.value = 'error';
    setTimeout(() => verifyStatus.value === 'error' && (verifyStatus.value = 'idle'), 3000);
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

const addModel = () => {
  const name = newModelName.value.trim();
  if (!name || editableModels.value.includes(name)) return;
  editableModels.value = [...editableModels.value, name];
  newModelName.value = '';
};

const removeModel = (model: string) => {
  editableModels.value = editableModels.value.filter((item) => item !== model);
};

watch(
  () => settings.provider,
  (provider) => {
    const models = getModelsForProvider(provider);
    if (!models.includes(settings.model)) settings.model = models[0];
  }
);

onMounted(() => {
  window.addEventListener('open-settings', openSettings);
  window.addEventListener('keydown', handleKeydown, true);
});

onUnmounted(() => {
  window.removeEventListener('open-settings', openSettings);
  window.removeEventListener('keydown', handleKeydown, true);
});
</script>

<template>
  <M3ModalShell
    :model-value="isOpen"
    :title="dialogTitle"
    title-id="settings-dialog-title"
    fixed-height
    close-label="关闭设置 / Fechar configurações"
    @update:model-value="onDialogUpdate"
  >
    <template v-if="isEditingModels" #leading>
      <button
        type="button"
        class="settings-back-button"
        aria-label="返回设置 / Voltar às configurações"
        @click="activePage = 'settings'"
      >
        <ArrowLeft class="h-5 w-5" aria-hidden="true" />
      </button>
    </template>

    <Transition name="settings-page" mode="out-in">
      <div v-if="!isEditingModels" key="settings" class="settings-page">
        <section class="setting-field">
          <label class="setting-label" for="translation-provider">翻译服务 / Provedor</label>
          <v-select
            id="translation-provider"
            v-model="settings.provider"
            :items="providerOptions"
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
        </section>

        <section class="setting-field">
          <label class="setting-label" for="translation-model">AI 模型 / Modelo</label>
          <v-select
            id="translation-model"
            v-model="settings.model"
            :items="currentModels"
            variant="solo"
            flat
            hide-details
            class="m3-native-select m3-model-select"
            menu-icon="none"
            :loading="verifyStatus === 'loading'"
            :menu-props="selectMenuProps"
          >
            <template #append-inner>
              <ChevronDown class="h-5 w-5 text-m3-on-surface-variant opacity-70" aria-hidden="true" />
            </template>
          </v-select>

          <div class="model-utility-row" :class="{ 'model-utility-row--single': !isEditableProvider }">
            <v-btn
              variant="flat"
              :disabled="isVerifying"
              class="m3-button m3-button--secondary"
              @click="verifyModelSetting"
            >
              <Loader2 v-if="verifyStatus === 'loading'" class="mr-1.5 h-4 w-4 shrink-0 animate-spin" />
              <Check v-else-if="verifyStatus === 'success'" class="mr-1.5 h-4 w-4 shrink-0" />
              <X v-else-if="verifyStatus === 'error'" class="mr-1.5 h-4 w-4 shrink-0" />
              <span v-if="verifyStatus === 'loading'">验证中 / Validando</span>
              <span v-else-if="verifyStatus === 'success'">连接成功 / Conectado</span>
              <span v-else-if="verifyStatus === 'error'">连接失败 / Erro</span>
              <span v-else>测试连接 / Testar</span>
            </v-btn>
            <v-btn
              v-if="isEditableProvider"
              variant="flat"
              class="m3-button m3-button--secondary"
              @click="activePage = 'models'"
            >
              编辑模型 / Editar
            </v-btn>
          </div>
        </section>

        <section class="setting-field">
          <span class="setting-label">个性化主题 / Temas</span>
          <div class="theme-options" role="group" aria-label="个性化主题 / Temas">
            <button
              v-for="color in ['blue', 'rose', 'mint', 'amber', 'violet', 'classic']"
              :key="color"
              type="button"
              class="theme-option"
              :class="[
                settings.colorScheme === color ? 'theme-option--selected' : '',
                {
                  'bg-[#4A90E2]': color === 'blue',
                  'bg-[#FF758F]': color === 'rose',
                  'bg-[#42B883]': color === 'mint',
                  'bg-[#F5A623]': color === 'amber',
                  'bg-[#8A63D2]': color === 'violet',
                  'bg-[#B4492B]': color === 'classic'
                }
              ]"
              :aria-pressed="settings.colorScheme === color"
              :aria-label="`切换到 ${color} 主题 / Mudar para o tema ${color}`"
              @click="settings.colorScheme = color"
            ></button>
          </div>
        </section>

        <v-btn
          data-testid="check-pwa-update"
          variant="flat"
          :disabled="updateStatus === 'checking' || updateStatus === 'updating'"
          class="m3-button m3-button--tertiary w-full"
          @click="checkUpdate"
        >
          <Loader2
            v-if="updateStatus === 'checking' || updateStatus === 'updating'"
            class="mr-2 h-4 w-4 shrink-0 animate-spin"
          />
          <Check v-else-if="updateStatus === 'current'" class="mr-2 h-4 w-4 shrink-0" />
          <RefreshCw v-else class="mr-2 h-4 w-4 shrink-0" />
          <span v-if="updateStatus === 'checking'">检查中 / Verificando</span>
          <span v-else-if="updateStatus === 'current'">已是最新版本 / Atualizado</span>
          <span v-else-if="updateStatus === 'updating'">正在更新 / Atualizando</span>
          <span v-else-if="updateStatus === 'error'">检查失败 / Tentar novamente</span>
          <span v-else>检查更新 / Verificar atualização</span>
        </v-btn>
      </div>

      <div v-else key="models" class="model-manager">
        <div class="model-manager-context">
          <span class="setting-label">当前服务 / Provedor</span>
          <strong>{{ providerOptions.find((item) => item.value === settings.provider)?.label }}</strong>
        </div>

        <div class="model-list" role="list" aria-label="模型列表 / Lista de modelos">
          <div v-for="model in editableModels" :key="model" class="model-row" role="listitem">
            <span class="model-row-name" :title="model">{{ model }}</span>
            <button
              type="button"
              class="model-remove-button"
              :aria-label="`删除模型 ${model} / Remover modelo ${model}`"
              @click="removeModel(model)"
            >
              <Trash2 class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <form class="model-add-form" @submit.prevent="addModel">
          <label class="setting-label" for="new-model-name">添加模型 / Adicionar modelo</label>
          <div class="model-add-row">
            <input
              id="new-model-name"
              v-model="newModelName"
              type="text"
              autocomplete="off"
              placeholder="输入模型标识 / Inserir ID"
              class="model-add-input"
            />
            <button type="submit" class="model-add-button" :disabled="!newModelName.trim()">
              <Plus class="h-4 w-4" aria-hidden="true" />
              <span>添加 / Adic.</span>
            </button>
          </div>
        </form>
      </div>
    </Transition>

    <template #actions>
      <div v-if="!isEditingModels" class="dialog-action-grid">
        <v-btn variant="flat" class="m3-button m3-button--cancel" @click="close">取消 / Cancelar</v-btn>
        <v-btn variant="flat" class="m3-button m3-button--primary" @click="saveAndClose">确认 / Confirmar</v-btn>
      </div>
      <v-btn v-else variant="flat" class="m3-button m3-button--primary w-full" @click="activePage = 'settings'">
        完成 / Concluído
      </v-btn>
    </template>
  </M3ModalShell>
</template>

<style scoped>
.settings-page,
.model-manager {
  min-width: 0;
  display: grid;
  gap: 18px;
}

.setting-field {
  display: grid;
  gap: 8px;
}

.setting-label {
  color: var(--color-m3-on-surface-variant);
  font-size: 0.75rem;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.model-utility-row,
.dialog-action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.model-utility-row--single {
  grid-template-columns: 1fr;
}

.theme-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.theme-option {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  border: 5px solid var(--color-m3-surface-container);
  border-radius: 999px;
  opacity: 0.72;
  transition:
    transform 150ms ease,
    opacity 150ms ease,
    box-shadow 150ms ease;
}

.theme-option:hover,
.theme-option--selected {
  opacity: 1;
  transform: scale(1.06);
}

.theme-option--selected {
  box-shadow:
    0 0 0 2px var(--color-m3-on-surface),
    0 3px 10px rgb(0 0 0 / 0.16);
}

.theme-option:focus-visible,
.settings-back-button:focus-visible,
.model-remove-button:focus-visible,
.model-add-button:focus-visible {
  outline: 2px solid var(--color-m3-primary);
  outline-offset: 2px;
}

.settings-back-button,
.model-remove-button {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  color: var(--color-m3-on-surface-variant);
  transition:
    background-color 150ms ease,
    color 150ms ease;
}

.settings-back-button:hover,
.model-remove-button:hover {
  color: var(--color-m3-on-surface);
  background: var(--color-m3-surface-container-highest);
}

.model-manager-context {
  display: grid;
  gap: 5px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--color-m3-surface-container-high);
  color: var(--color-m3-on-surface);
}

.model-list {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.model-row {
  min-width: 0;
  min-height: 56px;
  padding-left: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 35%, transparent);
  border-radius: 16px;
  background: var(--color-m3-surface);
}

.model-row-name,
.model-option-text {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
}

.model-row-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.8rem;
  color: var(--color-m3-on-surface);
}

.model-remove-button {
  margin-left: auto;
  border-radius: 12px;
}

.model-remove-button:hover {
  color: var(--color-m3-error);
  background: color-mix(in srgb, var(--color-m3-error) 10%, transparent);
}

.model-add-form {
  display: grid;
  gap: 8px;
}

.model-add-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.model-add-input {
  min-width: 0;
  height: 48px;
  padding: 0 14px;
  border: 1px solid color-mix(in srgb, var(--color-m3-outline-variant) 50%, transparent);
  border-radius: 14px;
  background: var(--color-m3-surface);
  color: var(--color-m3-on-surface);
  font-size: 0.86rem;
  outline: none;
}

.model-add-input:focus {
  border-color: var(--color-m3-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-m3-primary) 25%, transparent);
}

.model-add-button {
  min-width: 108px;
  height: 48px;
  padding: 0 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 14px;
  background: var(--color-m3-secondary-container);
  color: var(--color-m3-on-secondary-container);
  font-size: 0.8rem;
  font-weight: 800;
}

.model-add-button:disabled {
  opacity: 0.45;
}

.settings-page-enter-active,
.settings-page-leave-active {
  transition:
    opacity 120ms ease,
    transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.settings-page-enter-from {
  opacity: 0;
  transform: translate3d(8px, 0, 0);
}

.settings-page-leave-to {
  opacity: 0;
  transform: translate3d(-8px, 0, 0);
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

@media (max-width: 390px) {
  .theme-option {
    width: 40px;
    height: 40px;
    flex-basis: 40px;
  }

  .model-add-row {
    grid-template-columns: 1fr;
  }

  .model-add-button {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-page-enter-active,
  .settings-page-leave-active {
    transition-duration: 1ms;
  }
}
</style>
