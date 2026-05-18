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
await page.locator("#settingsButton").click();
await page.waitForSelector("#settingsOverlay:not(.hidden)", { timeout: 5000 });

const buttonState = await page.evaluate(() => ({
  hasSave: Boolean(document.querySelector("#saveModelButton")),
  hasVerify: Boolean(document.querySelector("#verifyModelButton")),
  saveText: document.querySelector("#saveModelButton")?.textContent,
  verifyText: document.querySelector("#verifyModelButton")?.textContent
}));

await page.locator("#modelInput").fill("qwen3.6-flash-2026-04-16");
await page.locator("#saveModelButton").click();
const savedStatus = await page.locator("#modelStatus").innerText();
await page.locator("#verifyModelButton").click();
await page.waitForFunction(() => {
  const status = document.querySelector("#modelStatus")?.textContent || "";
  return status.includes("模型可用") || status.includes("验证失败") || status.includes("Model works") || status.includes("Verification failed");
}, null, { timeout: 30000 });
const verifiedStatus = await page.locator("#modelStatus").innerText();
const localSettings = await page.evaluate(() => JSON.parse(localStorage.getItem("linguago-settings-v1") || "{}"));

await browser.close();
console.log(JSON.stringify({ buttonState, savedStatus, verifiedStatus, localSettings, consoleMessages, failedRequests }, null, 2));
