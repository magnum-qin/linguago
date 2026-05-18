import { chromium } from "playwright";

const url = "https://translation-pwa.qhzggzh-linguago.workers.dev";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true
});

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
await page.locator("#settingsButton").click();
await page.waitForSelector("#settingsOverlay:not(.hidden)", { timeout: 5000 });
const opened = await page.locator("#settingsOverlay").evaluate((node) => {
  const style = getComputedStyle(node);
  return {
    visible: !node.classList.contains("hidden"),
    position: style.position,
    backdrop: style.backdropFilter || style.webkitBackdropFilter || "",
    background: style.backgroundColor,
    ariaHidden: node.getAttribute("aria-hidden")
  };
});

const hitBeforeBackdropClick = await page.evaluate(() => {
  const node = document.elementFromPoint(8, 8);
  return {
    tag: node?.tagName,
    id: node?.id,
    className: String(node?.className || "")
  };
});
await page.mouse.click(8, 8);
await page.waitForTimeout(250);
const closedByBackdrop = await page.locator("#settingsOverlay").evaluate((node, hit) => ({
  hidden: node.classList.contains("hidden"),
  ariaHidden: node.getAttribute("aria-hidden"),
  hitBeforeBackdropClick: hit
}), hitBeforeBackdropClick);

let closedByButton = false;
if (!closedByBackdrop.hidden) {
  await page.locator("#closeSettingsButton").click();
  await page.waitForFunction(() => document.querySelector("#settingsOverlay")?.classList.contains("hidden"), null, { timeout: 5000 });
  closedByButton = await page.locator("#settingsOverlay").evaluate((node) => node.classList.contains("hidden"));
} else {
  await page.locator("#settingsButton").click();
  await page.locator("#closeSettingsButton").click();
  await page.waitForFunction(() => document.querySelector("#settingsOverlay")?.classList.contains("hidden"), null, { timeout: 5000 });
  closedByButton = await page.locator("#settingsOverlay").evaluate((node) => node.classList.contains("hidden"));
}

await page.screenshot({ path: "output/playwright/settings-modal-check.png", fullPage: true });
await browser.close();

console.log(JSON.stringify({
  opened,
  closedByBackdrop,
  closedByButton,
  consoleMessages,
  failedRequests
}, null, 2));
