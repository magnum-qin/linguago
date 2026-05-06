const HISTORY_KEY = "linguago-history-v5";
const SETTINGS_KEY = "linguago-settings-v1";

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
  dictionaryAdded: "已添加单词 / Palavras adicionadas"
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
    scheduleKeyboardScroll(220);
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
  applySettings();
  setupKeyboardLift();
  lockEmptyPageScroll();
  settleInitialAnimations();
  loadRemoteSettings();
  loadDictionaryStats();
  autoResizeInput();
  renderHistory();
  renderIdleResult();
  registerServiceWorker();
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
  const visualViewport = window.visualViewport;
  const keyboardLikelyOpen =
    visualViewport && window.innerHeight - visualViewport.height > 120;
  const shouldLift = isInputFocused && isMobileWidth && keyboardLikelyOpen;

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

  if (!isInputFocused || !isMobileWidth) {
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
    return {
      provider: "auto",
      model: DEFAULT_MODELS.auto,
      theme: "light",
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
    };
  } catch {
    return { provider: "auto", model: DEFAULT_MODELS.auto, theme: "light" };
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
    elements.dictionaryStats.textContent = t("dictionarySyncing");
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
  settings.theme = settings.theme === "dark" ? "light" : "dark";
  applySettings();
  saveSettings();
  pulse(elements.themeToggleButton);
}

function applySettings() {
  const provider = ["auto", "openrouter", "dashscope", "gemini"].includes(settings.provider)
    ? settings.provider
    : "auto";
  settings.provider = provider;
  settings.model = settings.model || DEFAULT_MODELS[provider] || DEFAULT_MODELS.auto;
  elements.providerSelect.value = settings.provider;
  elements.modelInput.value = settings.model;

  const isDark = settings.theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  elements.themeToggleButton.setAttribute(
    "aria-label",
    isDark ? t("darkToLight") : t("lightToDark")
  );
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
  document.body.classList.add("has-result");
  document.body.classList.remove("has-desktop-idle");
  elements.resultCard.classList.remove("desktop-idle");
  elements.resultCard.classList.remove("hidden", "reveal");
  elements.resultCard.scrollTop = 0;
  elements.resultCard.setAttribute("aria-busy", "true");
  void elements.resultCard.offsetWidth;
  elements.resultCard.classList.add("reveal");
  updateStatus(t("translating"), "...");
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
    renderWordDetails(data.word_details || {});
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

function renderWordDetails(details) {
  const item = details[selectedResultLang] || {};
  animateSwap(elements.wordDetailsList);
  elements.wordDetailsList.innerHTML = `
    <article class="word-detail-card section-appear">
      <strong>${escapeHtml(item.word || getSelectedTranslation(latestResultData || {}))}</strong>
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

  elements.examplesList.innerHTML = examples
    .map((example) => {
      const translations = example.translations || {};
      const selectedExample = normalizeTextValue(translations[selectedResultLang]) || example.sentence || "";
      return `
        <article class="example-card section-appear">
          <p class="example-source">${escapeHtml(selectedExample)}</p>
        </article>
      `;
    })
    .join("");
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
