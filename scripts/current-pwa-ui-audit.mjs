import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const outDir = path.resolve("output/playwright/current-ui-audit");

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const report = {
  url,
  generated_at: new Date().toISOString(),
  mobile: {},
  desktop: {},
  interactions: {},
  console: [],
  requestFailures: [],
  screenshots: {}
};

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  });
  const page = await context.newPage();
  page.on("console", (message) => report.console.push({ type: message.type(), text: message.text() }));
  page.on("requestfailed", (request) =>
    report.requestFailures.push({ url: request.url(), failure: request.failure()?.errorText || "" })
  );

  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await screenshot(page, "mobile-initial");
  report.mobile.initial = await page.evaluate(readLayout);
  report.mobile.text = await page.evaluate(readVisibleText);

  await page.click("#settingsButton");
  await page.waitForSelector("#settingsOverlay:not(.hidden)");
  await screenshot(page, "mobile-settings");
  report.mobile.settings = await page.evaluate(() => {
    const overlay = document.querySelector("#settingsOverlay")?.getBoundingClientRect();
    const panel = document.querySelector("#settingsPanel")?.getBoundingClientRect();
    const topElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      overlay: rect(overlay),
      panel: rect(panel),
      bodyModalOpen: document.body.classList.contains("modal-open"),
      topElementId: topElement?.id || "",
      topElementClass: topElement?.className || "",
      backdropFilter: getComputedStyle(document.querySelector("#settingsOverlay")).backdropFilter
    };
    function rect(value) {
      return value
        ? { x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, bottom: value.bottom }
        : null;
    }
  });

  await page.mouse.click(8, 8);
  await page.waitForSelector("#settingsOverlay.hidden", { state: "attached" });
  report.interactions.overlayClickCloses = await page.locator("#settingsOverlay.hidden").count();

  await page.click("#themeToggleButton");
  await page.waitForTimeout(120);
  await screenshot(page, "mobile-dark");
  report.mobile.dark = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme || "",
    themeColor: document.querySelector("meta[name='theme-color']")?.getAttribute("content") || "",
    bg: getComputedStyle(document.body).backgroundColor
  }));

  await page.fill("#textInput", "hello");
  await screenshot(page, "mobile-input");
  report.mobile.input = await page.evaluate(() => {
    const input = document.querySelector("#textInput");
    const card = document.querySelector(".translator-card");
    return {
      input: rect(input.getBoundingClientRect()),
      card: rect(card.getBoundingClientRect()),
      inputTextAlign: getComputedStyle(input).textAlign,
      inputPaddingTop: getComputedStyle(input).paddingTop,
      inputPaddingBottom: getComputedStyle(input).paddingBottom
    };
    function rect(value) {
      return { x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, bottom: value.bottom };
    }
  });

  await page.click("#translateButton");
  await page.waitForSelector("#resultCard:not(.hidden)", { timeout: 60000 }).catch(() => null);
  await page.waitForTimeout(500);
  await screenshot(page, "mobile-result");
  report.mobile.result = await page.evaluate(readResultState);

  for (const lang of ["en", "pt-BR", "zh", "ja"]) {
    await page.click(`.result-tab[data-lang="${lang}"]`);
    await page.waitForTimeout(120);
    report.mobile[`tab_${lang}`] = await page.evaluate(readResultState);
  }

  await page.setViewportSize({ width: 1365, height: 768 });
  await page.waitForTimeout(300);
  await screenshot(page, "desktop-result");
  report.desktop.result = await page.evaluate(readLayout);
  await context.close();
} finally {
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));

async function screenshot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.screenshots[name] = file;
}

function readLayout() {
  const shell = document.querySelector(".app-shell")?.getBoundingClientRect();
  const translator = document.querySelector(".translator-card")?.getBoundingClientRect();
  const result = document.querySelector("#resultCard")?.getBoundingClientRect();
  const history = document.querySelector(".history-card")?.getBoundingClientRect();
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    bodyClasses: document.body.className,
    shell: rect(shell),
    translator: rect(translator),
    result: rect(result),
    history: rect(history),
    scrollHeight: document.documentElement.scrollHeight,
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
  };
  function rect(value) {
    return value
      ? { x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, bottom: value.bottom }
      : null;
  }
}

function readVisibleText() {
  return {
    inputLabel: document.querySelector("#inputLabel")?.textContent?.trim() || "",
    clear: document.querySelector("#clearButton")?.textContent?.trim() || "",
    translate: document.querySelector("#translateButton")?.textContent?.trim() || "",
    history: document.querySelector(".history-title")?.textContent?.replace(/\s+/g, " ").trim() || "",
    placeholder: document.querySelector("#textInput")?.getAttribute("placeholder") || ""
  };
}

function readResultState() {
  return {
    visible: !document.querySelector("#resultCard")?.classList.contains("hidden"),
    activeLang: document.querySelector(".result-tab.active")?.getAttribute("data-lang") || "",
    tabOrder: Array.from(document.querySelectorAll(".result-tab")).map((tab) => tab.getAttribute("data-lang")),
    translationText: document.querySelector("#translationCard strong")?.textContent?.trim() || "",
    translationLineCount: document.querySelectorAll("#translationCard .compact-line").length,
    wordDetailCount: document.querySelectorAll("#wordDetailsList .word-detail-card").length,
    exampleCount: document.querySelectorAll("#examplesList .example-card").length,
    sentenceExplainVisible: !document.querySelector("#sentenceExplainWrap")?.classList.contains("hidden"),
    wordDetailsVisible: !document.querySelector("#wordDetailsWrap")?.classList.contains("hidden"),
    examplesVisible: !document.querySelector("#examplesWrap")?.classList.contains("hidden"),
    mode: document.querySelector("#modeBadge")?.textContent?.trim() || "",
    status: document.querySelector("#statusText")?.textContent?.trim() || ""
  };
}
