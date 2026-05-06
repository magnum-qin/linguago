import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("output/playwright");
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function checkMobile() {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", {
    waitUntil: "networkidle"
  });
  const before = await page.locator(".hero").boundingBox();
  await page.locator("#settingsBtn").click();
  const after = await page.locator(".hero").boundingBox();
  await page.screenshot({
    path: path.join(outDir, "07-mobile-settings-compact.png"),
    fullPage: true
  });
  await context.close();
  return { before, after, deltaHeight: Math.round((after?.height || 0) - (before?.height || 0)) };
}

async function checkDesktop() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", {
    waitUntil: "networkidle"
  });
  await page.locator("#text").fill("hello");
  await page.locator("#go").click();
  await page.locator("#res").waitFor({ state: "visible", timeout: 45000 });
  await page.screenshot({
    path: path.join(outDir, "08-desktop-real.png"),
    fullPage: true
  });
  const metrics = await page.evaluate(() => {
    const app = document.querySelector(".app").getBoundingClientRect();
    const hero = document.querySelector(".hero").getBoundingClientRect();
    const res = document.querySelector("#res").getBoundingClientRect();
    return {
      appWidth: Math.round(app.width),
      heroLeft: Math.round(hero.left),
      heroWidth: Math.round(hero.width),
      resultLeft: Math.round(res.left),
      resultWidth: Math.round(res.width),
      sideBySide: res.left > hero.right
    };
  });
  await context.close();
  return metrics;
}

const report = {
  mobile: await checkMobile(),
  desktop: await checkDesktop()
};

await browser.close();
await fs.writeFile(path.join(outDir, "layout-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
