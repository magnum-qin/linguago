import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const url = "https://translation-pwa.qhzggzh-linguago.workers.dev";
const outDir = path.resolve("output/playwright");

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
});
const page = await context.newPage();

const consoleMessages = [];
const failedRequests = [];
const responses = [];

page.on("console", (msg) => {
  consoleMessages.push({ type: msg.type(), text: msg.text() });
});
page.on("requestfailed", (request) => {
  failedRequests.push({
    url: request.url(),
    failure: request.failure()?.errorText || ""
  });
});
page.on("response", (response) => {
  const requestUrl = response.url();
  if (requestUrl.includes("/api/translate") || requestUrl.includes("/health")) {
    responses.push({ url: requestUrl, status: response.status() });
  }
});

const report = {
  url,
  checks: {},
  consoleMessages,
  failedRequests,
  responses,
  resultText: "",
  errorText: ""
};

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, "01-initial-mobile.png"), fullPage: true });

  report.checks.title = await page.title();
  report.checks.hasSettingsButton = await page.locator("#settingsBtn").isVisible();
  report.checks.hasLanguageTabs = (await page.locator(".tab").count()) === 3;
  report.checks.hasTextarea = await page.locator("#text").isVisible();
  report.checks.hasActionButtons =
    (await page.locator("#clear").isVisible()) &&
    (await page.locator("#speak").isVisible()) &&
    (await page.locator("#go").isVisible());

  await page.locator("#settingsBtn").click();
  await page.screenshot({ path: path.join(outDir, "02-settings-open.png"), fullPage: true });
  report.checks.settingsVisible = await page.locator("#settings").isVisible();
  report.checks.providerOptions = await page.locator("#provider option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, text: node.textContent?.trim() }))
  );

  await page.locator("#theme").click();
  await page.screenshot({ path: path.join(outDir, "03-dark-mode.png"), fullPage: true });
  report.checks.darkThemeApplied =
    (await page.locator("html").getAttribute("data-theme")) === "dark";

  await page.locator(".tab[data-lang='en']").click();
  report.checks.englishApplied = {
    label: await page.locator("#label").textContent(),
    clear: await page.locator("#clear").textContent(),
    speak: await page.locator("#speak").textContent(),
    translate: await page.locator("#go").textContent()
  };

  await page.locator(".tab[data-lang='pt-BR']").click();
  report.checks.portugueseApplied = {
    label: await page.locator("#label").textContent(),
    clear: await page.locator("#clear").textContent(),
    speak: await page.locator("#speak").textContent(),
    translate: await page.locator("#go").textContent()
  };

  await page.locator(".tab[data-lang='zh']").click();
  await page.locator("#provider").selectOption("auto");
  await page.locator("#model").fill("qwen3.6-flash-2026-04-16");
  await page.locator("#text").fill("hello");
  await page.screenshot({ path: path.join(outDir, "04-before-translate.png"), fullPage: true });
  await page.locator("#go").click();

  try {
    await page.locator("#results, #res").waitFor({ state: "visible", timeout: 45000 });
  } catch {
    report.errorText = await page.locator("#status").textContent().catch(() => "");
  }

  await page.screenshot({ path: path.join(outDir, "05-after-translate.png"), fullPage: true });
  const resultRoot = page.locator("#results, #res").first();
  report.checks.resultVisible = await resultRoot.isVisible();
  report.resultText = await resultRoot.innerText().catch(() => "");
  report.checks.translationLineCount = await page.locator("#trans .line").count();
  report.checks.wordDetailsVisible = await page
    .locator("#detailsCard, #detailsWrap")
    .first()
    .isVisible();
  report.checks.examplesVisible = await page
    .locator("#examplesCard, #exWrap")
    .first()
    .isVisible();

  await page.setViewportSize({ width: 1365, height: 768 });
  await page.screenshot({ path: path.join(outDir, "06-desktop.png"), fullPage: true });
} finally {
  await fs.writeFile(
    path.join(outDir, "audit-report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
