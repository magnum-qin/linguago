import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", { waitUntil: "networkidle" });
await page.locator("#text").fill(`hello ${Date.now()}`);
await page.keyboard.press("Enter");
await page.waitForSelector(".app.has-result", { timeout: 20000 });
await page.waitForSelector("#results:not(.hidden)", { timeout: 20000 });

const beforeClear = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const hero = document.querySelector(".hero").getBoundingClientRect();
  const results = document.querySelector("#results").getBoundingClientRect();
  return {
    hasResultClass: app.classList.contains("has-result"),
    gridColumns: getComputedStyle(app).gridTemplateColumns,
    heroLeftOfResults: hero.left < results.left
  };
});

await page.locator("#clear").click();
await page.waitForTimeout(300);

const afterClear = await page.evaluate(() => {
  const app = document.querySelector(".app");
  const hero = document.querySelector(".hero").getBoundingClientRect();
  const results = document.querySelector("#results").getBoundingClientRect();
  return {
    hasResultClass: app.classList.contains("has-result"),
    gridColumns: getComputedStyle(app).gridTemplateColumns,
    heroLeftOfResults: hero.left < results.left,
    inputValue: document.querySelector("#text").value
  };
});

await browser.close();
console.log(JSON.stringify({ beforeClear, afterClear }, null, 2));
