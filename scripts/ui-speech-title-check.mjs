import { chromium } from "playwright";

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

await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", { waitUntil: "networkidle" });
await page.locator("#text").fill("你好");
await page.locator("#go").click();
await page.waitForSelector("#results:not(.hidden)", { timeout: 20000 });
const zhBadge = await page.locator("#badge").innerText();
await page.locator(".tab[data-lang='en']").click();
const enBadge = await page.locator("#badge").innerText();
await page.locator(".tab[data-lang='pt-BR']").click();
const ptBadge = await page.locator("#badge").innerText();
const svgCount = await page.locator("#trans button svg").count();
const firstSpeak = await page.locator("#trans button").first().evaluate((button) => ({
  text: button.dataset.text,
  lang: button.dataset.lang
}));
await browser.close();

console.log(JSON.stringify({ zhBadge, enBadge, ptBadge, svgCount, firstSpeak, consoleMessages, failedRequests }, null, 2));
