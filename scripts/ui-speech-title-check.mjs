import { chromium } from "playwright";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const consoleMessages = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (["error", "warning"].includes(msg.type())) consoleMessages.push(`${msg.type()}: ${msg.text()}`);
});
page.on("requestfailed", (request) => {
  failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ""}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#textInput").fill("你好");
await page.locator("#translateButton").click();
await page.waitForSelector("#resultCard:not(.hidden)", { timeout: 30000 });
await page.locator("#translateButton:not(.loading)").waitFor({ timeout: 30000 });
const zhBadge = await page.locator("#modeBadge").innerText();
await page.locator(".result-tab[data-lang='en']").click();
const enBadge = await page.locator("#modeBadge").innerText();
await page.locator(".result-tab[data-lang='pt-BR']").click();
const ptBadge = await page.locator("#modeBadge").innerText();
const svgCount = await page.locator("#translationCard button svg").count();
const firstSpeak = await page.locator("#translationCard button").first().evaluate((button) => ({
  text: button.dataset.speakText,
  lang: button.dataset.speakLang
}));
await browser.close();

console.log(JSON.stringify({ zhBadge, enBadge, ptBadge, svgCount, firstSpeak, consoleMessages, failedRequests }, null, 2));
