import { chromium } from "playwright";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

const consoleMessages = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) {
    consoleMessages.push(`${msg.type()}: ${msg.text()}`);
  }
});
page.on("requestfailed", (request) => {
  failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`);
});

await page.goto(url, { waitUntil: "networkidle" });
const before = await page.evaluate(() => {
  const text = document.querySelector("#textInput");
  const shell = document.querySelector(".app-shell");
  const textRect = text.getBoundingClientRect();
  const shellRect = shell.getBoundingClientRect();
  return {
    textHeight: Math.round(textRect.height),
    textCenterDelta: Math.round((textRect.left + textRect.width / 2) - (shellRect.left + shellRect.width / 2)),
    textAlign: getComputedStyle(text).textAlign,
    hasResultClass: document.body.classList.contains("has-result")
  };
});

await page.locator("#textInput").fill(`hello ${Date.now()}`);
await page.keyboard.press("Enter");
await page.waitForSelector("#resultCard:not(.hidden)", { timeout: 30000 });
await page.locator("#translateButton:not(.loading)").waitFor({ timeout: 30000 });
const after = await page.evaluate(() => {
  const shell = document.querySelector(".app-shell");
  const translator = document.querySelector(".translator-card");
  const result = document.querySelector("#resultCard");
  const text = document.querySelector("#textInput");
  const shellRect = shell.getBoundingClientRect();
  const translatorRect = translator.getBoundingClientRect();
  const resultRect = result.getBoundingClientRect();
  return {
    gridColumns: getComputedStyle(shell).gridTemplateColumns,
    hasResultClass: document.body.classList.contains("has-result"),
    translatorLeftOfResult: translatorRect.left < resultRect.left,
    translatorRight: Math.round(translatorRect.right),
    resultLeft: Math.round(resultRect.left),
    textHeight: Math.round(text.getBoundingClientRect().height),
    textAlign: getComputedStyle(text).textAlign,
    shellWidth: Math.round(shellRect.width),
    resultVisible: !result.classList.contains("hidden")
  };
});

await page.screenshot({ path: "output/playwright/desktop-layout-check.png", fullPage: true });
await browser.close();

console.log(JSON.stringify({ before, after, consoleMessages, failedRequests }, null, 2));
