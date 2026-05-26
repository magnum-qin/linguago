const HISTORY_KEY = "linguago-history-v5";
const SETTINGS_KEY = "linguago-settings-v1";
const THEME_SETTINGS_VERSION = 2;
const MODEL_OPTIONS_VERSION = 5;

const RESULT_LANGUAGES = [
  { code: "en", label: "EN", speech: "en-US" },
  { code: "pt-BR", label: "PT", speech: "pt-BR" },
  { code: "zh", label: "\u4e2d", speech: "zh-CN" },
  { code: "ja", label: "\u65e5", speech: "ja-JP" }
];

const LANGUAGES = Object.fromEntries(
  RESULT_LANGUAGES.map((language) => [language.code, language])
);

const DEFAULT_MODELS = {
  auto: "qwen3.6-flash",
  openrouter: "qwen/qwen3-next-80b-a3b-instruct:free",
  dashscope: "qwen3.6-flash",
  gemini: "gemini-2.5-flash",
  deepseek: "deepseek-v4-flash"
};

const PROVIDERS = ["auto", "openrouter", "dashscope", "gemini", "deepseek"];
const EDITABLE_PROVIDERS = ["openrouter", "dashscope", "gemini", "deepseek"];
const DEFAULT_MODEL_OPTIONS = {
  auto: ["qwen3.6-flash"],
  openrouter: [
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "openrouter/free",
      "openrouter/owl-alpha",
      "deepseek/deepseek-v4-flash:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
      "nvidia/nemotron-nano-9b-v2:free",
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "minimax/minimax-m2.5:free",
      "z-ai/glm-4.5-air:free",
      "qwen/qwen3-coder:free",
      "openai/gpt-oss-120b:free",
      "openai/gpt-oss-20b:free",
      "baidu/cobuddy:free",
      "arcee-ai/trinity-large-thinking:free",
      "poolside/laguna-m.1:free",
      "poolside/laguna-xs.2:free",
      "liquid/lfm-2.5-1.2b-thinking:free",
      "liquid/lfm-2.5-1.2b-instruct:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-3.2-3b-instruct:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"
  ],
  dashscope: [
    "qwen3.6-flash",
    "qwen3.6-35b-a3b",
    "glm-5.1",
    "qwen3.6-plus-2026-04-02",
    "qwen3.6-plus",
    "qwen3.5-plus-2026-04-20",
    "qwen3.6-max-preview",
    "qwen3.7-max",
    "kimi-k2.6",
    "qwen3.7-max-2026-05-20",
    "qwen-flash-character-2026-02-26",
    "deepseek-v4-pro",
    "qwen3.6-27b",
    "gui-plus-2026-02-26",
    "deepseek-v4-flash"
  ],
  gemini: [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-2.5-flash",
    "gemini-2.5-pro"
  ],
  deepseek: ["deepseek-v4-flash", "deepseek-v4-pro"]
};

const I18N = {
  input: "\u8f93\u5165 / Entrada",
  ready: "\u51c6\u5907\u5c31\u7eea / Pronto",
  clear: "\u6e05\u7a7a / Limpar",
  settings: "\u8bbe\u7f6e / Configura\u00e7\u00f5es",
  translate: "\u7ffb\u8bd1 / Traduzir",
  loading: "\u7ffb\u8bd1\u4e2d / Traduzindo...",
  examples: "\u4f8b\u53e5 / Exemplos",
  wordDetails: "\u5355\u8bcd\u89e3\u91ca / Explica\u00e7\u00e3o da palavra",
  sentenceExplain: "\u53e5\u5b50\u89e3\u91ca / Explica\u00e7\u00e3o da frase",
  history: "\u5386\u53f2 / Hist\u00f3rico",
  waiting: "\u7b49\u5f85\u8f93\u5165 / Aguardando",
  empty: "\u8bf7\u5148\u8f93\u5165\u8981\u7ffb\u8bd1\u7684\u5185\u5bb9 / Digite algo para traduzir.",
  translating: "\u6b63\u5728\u7ffb\u8bd1 / Traduzindo...",
  word: "\u5355\u8bcd / Palavra",
  sentence: "\u53e5\u5b50 / Frase",
  live: "AI",
  cached: "\u7f13\u5b58 / Cache",
  failed: "\u7ffb\u8bd1\u6682\u65f6\u4e0d\u53ef\u7528 / Tradu\u00e7\u00e3o indispon\u00edvel no momento",
  noHistory: "\u8fd8\u6ca1\u6709\u5386\u53f2\u8bb0\u5f55 / Ainda sem hist\u00f3rico.",
  noExamples: "\u6682\u65e0\u4f8b\u53e5 / Sem exemplos por enquanto.",
  placeholder: "\u8f93\u5165\u5355\u8bcd\u6216\u53e5\u5b50",
  platform: "\u5e73\u53f0 / Plataforma",
  model: "\u6a21\u578b\u540d\u79f0 / Nome do modelo",
  editModels: "\u7f16\u8f91\u6a21\u578b / Editar modelos",
  editProvider: "\u4f9b\u5e94\u5546 / Provedor",
  modelList: "\u6a21\u578b\u5217\u8868 / Lista de modelos",
  addModel: "\u6dfb\u52a0 / Adicionar",
  resetModelList: "\u6062\u590d\u9ed8\u8ba4 / Restaurar",
  modelListSaved: "\u6a21\u578b\u5217\u8868\u5df2\u4fdd\u5b58 / Lista salva",
  modelRemoved: "\u6a21\u578b\u5df2\u5220\u9664 / Modelo removido",
  modelRequired: "\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u6a21\u578b / Mantenha pelo menos um modelo",
  doneModelList: "\u5b8c\u6210 / Concluir",
  deleteModel: "\u5220\u9664 / Remover",
  saveModel: "\u4fee\u6539 / Salvar",
  verifyModel: "\u9a8c\u8bc1 / Verificar",
  saved: "\u5df2\u4fdd\u5b58 / Salvo",
  verifying: "\u9a8c\u8bc1\u4e2d / Verificando...",
  verified: "\u6a21\u578b\u53ef\u7528 / Modelo dispon\u00edvel",
  verifyFailed: "\u9a8c\u8bc1\u5931\u8d25 / Falha na verifica\u00e7\u00e3o",
  saveFailed: "\u4fdd\u5b58\u5931\u8d25 / Falha ao salvar",
  darkToLight: "\u5207\u6362\u5230\u6d45\u8272\u6a21\u5f0f / Mudar para modo claro",
  lightToDark: "\u5207\u6362\u5230\u6df1\u8272\u6a21\u5f0f / Mudar para modo escuro",
  speak: "\u6717\u8bfb / Ouvir",
  dictionarySyncing: "\u8bcd\u5178\u540c\u6b65\u4e2d / Sincronizando",
  dictionaryAdded: "\u5df2\u6dfb\u52a0\u5355\u8bcd / Palavras adicionadas",
  dictionaryUnavailable: "\u8bcd\u5178\u72b6\u6001\u672a\u77e5 / Dicion\u00e1rio indispon\u00edvel",
  providerIdle: "\u6765\u6e90 / Fonte",
  providerLoading: "\u67e5\u8be2 / Consulta",
  providerDictionary: "\u8bcd\u5178 / Dicion\u00e1rio",
  providerOpenRouter: "OpenRouter",
  providerDashScope: "DashScope",
  providerGemini: "Gemini",
  providerDeepSeek: "DeepSeek",
  providerAuto: "AI",
  deleteHistory: "\u5220\u9664 / Remover"
};

const elements = {
  textInput: document.querySelector("#textInput"),
  inputLabel: document.querySelector("#inputLabel"),
  translateButton: document.querySelector("#translateButton"),
  clearButton: document.querySelector("#clearButton"),
  actionBar: document.querySelector(".action-bar"),
  settingsButton: document.querySelector("#settingsButton"),
  themeToggleButton: document.querySelector("#themeToggleButton"),
  settingsOverlay: document.querySelector("#settingsOverlay"),
  settingsPanel: document.querySelector("#settingsPanel"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  providerSelect: document.querySelector("#providerSelect"),
  modelSelect: document.querySelector("#modelSelect"),
  editModelListButton: document.querySelector("#editModelListButton"),
  modelEditorOverlay: document.querySelector("#modelEditorOverlay"),
  modelEditorPanel: document.querySelector("#modelEditorPanel"),
  closeModelEditorButton: document.querySelector("#closeModelEditorButton"),
  editProviderSelect: document.querySelector("#editProviderSelect"),
  modelItemsList: document.querySelector("#modelItemsList"),
  newModelInput: document.querySelector("#newModelInput"),
  addModelButton: document.querySelector("#addModelButton"),
  resetModelListButton: document.querySelector("#resetModelListButton"),
  doneModelListButton: document.querySelector("#doneModelListButton"),
  saveModelButton: document.querySelector("#saveModelButton"),
  verifyModelButton: document.querySelector("#verifyModelButton"),
  modelStatus: document.querySelector("#modelStatus"),
  dictionaryStats: document.querySelector("#dictionaryStats"),
  clearHistoryButton: document.querySelector("#clearHistoryButton"),
  resultCard: document.querySelector("#resultCard"),
  modeBadge: document.querySelector("#modeBadge"),
  providerBadge: document.querySelector("#providerBadge"),
  statusText: document.querySelector("#statusText"),
  resultLanguageTabs: document.querySelector("#resultLanguageTabs"),
  translationCard: document.querySelector("#translationCard"),
  examplesWrap: document.querySelector("#examplesWrap"),
  examplesList: document.querySelector("#examplesList"),
  wordDetailsWrap: document.querySelector("#wordDetailsWrap"),
  wordDetailsList: document.querySelector("#wordDetailsList"),
  sentenceExplainWrap: document.querySelector("#sentenceExplainWrap"),
  sentenceExplainText: document.querySelector("#sentenceExplainText"),
  historyList: document.querySelector("#historyList"),
  i18nNodes: Array.from(document.querySelectorAll("[data-i18n]"))
};

let selectedResultLang = "en";
let latestResultData = null;
let latestResultText = "";
let latestDetectedLang = "en";
let settings = readSettings();
let settingsCloseTimer = 0;
let modelEditorCloseTimer = 0;
let keyboardScrollTimer = 0;
let systemThemeQuery = null;
let typewriterRunId = 0;

bootstrap();

function bootstrap() {
  renderResultLanguageTabs();

  elements.settingsButton.addEventListener("click", openSettings);
  elements.themeToggleButton.addEventListener("click", toggleTheme);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.settingsOverlay.addEventListener("click", (event) => {
    if (event.target === elements.settingsOverlay) {
      closeSettings();
    }
  });
  elements.modelEditorOverlay.addEventListener("click", (event) => {
    if (event.target === elements.modelEditorOverlay) {
      closeModelEditor();
    }
  });
  document.addEventListener(
    "click",
    (event) => {
      const isOpen = !elements.settingsOverlay.classList.contains("hidden");
      const editorOpen = !elements.modelEditorOverlay.classList.contains("hidden");
      if (editorOpen) {
        return;
      }
      if (
        isOpen &&
        !elements.settingsPanel.contains(event.target) &&
        event.target !== elements.settingsButton
      ) {
        closeSettings();
      }
    },
    true
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!elements.modelEditorOverlay.classList.contains("hidden")) {
        closeModelEditor();
      } else {
        closeSettings();
      }
    }
  });

  elements.providerSelect.addEventListener("change", () => {
    settings.provider = elements.providerSelect.value;
    settings.model = getModelsForProvider(settings.provider)[0] || DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.auto;
    renderModelSelect();
    saveSettings();
  });

  elements.modelSelect.addEventListener("change", () => {
    settings.model = elements.modelSelect.value.trim();
    saveSettings();
  });
  elements.editModelListButton.addEventListener("click", openModelEditor);
  elements.closeModelEditorButton.addEventListener("click", closeModelEditor);
  elements.doneModelListButton.addEventListener("click", closeModelEditor);
  elements.editProviderSelect.addEventListener("change", renderModelItems);
  elements.modelItemsList.addEventListener("change", onModelItemChange);
  elements.modelItemsList.addEventListener("click", onModelItemClick);
  elements.addModelButton.addEventListener("click", addModelItem);
  elements.newModelInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addModelItem();
    }
  });
  elements.resetModelListButton.addEventListener("click", resetModelList);
  elements.saveModelButton.addEventListener("click", saveModelSetting);
  elements.verifyModelButton.addEventListener("click", verifyModelSetting);

  elements.translateButton.addEventListener("click", onTranslate);
  elements.clearButton.addEventListener("click", () => {
    elements.textInput.value = "";
    elements.textInput.focus();
    applyTextState();
    pulse(elements.clearButton);
  });
  elements.clearHistoryButton.addEventListener("click", () => {
    localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    pulse(elements.clearHistoryButton);
  });
  elements.textInput.addEventListener("input", applyTextState);
  elements.textInput.addEventListener("focus", () => {
    updateKeyboardLift();
    if (!document.body.classList.contains("has-result")) {
      scheduleKeyboardScroll(220);
    }
  });
  elements.textInput.addEventListener("blur", () => {
    setInputLift(0);
    document.body.classList.remove("keyboard-active");
    window.clearTimeout(keyboardScrollTimer);
    window.setTimeout(updateKeyboardLift, 180);
  });
  elements.textInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onTranslate();
    }
  });
  window.addEventListener("resize", syncDesktopIdleClass);

  applyStaticText();
  setupSystemThemeListener();
  applySettings();
  setupKeyboardLift();
  lockEmptyPageScroll();
  settleInitialAnimations();
  autoResizeInput();
  renderHistory();
  renderIdleResult();
  registerServiceWorker();
  scheduleStartupNetworkTasks();
}

function scheduleStartupNetworkTasks() {
  const run = () => {
    loadRemoteModels();
    loadRemoteSettings();
    loadDictionaryStats();
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(run, { timeout: 1200 });
    return;
  }

  window.setTimeout(run, 700);
}

function settleInitialAnimations() {
  window.setTimeout(() => {
    document.querySelectorAll(".enter").forEach((node) => {
      node.classList.add("settled");
    });
  }, 620);
}

function lockEmptyPageScroll() {
  document.addEventListener(
    "touchmove",
    (event) => {
      const hasResult = !elements.resultCard.classList.contains("hidden");
      const settingsOpen = !elements.settingsOverlay.classList.contains("hidden");
      const interactive = event.target.closest("textarea, input, select, button");

      if (hasResult || settingsOpen || interactive) {
        return;
      }

      event.preventDefault();
    },
    { passive: false }
  );
}

function setupKeyboardLift() {
  window.visualViewport?.addEventListener("resize", updateKeyboardLift);
  window.visualViewport?.addEventListener("scroll", updateKeyboardLift);
  window.addEventListener("orientationchange", () => {
    window.setTimeout(updateKeyboardLift, 240);
  });
}

function updateKeyboardLift() {
  const isInputFocused = document.activeElement === elements.textInput;
  const isMobileWidth = window.matchMedia("(max-width: 560px)").matches;
  const hasResult = document.body.classList.contains("has-result");
  const visualViewport = window.visualViewport;
  const keyboardLikelyOpen =
    visualViewport && window.innerHeight - visualViewport.height > 120;
  const shouldLift = isInputFocused && isMobileWidth && keyboardLikelyOpen && !hasResult;

  document.body.classList.toggle("keyboard-active", shouldLift);
  if (shouldLift) {
    scheduleKeyboardScroll(80);
  } else {
    setInputLift(0);
  }
}

function scheduleKeyboardScroll(delay = 80) {
  window.clearTimeout(keyboardScrollTimer);
  keyboardScrollTimer = window.setTimeout(scrollFocusedInputIntoView, delay);
}

function scrollFocusedInputIntoView() {
  const isInputFocused = document.activeElement === elements.textInput;
  const isMobileWidth = window.matchMedia("(max-width: 560px)").matches;
  const hasResult = document.body.classList.contains("has-result");

  if (!isInputFocused || !isMobileWidth || hasResult) {
    return;
  }

  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height || window.innerHeight;
  const safeTop = 10;
  const safeBottom = viewportHeight - 18;
  const inputRect = elements.textInput.getBoundingClientRect();
  const actionRect = elements.actionBar?.getBoundingClientRect() || inputRect;
  const overflowBottom = actionRect.bottom - safeBottom;
  const overflowTop = safeTop - inputRect.top;

  if (overflowBottom > 4) {
    window.scrollBy({
      top: overflowBottom + 12,
      behavior: "smooth"
    });
  } else if (overflowTop > 4) {
    window.scrollBy({
      top: -(overflowTop + 12),
      behavior: "smooth"
    });
  }
}

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const theme =
      stored.themeSettingsVersion === THEME_SETTINGS_VERSION
        ? normalizeTheme(stored.theme)
        : "system";
    return {
      provider: "auto",
      model: DEFAULT_MODELS.auto,
      ...stored,
      modelOptions: normalizeModelOptions(
        stored.modelOptionsVersion === MODEL_OPTIONS_VERSION ? stored.modelOptions : {}
      ),
      modelOptionsVersion: MODEL_OPTIONS_VERSION,
      theme,
      themeSettingsVersion: THEME_SETTINGS_VERSION
    };
  } catch {
    return {
      provider: "auto",
      model: DEFAULT_MODELS.auto,
      modelOptions: normalizeModelOptions(),
      modelOptionsVersion: MODEL_OPTIONS_VERSION,
      theme: "system",
      themeSettingsVersion: THEME_SETTINGS_VERSION
    };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

async function loadRemoteSettings() {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (data.model) {
      settings.provider = data.provider || settings.provider;
      settings.model = data.model;
      saveSettings();
      applySettings();
    }
  } catch {
    // Local settings still work when backend settings are unavailable.
  }
}

async function loadRemoteModels() {
  try {
    const response = await fetch("/api/models", { cache: "no-store" });
    if (!response.ok) {
      return;
    }

    const data = await response.json();
    const remoteVersion = Number(data.version || 0);
    for (const provider of PROVIDERS) {
      const defaultModel = String(data.defaults?.[provider] || "").trim();
      if (defaultModel) {
        DEFAULT_MODELS[provider] = defaultModel;
      }

      const models = uniqueModels(data.options?.[provider] || []);
      if (models.length) {
        DEFAULT_MODEL_OPTIONS[provider] = models;
      }
    }

    const shouldRefreshOptions =
      remoteVersion && remoteVersion > Number(settings.modelOptionsVersion || 0);
    settings.modelOptions = normalizeModelOptions(
      shouldRefreshOptions ? {} : settings.modelOptions
    );
    settings.modelOptionsVersion = MODEL_OPTIONS_VERSION;

    const models = getModelsForProvider(settings.provider);
    if (!models.includes(settings.model)) {
      settings.model = models[0] || DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.auto;
    }

    saveSettings();
    renderModelSelect();
    if (!elements.modelEditorOverlay.classList.contains("hidden")) {
      renderModelItems();
    }
  } catch {
    // Built-in model options remain available when the backend catalog is unavailable.
  }
}

function normalizeModelOptions(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    PROVIDERS.map((provider) => {
      const defaults = DEFAULT_MODEL_OPTIONS[provider] || [DEFAULT_MODELS[provider]].filter(Boolean);
      const models = Array.isArray(source[provider])
        ? uniqueModels(source[provider])
        : uniqueModels(defaults);
      return [provider, models.length ? models : [DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto]];
    })
  );
}

function uniqueModels(models) {
  const seen = new Set();
  return models
    .map((model) => String(model || "").trim())
    .filter(Boolean)
    .filter((model) => {
      const key = model.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function getModelsForProvider(provider) {
  settings.modelOptions = normalizeModelOptions(settings.modelOptions);
  return settings.modelOptions[provider] || DEFAULT_MODEL_OPTIONS[provider] || [DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto];
}

function getSelectedModel() {
  return elements.modelSelect.value.trim() || getModelsForProvider(settings.provider)[0] || DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.auto;
}

function renderModelSelect() {
  const provider = PROVIDERS.includes(settings.provider) ? settings.provider : "auto";
  const models = [...getModelsForProvider(provider)];
  if (settings.model && !models.includes(settings.model)) {
    models.unshift(settings.model);
    settings.modelOptions[provider] = uniqueModels(models);
  }
  if (!models.includes(settings.model)) {
    settings.model = models[0] || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  }
  elements.modelSelect.innerHTML = models
    .map((model) => `<option value="${escapeAttribute(model)}">${escapeHtml(model)}</option>`)
    .join("");
  elements.modelSelect.value = settings.model;
}

function renderEditProviderSelect() {
  const labels = {
    openrouter: "OpenRouter",
    dashscope: "阿里云百炼 / Alibaba Cloud Bailian",
    gemini: "Gemini",
    deepseek: "DeepSeek"
  };
  elements.editProviderSelect.innerHTML = EDITABLE_PROVIDERS.map(
    (provider) => `<option value="${escapeAttribute(provider)}">${escapeHtml(labels[provider] || provider)}</option>`
  ).join("");
  elements.editProviderSelect.value = EDITABLE_PROVIDERS.includes(settings.provider)
    ? settings.provider
    : EDITABLE_PROVIDERS[0];
}

function openModelEditor() {
  if (elements.modelEditorOverlay.parentElement !== document.body) {
    document.body.appendChild(elements.modelEditorOverlay);
  }
  window.clearTimeout(modelEditorCloseTimer);
  elements.modelEditorOverlay.classList.remove("closing");
  elements.modelEditorOverlay.classList.remove("hidden");
  elements.modelEditorOverlay.setAttribute("aria-hidden", "false");
  renderEditProviderSelect();
  renderModelItems();
  pulse(elements.editModelListButton);
  requestAnimationFrame(() => elements.newModelInput.focus());
}

function closeModelEditor() {
  if (elements.modelEditorOverlay.classList.contains("hidden")) {
    return;
  }
  if (!commitModelItemEdits()) {
    return;
  }
  elements.modelEditorOverlay.classList.add("closing");
  elements.modelEditorOverlay.setAttribute("aria-hidden", "true");
  window.clearTimeout(modelEditorCloseTimer);
  modelEditorCloseTimer = window.setTimeout(() => {
    elements.modelEditorOverlay.classList.add("hidden");
    elements.modelEditorOverlay.classList.remove("closing");
  }, 170);
}

function renderModelItems() {
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  const models = getModelsForProvider(provider);
  elements.modelItemsList.innerHTML = models
    .map(
      (model, index) => `
        <div class="model-item-row" data-index="${index}">
          <input class="model-item-input" type="text" value="${escapeAttribute(model)}" autocomplete="off" spellcheck="false" />
          <button class="model-item-delete" type="button" data-index="${index}" aria-label="${escapeAttribute(t("deleteModel"))}" title="${escapeAttribute(t("deleteModel"))}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v5" />
              <path d="M14 11v5" />
            </svg>
          </button>
        </div>
      `
    )
    .join("");
}

function saveProviderModels(provider, models, statusText = t("modelListSaved")) {
  const nextModels = uniqueModels(models);
  if (!nextModels.length) {
    elements.modelStatus.className = "model-status err";
    elements.modelStatus.textContent = t("modelRequired");
    return false;
  }

  settings.modelOptions = normalizeModelOptions({
    ...settings.modelOptions,
    [provider]: nextModels
  });
  settings.modelOptionsVersion = MODEL_OPTIONS_VERSION;
  if (settings.provider === provider) {
    settings.model = settings.modelOptions[provider].includes(settings.model)
      ? settings.model
      : settings.modelOptions[provider][0];
    renderModelSelect();
  }
  saveSettings();
  elements.modelStatus.className = "model-status ok";
  elements.modelStatus.textContent = statusText;
  return true;
}

function commitModelItemEdits({ render = false } = {}) {
  if (elements.modelEditorOverlay.classList.contains("hidden")) {
    return true;
  }
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  const inputs = [...elements.modelItemsList.querySelectorAll(".model-item-input")];
  if (!inputs.length) {
    return true;
  }
  const models = inputs.map((input) => input.value.trim());
  const saved = saveProviderModels(provider, models);
  if (saved && render) {
    renderModelItems();
  }
  return saved;
}

function onModelItemChange(event) {
  const input = event.target.closest(".model-item-input");
  if (!input) return;
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  const index = Number(input.closest(".model-item-row")?.dataset.index);
  const models = [...getModelsForProvider(provider)];
  const value = input.value.trim();
  if (!Number.isInteger(index) || index < 0 || index >= models.length) return;
  if (!value) {
    input.value = models[index] || "";
    return;
  }
  models[index] = value;
  if (saveProviderModels(provider, models)) {
    renderModelItems();
  }
}

function onModelItemClick(event) {
  const button = event.target.closest(".model-item-delete");
  if (!button) return;
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  const models = [...getModelsForProvider(provider)];
  if (models.length <= 1) {
    elements.modelStatus.className = "model-status err";
    elements.modelStatus.textContent = t("modelRequired");
    return;
  }
  const index = Number(button.dataset.index);
  if (!Number.isInteger(index) || index < 0 || index >= models.length) return;
  models.splice(index, 1);
  if (saveProviderModels(provider, models, t("modelRemoved"))) {
    renderModelItems();
  }
}

function addModelItem() {
  if (!commitModelItemEdits()) {
    return;
  }
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  const value = elements.newModelInput.value.trim();
  if (!value) {
    elements.newModelInput.focus();
    return;
  }
  const models = [...getModelsForProvider(provider), value];
  if (saveProviderModels(provider, models)) {
    elements.newModelInput.value = "";
    renderModelItems();
    requestAnimationFrame(() => elements.newModelInput.focus());
    pulse(elements.addModelButton);
  }
}

function resetModelList() {
  const provider = elements.editProviderSelect.value || EDITABLE_PROVIDERS[0];
  if (
    saveProviderModels(
      provider,
      DEFAULT_MODEL_OPTIONS[provider] || [DEFAULT_MODELS[provider]],
      t("modelListSaved")
    )
  ) {
    renderModelItems();
    pulse(elements.resetModelListButton);
  }
}

function saveModelSetting() {
  settings.provider = elements.providerSelect.value;
  settings.model = getSelectedModel();
  renderModelSelect();
  saveSettings();
  elements.modelStatus.className = "model-status ok";
  elements.modelStatus.textContent = `${t("saved")}...`;
  pulse(elements.saveModelButton);
  fetch("/api/settings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: settings.provider,
      model: settings.model
    })
  })
    .then((response) =>
      response.json().then((data) => {
        if (!response.ok) {
          throw new Error(data.error || "error");
        }
        settings.provider = data.provider || settings.provider;
        settings.model = data.model || settings.model;
        saveSettings();
        applySettings();
        elements.modelStatus.className = "model-status ok";
        elements.modelStatus.textContent = `${t("saved")}：${settings.model}`;
      })
    )
    .catch((error) => {
      elements.modelStatus.className = "model-status err";
      elements.modelStatus.textContent = `${t("saveFailed")}：${
        error instanceof Error ? error.message : "error"
      }`;
    });
}

async function verifyModelSetting() {
  settings.provider = elements.providerSelect.value;
  settings.model = getSelectedModel();
  renderModelSelect();
  saveSettings();
  elements.verifyModelButton.disabled = true;
  elements.modelStatus.className = "model-status";
  elements.modelStatus.textContent = t("verifying");

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello",
        source_lang: "auto",
        target_lang: selectedResultLang,
        provider: settings.provider,
        model: settings.model
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "error");
    }
    elements.modelStatus.className = "model-status ok";
    elements.modelStatus.textContent = `${t("verified")}：${
      data.provider || settings.provider
    } / ${data.model || settings.model}`;
  } catch (error) {
    elements.modelStatus.className = "model-status err";
    elements.modelStatus.textContent = `${t("verifyFailed")}：${
      error instanceof Error ? error.message : "error"
    }`;
  } finally {
    elements.verifyModelButton.disabled = false;
  }
}

function openSettings() {
  if (elements.settingsOverlay.parentElement !== document.body) {
    document.body.appendChild(elements.settingsOverlay);
  }
  window.clearTimeout(settingsCloseTimer);
  elements.settingsOverlay.classList.remove("closing");
  elements.settingsOverlay.classList.remove("hidden");
  elements.settingsOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  pulse(elements.settingsButton);
  loadDictionaryStats();
  if (window.matchMedia("(min-width: 700px)").matches) {
    requestAnimationFrame(() => elements.modelSelect.focus());
  }
}

async function loadDictionaryStats() {
  if (!elements.dictionaryStats) {
    return;
  }

  elements.dictionaryStats.textContent = t("dictionarySyncing");

  try {
    const response = await fetch("/api/dictionary/stats");
    const data = await response.json();
    const count = Number(data.accepted_words);
    if (!response.ok || !Number.isFinite(count)) {
      throw new Error("unavailable");
    }
    elements.dictionaryStats.textContent = `${t("dictionaryAdded")}: ${count.toLocaleString()}`;
  } catch {
    elements.dictionaryStats.textContent = t("dictionaryUnavailable");
  }
}

function closeSettings() {
  if (elements.settingsOverlay.classList.contains("hidden")) {
    return;
  }
  elements.settingsOverlay.classList.add("closing");
  elements.settingsOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  window.clearTimeout(settingsCloseTimer);
  settingsCloseTimer = window.setTimeout(() => {
    elements.settingsOverlay.classList.add("hidden");
    elements.settingsOverlay.classList.remove("closing");
  }, 170);
}

function toggleTheme() {
  settings.theme =
    settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system";
  settings.themeSettingsVersion = THEME_SETTINGS_VERSION;
  applySettings();
  saveSettings();
  pulse(elements.themeToggleButton);
}

function normalizeTheme(theme) {
  return ["system", "light", "dark"].includes(theme) ? theme : "system";
}

function getSystemTheme() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getResolvedTheme() {
  settings.theme = normalizeTheme(settings.theme);
  return settings.theme === "system" ? getSystemTheme() : settings.theme;
}

function setupSystemThemeListener() {
  if (!window.matchMedia) {
    return;
  }
  systemThemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (settings.theme === "system") {
      applySettings();
    }
  };
  if (systemThemeQuery.addEventListener) {
    systemThemeQuery.addEventListener("change", onChange);
  } else if (systemThemeQuery.addListener) {
    systemThemeQuery.addListener(onChange);
  }
  window.addEventListener("pageshow", onChange);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      onChange();
    }
  });
}

function applySettings() {
  const provider = PROVIDERS.includes(settings.provider)
    ? settings.provider
    : "auto";
  settings.provider = provider;
  settings.modelOptions = normalizeModelOptions(settings.modelOptions);
  settings.model = settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  elements.providerSelect.value = settings.provider;
  renderModelSelect();

  const isDark = getResolvedTheme() === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.documentElement.dataset.themePreference = settings.theme;
  elements.themeToggleButton.setAttribute(
    "aria-label",
    settings.theme === "system"
      ? "跟随系统 / Seguir sistema"
      : isDark
        ? t("darkToLight")
        : t("lightToDark")
  );
  elements.themeToggleButton.setAttribute("title", elements.themeToggleButton.getAttribute("aria-label"));
  const pageBg = isDark ? "#060606" : "#ffffff";
  document.documentElement.style.backgroundColor = pageBg;
  document.body.style.backgroundColor = pageBg;
  document.querySelectorAll("meta[name='theme-color']").forEach((node) => {
    node.setAttribute("content", pageBg);
  });
  void document.body.offsetHeight;
}

function applyStaticText() {
  document.documentElement.lang = "zh-CN";
  elements.i18nNodes.forEach((node) => {
    applyBilingualText(node, t(node.dataset.i18n));
  });
  elements.textInput.placeholder = t("placeholder");
  applyTextState();
}

function applyBilingualText(node, text) {
  const parts = String(text).split(" / ");
  if (parts.length !== 2 || !node.closest("button")) {
    node.textContent = text;
    return;
  }

  node.innerHTML = `
    <span class="button-lang-primary">${escapeHtml(parts[0])}</span>
    <span class="button-lang-secondary">${escapeHtml(parts[1])}</span>
  `;
}

async function onTranslate() {
  const text = elements.textInput.value.trim();
  pulse(elements.translateButton);

  if (!text) {
    updateStatus(t("empty"), t("ready"));
    return;
  }

  closeSettings();
  elements.textInput.blur();
  settings.model = getSelectedModel();
  saveSettings();
  setLoading(true);
  updateStatus(t("translating"), "...");
  latestResultData = null;
  renderLoadingResult();
  const payload = {
    text,
    source_lang: "auto",
    target_lang: selectedResultLang,
    provider: settings.provider,
    model: settings.model
  };

  try {
    const result = await translateWithProgress(payload);
    const data = result.data;
    if (!result.rendered) {
      renderResult(data);
    }
    saveHistory(data);
    renderHistory();
  } catch (error) {
    renderErrorResult(error instanceof Error ? error.message : t("failed"));
  } finally {
    setLoading(false);
  }
}

async function translateWithProgress(payload) {
  if (!window.ReadableStream) {
    return { data: await translateOnce(payload), rendered: false };
  }

  let partialRendered = false;

  try {
    const response = await fetch("/api/translate-stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.body) {
      return { data: await translateOnce(payload), rendered: false };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;
    let finalRendered = false;

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const message = JSON.parse(trimmed);
        if (message.event === "delta" && message.data) {
          partialRendered = true;
          renderStreamingPreview(message.data);
        } else if (message.event === "partial" && message.data) {
          partialRendered = true;
          renderPartialResult(message.data);
        } else if (message.event === "final" && message.data) {
          finalData = message.data;
          renderFinalResultIncrementally(finalData, partialRendered);
          finalRendered = true;
        } else if (message.event === "error") {
          throw new Error(message.data?.error || t("failed"));
        }
      }

      if (done) break;
    }

    if (buffer.trim()) {
      const message = JSON.parse(buffer.trim());
      if (message.event === "final" && message.data) {
        finalData = message.data;
        renderFinalResultIncrementally(finalData, partialRendered);
        finalRendered = true;
      } else if (message.event === "error") {
        throw new Error(message.data?.error || t("failed"));
      }
    }

    if (!finalData) {
      throw new Error(t("failed"));
    }

    return { data: finalData, rendered: finalRendered };
  } catch (error) {
    if (partialRendered) {
      throw error;
    }
    return { data: await translateOnce(payload), rendered: false };
  }
}

async function translateOnce(payload) {
  const response = await fetch("/api/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || t("failed"));
  }

  return data;
}

function renderPartialResult(data) {
  renderResult({ ...data, cached: false }, { typewriter: true });
  elements.resultCard.setAttribute("aria-busy", "true");
  updateStatus(t("translating"), "...");
  updateProviderBadge(data.provider);
}

function renderStreamingPreview(data) {
  const previewData = { ...data, cached: false };
  if (!latestResultData || latestResultData.original !== previewData.original) {
    renderResult(previewData);
  } else {
    latestResultData = previewData;
    latestResultText = getSelectedTranslation(previewData);
    updateTranslationCardStreaming(previewData);
    updateSentenceExplanationIncrementally(previewData);
  }
  elements.resultCard.setAttribute("aria-busy", "true");
  updateStatus(t("translating"), "...");
  updateProviderBadge(previewData.provider);
}

function renderFinalResultIncrementally(data, hasPartial) {
  if (!hasPartial || !latestResultData) {
    renderResult(data);
    return;
  }

  latestResultData = data;
  latestResultText = getSelectedTranslation(data);
  latestDetectedLang = data.detected_source_lang || latestDetectedLang || "en";
  elements.resultCard.setAttribute("aria-busy", "false");
  updateProviderBadge(data.provider);
  updateTranslationCardIncrementally(data, { typewriter: true });

  if (data.type === "word") {
    elements.wordDetailsWrap.classList.remove("hidden");
    elements.examplesWrap.classList.remove("hidden");
    elements.sentenceExplainWrap.classList.add("hidden");
    renderLanguageScopedSections(data);
    updateStatus(data.cached ? t("cached") : t("live"), t("word"));
    return;
  }

  elements.wordDetailsWrap.classList.add("hidden");
  elements.examplesWrap.classList.add("hidden");
  elements.sentenceExplainWrap.classList.remove("hidden");
  elements.wordDetailsList.innerHTML = "";
  elements.examplesList.innerHTML = "";
  updateSentenceExplanationIncrementally(data, { typewriter: true });
  updateStatus(data.cached ? t("cached") : t("live"), t("sentence"));
}

function updateTranslationCardIncrementally(data, options = {}) {
  const text = getSelectedTranslation(data);
  const item = getLocalized(data.translations || {}, selectedResultLang);
  const phonetic = item.phonetic || "";
  const line = elements.translationCard.querySelector(".compact-line.single");
  const strong = line?.querySelector("strong");
  const detailWrap = line?.querySelector("div");
  const button = line?.querySelector(".line-speak");

  if (!line || !strong || !detailWrap || !button) {
    renderTranslationCard(data);
    return;
  }

  const nextTextHtml = formatPronunciationText(text || "-", selectedResultLang);
  if (options.typewriter && text && stripHtml(strong.innerHTML) !== text) {
    runTypewriter(strong, text, () => {
      strong.innerHTML = formatPronunciationText(text, selectedResultLang);
    });
  } else if (strong.innerHTML !== nextTextHtml) {
    strong.innerHTML = nextTextHtml;
  }

  let phoneticNode = detailWrap.querySelector("span");
  if (phonetic) {
    if (!phoneticNode) {
      phoneticNode = document.createElement("span");
      detailWrap.appendChild(phoneticNode);
    }
    if (phoneticNode.textContent !== phonetic) {
      phoneticNode.textContent = phonetic;
    }
  } else {
    phoneticNode?.remove();
  }

  button.dataset.speakText = item.audio_text || text;
  button.dataset.speakLang = selectedResultLang;
}

function updateTranslationCardStreaming(data) {
  const text = getSelectedTranslation(data);
  const item = getLocalized(data.translations || {}, selectedResultLang);
  const displayText = text || getPendingTranslationText(data);
  const line = elements.translationCard.querySelector(".compact-line.single");
  const strong = line?.querySelector("strong");
  const detailWrap = line?.querySelector("div");
  const button = line?.querySelector(".line-speak");

  if (!line || !strong || !detailWrap || !button) {
    renderTranslationCard(data);
    return;
  }

  typewriterRunId += 1;
  strong.textContent = displayText || "-";
  detailWrap.querySelector("span")?.remove();
  button.dataset.speakText = item.audio_text || text;
  button.dataset.speakLang = selectedResultLang;
}

function updateSentenceExplanationIncrementally(data, options = {}) {
  const explanation = getSelectedSentenceExplanation(data);
  if (options.typewriter && explanation && elements.sentenceExplainText.textContent !== explanation) {
    runTypewriter(elements.sentenceExplainText, explanation);
  } else if (elements.sentenceExplainText.textContent !== explanation) {
    elements.sentenceExplainText.textContent = explanation;
  }
}

function renderLoadingResult() {
  setInputLift(0);
  document.body.classList.remove("keyboard-active");
  document.body.classList.add("has-result");
  document.body.classList.remove("has-desktop-idle");
  elements.resultCard.classList.remove("desktop-idle");
  elements.resultCard.classList.remove("hidden", "reveal");
  elements.resultCard.scrollTop = 0;
  elements.resultCard.setAttribute("aria-busy", "true");
  void elements.resultCard.offsetWidth;
  elements.resultCard.classList.add("reveal");
  updateStatus(t("translating"), "...");
  updateProviderBadge("loading");
  renderResultLanguageTabs();
  elements.translationCard.innerHTML = `
    <div class="loading-loop" aria-hidden="true">
      <div class="loading-bubbles">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <p>${escapeHtml(t("translating"))}</p>
    </div>
  `;
  elements.wordDetailsWrap.classList.add("hidden");
  elements.examplesWrap.classList.add("hidden");
  elements.sentenceExplainWrap.classList.add("hidden");
  elements.wordDetailsList.innerHTML = "";
  elements.examplesList.innerHTML = "";
  elements.sentenceExplainText.textContent = "";
}

function renderIdleResult() {
  elements.resultCard.classList.add("desktop-idle");
  syncDesktopIdleClass();
  elements.resultCard.scrollTop = 0;
  elements.resultCard.setAttribute("aria-busy", "false");
  updateStatus("", t("ready"));
  updateProviderBadge("");
  renderResultLanguageTabs();
  elements.translationCard.innerHTML = `
    <div class="idle-loop" aria-hidden="true">
      <div class="idle-orbit">
        <span>EN</span>
        <span>PT</span>
        <span>中</span>
        <span>日</span>
      </div>
    </div>
  `;
  elements.resultCard.dataset.idleMessage = t("waiting");
  elements.wordDetailsWrap.classList.add("hidden");
  elements.examplesWrap.classList.add("hidden");
  elements.sentenceExplainWrap.classList.add("hidden");
}

function syncDesktopIdleClass() {
  const isDesktop = window.matchMedia("(min-width: 960px)").matches;
  const isIdle = elements.resultCard.classList.contains("desktop-idle");
  document.body.classList.toggle("has-desktop-idle", isDesktop && isIdle);
}

function renderErrorResult(message) {
  document.body.classList.add("has-result");
  document.body.classList.remove("has-desktop-idle");
  elements.resultCard.classList.remove("desktop-idle");
  elements.resultCard.classList.remove("hidden", "reveal");
  elements.resultCard.scrollTop = 0;
  elements.resultCard.setAttribute("aria-busy", "false");
  void elements.resultCard.offsetWidth;
  elements.resultCard.classList.add("reveal");
  updateStatus(message || t("failed"), "!");
  updateProviderBadge("error");
  renderResultLanguageTabs();
  elements.translationCard.innerHTML = `
    <div class="compact-line error-panel">
      <div>
        <strong>${escapeHtml(t("failed"))}</strong>
        <span>${escapeHtml(message || t("failed"))}</span>
      </div>
    </div>
  `;
  elements.wordDetailsWrap.classList.add("hidden");
  elements.examplesWrap.classList.add("hidden");
  elements.sentenceExplainWrap.classList.add("hidden");
}

function renderResult(data, options = {}) {
  const wasLoading = elements.resultCard.getAttribute("aria-busy") === "true";
  latestResultData = data;
  latestResultText = getSelectedTranslation(data);
  latestDetectedLang = data.detected_source_lang || "en";
  setInputLift(0);
  document.body.classList.remove("keyboard-active");
  document.body.classList.add("has-result");
  document.body.classList.remove("has-desktop-idle");
  elements.resultCard.classList.remove("desktop-idle");
  elements.resultCard.setAttribute("aria-busy", "false");
  elements.resultCard.classList.remove("hidden");
  elements.resultCard.scrollTop = 0;
  if (!wasLoading) {
    elements.resultCard.classList.remove("reveal");
    void elements.resultCard.offsetWidth;
    elements.resultCard.classList.add("reveal");
  }

  renderResultLanguageTabs();
  updateProviderBadge(data.provider);
  renderTranslationCard(data, options);

  if (data.type === "word") {
    elements.wordDetailsWrap.classList.remove("hidden");
    elements.examplesWrap.classList.remove("hidden");
    elements.sentenceExplainWrap.classList.add("hidden");
    renderLanguageScopedSections(data);
    updateStatus(data.cached ? t("cached") : t("live"), t("word"));
  } else {
    elements.wordDetailsWrap.classList.add("hidden");
    elements.examplesWrap.classList.add("hidden");
    elements.sentenceExplainWrap.classList.remove("hidden");
    elements.wordDetailsList.innerHTML = "";
    elements.examplesList.innerHTML = "";
    renderLanguageScopedSections(data);
    updateStatus(data.cached ? t("cached") : t("live"), t("sentence"));
  }

  scrollToResultWhenReady(latestResultText);
}

function scrollToResultWhenReady(resultText) {
  if (window.matchMedia("(min-width: 960px)").matches) {
    return;
  }

  if (!resultText || elements.resultCard.classList.contains("hidden")) {
    return;
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!resultText || elements.resultCard.classList.contains("hidden")) {
        return;
      }

      smartScrollTo(elements.resultCard);
    });
  });
}

function smartScrollTo(target) {
  const rect = target.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const topSafeArea = window.matchMedia("(max-width: 560px)").matches ? 12 : 18;
  const fullyVisible = rect.top >= topSafeArea && rect.bottom <= viewportHeight - 24;
  const mostlyVisible = rect.top >= topSafeArea && rect.top < viewportHeight * 0.28;

  if (fullyVisible || mostlyVisible) {
    return;
  }

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const targetTop = Math.max(0, window.scrollY + rect.top - topSafeArea);

  window.scrollTo({
    top: targetTop,
    behavior: prefersReducedMotion ? "auto" : "smooth"
  });
}

function renderResultLanguageTabs() {
  const activeIndex = Math.max(
    0,
    RESULT_LANGUAGES.findIndex((language) => language.code === selectedResultLang)
  );
  elements.resultLanguageTabs.style.setProperty("--active-tab-index", activeIndex);
  elements.resultLanguageTabs.dataset.activeIndex = String(activeIndex);
  elements.resultLanguageTabs.innerHTML = RESULT_LANGUAGES.map(
    (language) => `
      <button class="result-tab${
        language.code === selectedResultLang ? " active" : ""
      }" type="button" data-lang="${escapeAttribute(language.code)}">
        ${escapeHtml(language.label)}
      </button>
    `
  ).join("");

  elements.resultLanguageTabs.querySelectorAll(".result-tab").forEach((button) => {
    button.addEventListener("click", () => {
      selectedResultLang = button.dataset.lang || "zh";
      setResultTabState();
      if (latestResultData) {
        renderTranslationCard(latestResultData);
        renderLanguageScopedSections(latestResultData);
        latestResultText = getSelectedTranslation(latestResultData);
      }
      pulse(button);
    });
  });
}

function setResultTabState() {
  const activeIndex = Math.max(
    0,
    RESULT_LANGUAGES.findIndex((language) => language.code === selectedResultLang)
  );
  elements.resultLanguageTabs.style.setProperty("--active-tab-index", activeIndex);
  elements.resultLanguageTabs.dataset.activeIndex = String(activeIndex);
  elements.resultLanguageTabs.querySelectorAll(".result-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.lang === selectedResultLang);
  });
}

function renderTranslationCard(data, options = {}) {
  const text = getSelectedTranslation(data);
  const item = getLocalized(data.translations || {}, selectedResultLang);
  const phonetic = item.phonetic || "";
  const displayText = text || getPendingTranslationText(data);
  if (!options.typewriter) {
    typewriterRunId += 1;
  }

  animateSwap(elements.translationCard);
  elements.translationCard.innerHTML = `
    <div class="compact-line single">
      <div>
        <strong>${options.typewriter ? "" : formatPronunciationText(displayText, selectedResultLang)}</strong>
        ${phonetic ? `<span>${escapeHtml(phonetic)}</span>` : ""}
      </div>
      <button class="line-speak" type="button" data-speak-text="${escapeAttribute(
        item.audio_text || text
      )}" data-speak-lang="${escapeAttribute(selectedResultLang)}" aria-label="${t("speak")}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10v4h4l5 4V6l-5 4H4z" />
          <path d="M17 9c1.2 1.6 1.2 4.4 0 6" />
        </svg>
      </button>
    </div>
  `;

  elements.translationCard.querySelector(".line-speak")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    speak(button.dataset.speakText || "", button.dataset.speakLang || "en");
    pulse(button);
  });

  if (options.typewriter) {
    const strong = elements.translationCard.querySelector(".compact-line.single strong");
    if (text) {
      runTypewriter(strong, text, () => {
        strong.innerHTML = formatPronunciationText(text, selectedResultLang);
      });
    } else {
      strong.textContent = displayText;
    }
  }
}

function formatPronunciationText(text, lang) {
  if (lang === "ja") {
    return formatJapaneseFurigana(text);
  }
  if (lang === "en") {
    return formatEnglishKeywordPronunciation(text);
  }
  return escapeHtml(text);
}

function getPendingTranslationText(data) {
  if (data?.target_lang && selectedResultLang !== data.target_lang) {
    return t("translating");
  }
  return data?.translation || "-";
}

function runTypewriter(node, text, onDone) {
  if (!node) return;
  const value = String(text || "");
  const runId = ++typewriterRunId;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (prefersReducedMotion || value.length > 180) {
    node.textContent = value;
    onDone?.();
    return;
  }

  node.classList.add("typing-text");
  node.textContent = "";
  let index = 0;
  const step = () => {
    if (runId !== typewriterRunId) return;
    index += value.codePointAt(index) > 0xffff ? 2 : 1;
    node.textContent = value.slice(0, index);

    if (index < value.length) {
      window.setTimeout(step, getTypewriterDelay(value[index - 1]));
      return;
    }

    node.classList.remove("typing-text");
    onDone?.();
  };

  window.setTimeout(step, 18);
}

function getTypewriterDelay(char) {
  if (/[\s,.;:!?，。！？、]/u.test(char || "")) return 34;
  return 18;
}

function stripHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return template.content.textContent || "";
}

function formatJapaneseFurigana(text) {
  const readings = {
    "金曜日": "きんようび",
    "月曜日": "げつようび",
    "火曜日": "かようび",
    "水曜日": "すいようび",
    "木曜日": "もくようび",
    "土曜日": "どようび",
    "日曜日": "にちようび",
    "今日": "きょう",
    "明日": "あした",
    "昨日": "きのう",
    "朝": "あさ",
    "昼": "ひる",
    "夜": "よる",
    "確認": "かくにん",
    "更新": "こうしん",
    "修正": "しゅうせい",
    "変更": "へんこう",
    "送信": "そうしん",
    "請求書": "せいきゅうしょ",
    "番号": "ばんごう",
    "契約": "けいやく",
    "契約書": "けいやくしょ",
    "提案": "ていあん",
    "会議": "かいぎ",
    "顧客": "こきゃく",
    "取引先": "とりひきさき",
    "納期": "のうき",
    "配送": "はいそう",
    "配達": "はいたつ",
    "予定": "よてい",
    "保証": "ほしょう",
    "保証書": "ほしょうしょ",
    "発票": "はっぴょう",
    "書類": "しょるい",
    "資料": "しりょう"
  };
  const pattern = new RegExp(
    Object.keys(readings)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|"),
    "g"
  );

  return escapeHtml(text).replace(pattern, (match) => {
    const reading = readings[match];
    return reading ? `<ruby>${escapeHtml(match)}<rt>${escapeHtml(reading)}</rt></ruby>` : match;
  });
}

function formatEnglishKeywordPronunciation(text) {
  const pronunciations = {
    confirm: "kən-FURM",
    confirmed: "kən-FURMD",
    invoice: "IN-voys",
    number: "NUM-ber",
    contract: "KON-trakt",
    revised: "ri-VYZD",
    revision: "ri-VIZH-ən",
    proposal: "prə-POH-zəl",
    supplier: "sə-PLY-er",
    vendor: "VEN-der",
    delivery: "di-LIV-er-ee",
    schedule: "SKEJ-ool",
    immediately: "ih-MEE-dee-it-lee",
    warranty: "WOR-ən-tee",
    meeting: "MEE-ting",
    decision: "di-SIZH-ən",
    client: "KLY-ent",
    review: "ri-VYOO",
    document: "DOK-yoo-ment"
  };
  const words = text.match(/\b[A-Za-z][A-Za-z'-]{4,}\b/g) || [];
  const targets = [...new Set(words.map((word) => word.toLowerCase()).filter((word) => pronunciations[word]))].slice(0, 4);
  let html = escapeHtml(text);

  for (const target of targets) {
    const pattern = new RegExp(`\\b${escapeRegExp(target)}\\b`, "i");
    html = html.replace(pattern, (match) => {
      const pronunciation = pronunciations[target];
      return `<span class="keyword-pronunciation">${escapeHtml(match)}<small>${escapeHtml(pronunciation)}</small></span>`;
    });
  }

  return html;
}

function getSelectedTranslation(data) {
  const item = getLocalized(data.translations || {}, selectedResultLang);
  if (item.text) return item.text;
  if (data.target_lang && selectedResultLang === data.target_lang) {
    return data.translation || "";
  }
  return "";
}

function renderLanguageScopedSections(data) {
  if (data.type === "word") {
    renderWordDetails(data);
    renderExamples(data.examples || []);
    return;
  }

  elements.sentenceExplainText.textContent = getSelectedSentenceExplanation(data);
  elements.sentenceExplainText.classList.remove("section-appear");
  void elements.sentenceExplainText.offsetWidth;
  elements.sentenceExplainText.classList.add("section-appear");
}

function getSelectedSentenceExplanation(data) {
  const explanationSources = [
    data.explanations,
    data.sentence_explanations,
    data.localized_explanations
  ];

  for (const source of explanationSources) {
    const localized = normalizeTextValue(source?.[selectedResultLang]);
    if (localized) {
      return localized;
    }
  }

  if (data.target_lang && selectedResultLang === data.target_lang) {
    return data.explanation || data.sentence_explanation || "-";
  }

  return data.type === "sentence" ? t("translating") : "-";
}

function renderWordDetails(data) {
  const details = data.word_details || {};
  const senses = Array.isArray(data.senses) ? data.senses : [];
  const word = getSelectedTranslation(data) || details[selectedResultLang]?.word || data.translation || data.original || "";
  animateSwap(elements.wordDetailsList);

  if (senses.length) {
    elements.wordDetailsList.innerHTML = senses
      .map((sense, index) => {
        const definitions = sense.definitions || {};
        const definition = normalizeTextValue(definitions[selectedResultLang]) || normalizeTextValue(definitions.en) || "-";
        const meta = [sense.part_of_speech, sense.gloss_key].map(normalizeTextValue).filter(Boolean).join(" · ");
        return `
          <article class="word-detail-card sense-card section-appear">
            <div class="sense-card-head">
              <strong class="word-detail-title">${escapeHtml(word)}</strong>
              <span class="sense-index">${escapeHtml(String(sense.sense_order || index + 1))}</span>
            </div>
            ${meta ? `<div class="sense-meta">${escapeHtml(meta)}</div>` : ""}
            <p class="definition-text">${escapeHtml(definition)}</p>
          </article>
        `;
      })
      .join("");
    return;
  }

  const item = details[selectedResultLang] || {};
  const title = item.word && item.word !== word ? item.word : word;
  elements.wordDetailsList.innerHTML = `
    <article class="word-detail-card section-appear">
      ${title ? `<strong class="word-detail-title">${escapeHtml(title)}</strong>` : ""}
      <p class="definition-text">${escapeHtml(cleanDisplayDefinition(item.definition || "-"))}</p>
    </article>
  `;
}

function cleanDisplayDefinition(definition) {
  return normalizeTextValue(definition).replace(/\s+[-–—]\s*$/u, "").trim() || "-";
}

function renderExamples(examples) {
  animateSwap(elements.examplesList);
  if (!examples.length) {
    elements.examplesList.innerHTML = `<div class="empty-state">${t("noExamples")}</div>`;
    return;
  }

  const highlightTerms = getExampleHighlightTerms(latestResultData || {}, selectedResultLang);
  elements.examplesList.innerHTML = examples
    .map((example) => {
      const translations = example.translations || {};
      const selectedExample = normalizeTextValue(translations[selectedResultLang]) || example.sentence || "";
      return `
        <article class="example-card section-appear">
          <p class="example-source">${highlightExampleText(selectedExample, highlightTerms)}</p>
        </article>
      `;
    })
    .join("");
}

function getExampleHighlightTerms(data, lang) {
  const terms = [];
  const localized = getLocalized(data.translations || {}, lang);
  const selectedWord = localized.text || data.translation || "";
  const detailWord = data.word_details?.[lang]?.word || "";
  const detailDefinition = data.word_details?.[lang]?.definition || "";

  terms.push(selectedWord, detailWord);
  terms.push(...splitMeaningTerms(selectedWord));
  terms.push(...splitMeaningTerms(detailDefinition));
  for (const sense of Array.isArray(data.senses) ? data.senses : []) {
    terms.push(...splitMeaningTerms(sense.definitions?.[lang] || ""));
  }

  if (lang === data.detected_source_lang || lang === "en") {
    terms.push(data.original);
  }

  return uniqueHighlightTerms(terms);
}

function splitMeaningTerms(value) {
  return normalizeTextValue(value)
    .split(/[、,，;；/／|｜()（）[\]{}<>《》"“”'‘’]+/u)
    .map((term) => term.trim())
    .filter(Boolean);
}

function uniqueHighlightTerms(terms) {
  const seen = new Set();
  return terms
    .map(normalizeTextValue)
    .map((term) => term.trim())
    .filter((term) => term && isHighlightableTerm(term))
    .sort((a, b) => b.length - a.length)
    .filter((term) => {
      const key = term.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function isHighlightableTerm(term) {
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(term)) {
    return term.length >= 2;
  }
  return term.length >= 2;
}

function highlightExampleText(text, terms) {
  const source = normalizeTextValue(text);
  if (!source || !terms.length) {
    return escapeHtml(source);
  }

  const matches = [];
  for (const term of terms) {
    const flags = /[\p{Script=Latin}]/u.test(term) ? "giu" : "gu";
    const pattern = new RegExp(escapeRegExp(term), flags);
    for (const match of source.matchAll(pattern)) {
      const start = match.index ?? -1;
      const end = start + match[0].length;
      if (start < 0 || !isWholeExampleMatch(source, start, end, term)) continue;
      matches.push({ start, end });
    }
  }

  const ranges = mergeHighlightRanges(matches);
  if (!ranges.length) {
    return escapeHtml(source);
  }

  let html = "";
  let cursor = 0;
  for (const range of ranges) {
    html += escapeHtml(source.slice(cursor, range.start));
    html += `<mark class="example-hit">${escapeHtml(source.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
}

function isWholeExampleMatch(source, start, end, term) {
  if (!/^[\p{Script=Latin}][\p{Script=Latin}'-]*$/u.test(term)) {
    return true;
  }

  const before = start > 0 ? source[start - 1] : "";
  const after = end < source.length ? source[end] : "";
  return !/[\p{Script=Latin}'-]/u.test(before) && !/[\p{Script=Latin}'-]/u.test(after);
}

function mergeHighlightRanges(ranges) {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) {
      if (range.end > last.end) last.end = range.end;
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLocalized(translations, lang) {
  const item = translations?.[lang];
  if (typeof item === "string") {
    return { text: item, phonetic: "", audio_text: item };
  }
  if (item && typeof item === "object") {
    const text = normalizeTextValue(item.text);
    return {
      text,
      phonetic: lang === "pt-BR" ? "" : normalizeTextValue(item.phonetic),
      audio_text: normalizeTextValue(item.audio_text || item.text) || text
    };
  }
  return { text: "", phonetic: "", audio_text: "" };
}

function normalizeTextValue(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "object") {
    return value.text || value.translation || "";
  }
  return String(value);
}

function saveHistory(data) {
  const history = readHistory();
  const sourceKey = normalizeHistoryKey(data.original);
  const next = [
    {
      source: data.original,
      target: latestResultText,
      type: data.type,
      targetLang: selectedResultLang
    },
    ...history.filter((item) => normalizeHistoryKey(item.source) !== sourceKey)
  ].slice(0, 16);

  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function deleteHistoryItem(source) {
  const sourceKey = normalizeHistoryKey(source);
  const next = readHistory().filter((item) => normalizeHistoryKey(item.source) !== sourceKey);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}

function normalizeHistoryKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function readHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    return raw.filter((item) => {
      const key = normalizeHistoryKey(item?.source);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

function renderHistory() {
  const history = readHistory();

  if (!history.length) {
    elements.historyList.innerHTML = `<div class="empty-state">${t("noHistory")}</div>`;
    return;
  }

  elements.historyList.innerHTML = history
    .map(
      (item) => `
        <div class="history-item" data-source="${escapeAttribute(item.source)}">
          <button class="history-open-button" type="button" data-source="${escapeAttribute(
            item.source
          )}" data-lang="${escapeAttribute(item.targetLang || "zh")}">
            <p class="history-source">${escapeHtml(item.source)}</p>
            <p class="history-target">${escapeHtml(item.target)}</p>
          </button>
          <button class="history-delete-button" type="button" data-source="${escapeAttribute(
            item.source
          )}" aria-label="${escapeAttribute(t("deleteHistory"))}" title="${escapeAttribute(t("deleteHistory"))}">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v5" />
              <path d="M14 11v5" />
            </svg>
          </button>
        </div>
      `
    )
    .join("");

  for (const node of elements.historyList.querySelectorAll(".history-open-button")) {
    node.addEventListener("click", () => {
      elements.textInput.value = node.dataset.source || "";
      selectedResultLang = LANGUAGES[node.dataset.lang] ? node.dataset.lang : "zh";
      renderResultLanguageTabs();
      onTranslate();
    });
  }

  for (const node of elements.historyList.querySelectorAll(".history-delete-button")) {
    node.addEventListener("click", () => {
      deleteHistoryItem(node.dataset.source || "");
      renderHistory();
    });
  }
}

function speak(text, lang) {
  const cleanText = String(text || "")
    .replace(/https?:\/\/\S+|[\w.-]+\.(mp3|wav|ogg)/gi, "")
    .trim();
  if (!cleanText || !("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = LANGUAGES[lang]?.speech || "en-US";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function applyTextState() {
  const hasText = Boolean(elements.textInput.value.trim());
  elements.inputLabel.textContent = hasText ? t("ready") : t("input");
  elements.textInput.classList.toggle("has-text", hasText);
  autoResizeInput({ preserveActions: document.activeElement === elements.textInput });
}

function autoResizeInput({ preserveActions = false } = {}) {
  const actionBottomBefore =
    preserveActions && elements.actionBar
      ? elements.actionBar.getBoundingClientRect().bottom
      : null;
  const heightBefore = elements.textInput.getBoundingClientRect().height;

  elements.textInput.style.height = "auto";
  const nextHeight = Math.min(elements.textInput.scrollHeight, 280);
  elements.textInput.style.height = `${nextHeight}px`;
  elements.textInput.style.overflowY =
    elements.textInput.scrollHeight > 280 ? "auto" : "hidden";

  if (
    preserveActions &&
    actionBottomBefore != null &&
    nextHeight > heightBefore + 1 &&
    elements.actionBar
  ) {
    requestAnimationFrame(() => {
      const actionBottomAfter = elements.actionBar.getBoundingClientRect().bottom;
      const delta = actionBottomAfter - actionBottomBefore;
      if (delta > 1) {
        window.scrollBy({
          top: delta,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth"
        });
        requestAnimationFrame(() => {
          const remaining = elements.actionBar.getBoundingClientRect().bottom - actionBottomBefore;
          if (remaining > 1) {
            scheduleKeyboardScroll(40);
          }
        });
      }
    });
  } else if (!preserveActions || nextHeight <= 66) {
    setInputLift(0);
  }
}

function getInputLift() {
  const value = document.documentElement.style.getPropertyValue("--input-lift");
  const parsed = Number.parseFloat(value || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

function setInputLift(value) {
  document.documentElement.style.setProperty("--input-lift", "0px");
}

function updateStatus(status, mode) {
  elements.statusText.textContent = status;
  elements.modeBadge.textContent = mode;
}

function updateProviderBadge(provider) {
  if (!elements.providerBadge) {
    return;
  }

  const labels = {
    dictionary: t("providerDictionary"),
    openrouter: t("providerOpenRouter"),
    dashscope: t("providerDashScope"),
    gemini: t("providerGemini"),
    deepseek: t("providerDeepSeek"),
    loading: t("providerLoading"),
    error: "!",
    auto: t("providerAuto"),
    "": t("providerIdle")
  };
  const normalized = String(provider || "");
  elements.providerBadge.textContent = labels[normalized] || t("providerAuto");
  elements.providerBadge.dataset.provider = normalized || "idle";
}

function setLoading(loading) {
  elements.translateButton.disabled = loading;
  elements.translateButton.classList.toggle("loading", loading);
  const label = elements.translateButton.querySelector("[data-i18n='translate']");
  if (label) {
    applyBilingualText(label, loading ? t("loading") : t("translate"));
  }
}

function t(key) {
  return I18N[key] || key;
}

function pulse(node) {
  if (!node?.animate) {
    return;
  }

  node.animate(
    [
      { filter: "brightness(1)", opacity: 1 },
      { filter: "brightness(0.94) saturate(1.08)", opacity: 0.92 },
      { filter: "brightness(1)", opacity: 1 }
    ],
    { duration: 190, easing: "cubic-bezier(.2,.9,.2,1)" }
  );
}

function animateSwap(node) {
  if (!node) {
    return;
  }

  node.classList.remove("content-swap");
  void node.offsetWidth;
  node.classList.add("content-swap");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch {
    // PWA still works online if service worker registration is unavailable.
  }
}
