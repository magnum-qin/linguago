import { chromium } from "playwright";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#textInput").fill(`hello ${Date.now()}`);
await page.keyboard.press("Enter");
await page.waitForSelector("#resultCard:not(.hidden)", { timeout: 30000 });
await page.locator("#translateButton:not(.loading)").waitFor({ timeout: 30000 });

const beforeClear = await page.evaluate(readLayout);

await page.locator("#clearButton").click();
await page.waitForTimeout(300);

const afterClear = await page.evaluate(readLayout);

await browser.close();
console.log(JSON.stringify({ beforeClear, afterClear }, null, 2));

function readLayout() {
  const shell = document.querySelector(".app-shell");
  const translator = document.querySelector(".translator-card").getBoundingClientRect();
  const result = document.querySelector("#resultCard").getBoundingClientRect();
  return {
    bodyHasResult: document.body.classList.contains("has-result"),
    gridColumns: getComputedStyle(shell).gridTemplateColumns,
    translatorLeftOfResult: translator.left < result.left,
    inputValue: document.querySelector("#textInput").value,
    resultHidden: document.querySelector("#resultCard").classList.contains("hidden")
  };
}
