const HISTORY_KEY = "linguago-history-v5";
const SETTINGS_KEY = "linguago-settings-v1";
const THEME_SETTINGS_VERSION = 2;

const RESULT_LANGUAGES = [
  { code: "en", label: "EN", speech: "en-US" },
  { code: "pt-BR", label: "PT", speech: "pt-BR" },
  { code: "zh", label: "中", speech: "zh-CN" },
  { code: "ja", label: "日", speech: "ja-JP" }
];

const LANGUAGES = Object.fromEntries(
  RESULT_LANGUAGES.map((language) => [language.code, language])
);

const DEFAULT_MODELS = {
  auto: "qwen3.6-flash-2026-04-16",
  openrouter: "qwen/qwen3.6-30b-a3b:free",
  dashscope: "qwen3.6-flash-2026-04-16",
  gemini: "gemini-2.5-flash"
};

const I18N = {
  input: "输入 / Entrada",
  ready: "准备就绪 / Pronto",
  clear: "清空 / Limpar",
  settings: "设置 / Configurações",
  translate: "翻译 / Traduzir",
  loading: "翻译中 / Traduzindo...",
  examples: "例句 / Exemplos",
  wordDetails: "单词解释 / Explicação da palavra",
  sentenceExplain: "句子解释 / Explicação da frase",
  history: "历史 / Histórico",
  waiting: "等待输入 / Aguardando",
  empty: "请先输入要翻译的内容 / Digite algo para traduzir.",
  translating: "正在翻译 / Traduzindo...",
  word: "单词 / Palavra",
  sentence: "句子 / Frase",
  live: "AI",
  cached: "缓存 / Cache",
  failed: "翻译暂时不可用 / Tradução indisponível no momento",
  noHistory: "还没有历史记录 / Ainda sem histórico.",
  noExamples: "暂无例句 / Sem exemplos por enquanto.",
  placeholder: "输入单词或句子",
  platform: "平台 / Plataforma",
  model: "模型名称 / Nome do modelo",
  saveModel: "修改 / Salvar",
  verifyModel: "验证 / Verificar",
  saved: "已保存 / Salvo",
  verifying: "验证中 / Verificando...",
  verified: "模型可用 / Modelo disponível",
  verifyFailed: "验证失败 / Falha na verificação",
  saveFailed: "保存失败 / Falha ao salvar",
  darkToLight: "切换到浅色模式 / Mudar para modo claro",
  lightToDark: "切换到暗黑模式 / Mudar para modo escuro",
  speak: "朗读 / Ouvir",
  dictionarySyncing: "词典同步中 / Sincronizando",
  dictionaryAdded: "已添加单词 / Palavras adicionadas",
  dictionaryUnavailable: "词典状态未知 / Dicionário indisponível",
  providerIdle: "来源 / Fonte",
  providerLoading: "查询 / Consulta",
  providerDictionary: "词典 / Dicionário",
  providerOpenRouter: "OpenRouter",
  providerDashScope: "DashScope",
  providerGemini: "Gemini",
  providerAuto: "AI"
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
  modelInput: document.querySelector("#modelInput"),
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
let keyboardScrollTimer = 0;
let systemThemeQuery = null;

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
  document.addEventListener(
    "click",
    (event) => {
      const isOpen = !elements.settingsOverlay.classList.contains("hidden");
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
      closeSettings();
    }
  });

  elements.providerSelect.addEventListener("change", () => {
    settings.provider = elements.providerSelect.value;
    settings.model = DEFAULT_MODELS[settings.provider] || DEFAULT_MODELS.auto;
    elements.modelInput.value = settings.model;
    saveSettings();
  });

  elements.modelInput.addEventListener("change", () => {
    settings.model = elements.modelInput.value.trim();
    saveSettings();
  });
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
      theme,
      themeSettingsVersion: THEME_SETTINGS_VERSION
    };
  } catch {
    return {
      provider: "auto",
      model: DEFAULT_MODELS.auto,
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

function saveModelSetting() {
  settings.provider = elements.providerSelect.value;
  settings.model =
    elements.modelInput.value.trim() ||
    DEFAULT_MODELS[settings.provider] ||
    DEFAULT_MODELS.auto;
  elements.modelInput.value = settings.model;
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
  settings.model =
    elements.modelInput.value.trim() ||
    DEFAULT_MODELS[settings.provider] ||
    DEFAULT_MODELS.auto;
  elements.modelInput.value = settings.model;
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
    requestAnimationFrame(() => elements.modelInput.focus());
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
  const provider = ["auto", "openrouter", "dashscope", "gemini"].includes(settings.provider)
    ? settings.provider
    : "auto";
  settings.provider = provider;
  settings.model = settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  elements.providerSelect.value = settings.provider;
  elements.modelInput.value = settings.model;

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
  settings.model = elements.modelInput.value.trim();
  saveSettings();
  setLoading(true);
  updateStatus(t("translating"), "...");
  renderLoadingResult();

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        source_lang: "auto",
        target_lang: selectedResultLang,
        provider: settings.provider,
        model: settings.model
      })
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || t("failed"));
    }

    renderResult(data);
    saveHistory(data);
    renderHistory();
  } catch (error) {
    renderErrorResult(error instanceof Error ? error.message : t("failed"));
  } finally {
    setLoading(false);
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

function renderResult(data) {
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
  renderTranslationCard(data);

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

function renderTranslationCard(data) {
  const text = getSelectedTranslation(data);
  const item = getLocalized(data.translations || {}, selectedResultLang);
  const phonetic = item.phonetic || "";

  animateSwap(elements.translationCard);
  elements.translationCard.innerHTML = `
    <div class="compact-line single">
      <div>
        <strong>${escapeHtml(text || "-")}</strong>
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
}

function getSelectedTranslation(data) {
  const item = getLocalized(data.translations || {}, selectedResultLang);
  return item.text || (selectedResultLang === "zh" ? data.translation : "") || data.translation || "";
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

  return data.explanation || data.sentence_explanation || "-";
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
              <strong>${escapeHtml(word)}</strong>
              <span class="sense-index">${escapeHtml(String(sense.sense_order || index + 1))}</span>
            </div>
            ${meta ? `<div class="sense-meta">${escapeHtml(meta)}</div>` : ""}
            <p>${escapeHtml(definition)}</p>
          </article>
        `;
      })
      .join("");
    return;
  }

  const item = details[selectedResultLang] || {};
  elements.wordDetailsList.innerHTML = `
    <article class="word-detail-card section-appear">
      <strong>${escapeHtml(item.word || word)}</strong>
      <p>${escapeHtml(item.definition || "-")}</p>
    </article>
  `;
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
    return {
      text: normalizeTextValue(item.text),
      phonetic: normalizeTextValue(item.phonetic),
      audio_text: normalizeTextValue(item.audio_text || item.text)
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
        <button class="history-item" type="button" data-source="${escapeAttribute(
          item.source
        )}" data-lang="${escapeAttribute(item.targetLang || "zh")}">
          <p class="history-source">${escapeHtml(item.source)}</p>
          <p class="history-target">${escapeHtml(item.target)}</p>
        </button>
      `
    )
    .join("");

  for (const node of elements.historyList.querySelectorAll(".history-item")) {
    node.addEventListener("click", () => {
      elements.textInput.value = node.dataset.source || "";
      selectedResultLang = LANGUAGES[node.dataset.lang] ? node.dataset.lang : "zh";
      renderResultLanguageTabs();
      onTranslate();
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
