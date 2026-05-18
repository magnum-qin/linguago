import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
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
  failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "" });
});
page.on("response", (response) => {
  const requestUrl = response.url();
  if (requestUrl.includes("/api/translate") || requestUrl.includes("/api/health")) {
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
  report.checks.hasSettingsButton = await page.locator("#settingsButton").isVisible();
  report.checks.hasThemeButton = await page.locator("#themeToggleButton").isVisible();
  report.checks.hasLanguageTabs = (await page.locator(".result-tab").count()) === 4;
  report.checks.hasTextarea = await page.locator("#textInput").isVisible();
  report.checks.hasActionButtons =
    (await page.locator("#clearButton").isVisible()) &&
    (await page.locator("#translateButton").isVisible());

  await page.locator("#settingsButton").click();
  await page.waitForSelector("#settingsOverlay:not(.hidden)", { timeout: 5000 });
  await page.screenshot({ path: path.join(outDir, "02-settings-open.png"), fullPage: true });
  report.checks.settingsVisible = await page.locator("#settingsPanel").isVisible();
  report.checks.providerOptions = await page.locator("#providerSelect option").evaluateAll((nodes) =>
    nodes.map((node) => ({ value: node.value, text: node.textContent?.trim() }))
  );

  await page.keyboard.press("Escape");
  await page.waitForTimeout(220);
  await page.locator("#themeToggleButton").click();
  await page.screenshot({ path: path.join(outDir, "03-theme-toggle.png"), fullPage: true });
  report.checks.themePreference = await page.locator("html").getAttribute("data-theme-preference");
  report.checks.themeApplied = ["light", "dark"].includes(await page.locator("html").getAttribute("data-theme"));

  await page.locator("#textInput").fill("hello");
  await page.screenshot({ path: path.join(outDir, "04-before-translate.png"), fullPage: true });
  await page.locator("#translateButton").click();

  try {
    await page.locator("#resultCard:not(.hidden)").waitFor({ state: "visible", timeout: 45000 });
    await page.locator("#translateButton:not(.loading)").waitFor({ timeout: 45000 });
  } catch {
    report.errorText = await page.locator("#statusText").textContent().catch(() => "");
  }

  await page.screenshot({ path: path.join(outDir, "05-after-translate.png"), fullPage: true });
  report.checks.resultVisible = await page.locator("#resultCard:not(.hidden)").isVisible();
  report.resultText = await page.locator("#resultCard").innerText().catch(() => "");
  report.checks.translationVisible = await page.locator("#translationCard").isVisible();
  report.checks.wordDetailsOrSentenceVisible =
    (await page.locator("#wordDetailsWrap:not(.hidden)").isVisible().catch(() => false)) ||
    (await page.locator("#sentenceExplainWrap:not(.hidden)").isVisible().catch(() => false));

  await page.setViewportSize({ width: 1365, height: 768 });
  await page.screenshot({ path: path.join(outDir, "06-desktop.png"), fullPage: true });
} finally {
  await fs.writeFile(path.join(outDir, "audit-report.json"), JSON.stringify(report, null, 2), "utf8");
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
