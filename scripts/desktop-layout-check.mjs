import { chromium } from "playwright";

const url = "https://translation-pwa.qhzggzh-linguago.workers.dev";
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
  const gear = document.querySelector(".gear");
  const text = document.querySelector("#text");
  const app = document.querySelector(".app");
  const gearStyle = gear ? getComputedStyle(gear) : null;
  const textRect = text.getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  return {
    gearDisplay: gearStyle?.display || null,
    textHeight: Math.round(textRect.height),
    textCenterDelta: Math.round((textRect.left + textRect.width / 2) - (appRect.left + appRect.width / 2)),
    textAlign: getComputedStyle(text).textAlign,
    hasResultClass: app.classList.contains("has-result")
  };
});

await page.locator("#text").fill(`hello ${Date.now()}`);
await page.keyboard.press("Enter");
await page.waitForSelector(".app.has-result", { timeout: 20000 });
await page.waitForSelector("#results:not(.hidden)", { timeout: 20000 });
const after = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const hero = document.querySelector(".hero");
  const results = document.querySelector("#results");
  const text = document.querySelector("#text");
  const appRect = app.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  const resultRect = results.getBoundingClientRect();
  return {
    gridColumns: getComputedStyle(app).gridTemplateColumns,
    hasResultClass: app.classList.contains("has-result"),
    heroLeftOfResults: heroRect.left < resultRect.left,
    heroRight: Math.round(heroRect.right),
    resultLeft: Math.round(resultRect.left),
    textHeight: Math.round(text.getBoundingClientRect().height),
    textAlign: getComputedStyle(text).textAlign,
    appWidth: Math.round(appRect.width),
    resultVisible: !results.classList.contains("hidden")
  };
});

await page.screenshot({ path: "output/playwright/desktop-layout-check.png", fullPage: true });
await browser.close();

console.log(JSON.stringify({ before, after, consoleMessages, failedRequests }, null, 2));
