import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const outDir = path.resolve('output/playwright');
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function checkMobile() {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  const before = await box(page, '.translator-card');
  await page.locator('#settingsButton').click();
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 5000 });
  const after = await box(page, '.translator-card');
  const overlay = await page.locator('#settingsOverlay').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      visible: !node.classList.contains('hidden'),
      coversViewport:
        Math.round(rect.left) <= 0 &&
        Math.round(rect.top) <= 0 &&
        Math.round(rect.right) >= window.innerWidth &&
        Math.round(rect.bottom) >= window.innerHeight
    };
  });
  await page.screenshot({ path: path.join(outDir, '07-mobile-settings-compact.png'), fullPage: true });
  await page.close();
  return {
    before,
    after,
    overlay,
    deltaHeight: Math.round((after?.height || 0) - (before?.height || 0))
  };
}

async function checkDesktop() {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#textInput').fill('hello');
  await page.locator('#translateButton').click();
  await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 45000 });
  await page.screenshot({ path: path.join(outDir, '08-desktop-real.png'), fullPage: true });
  const metrics = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell').getBoundingClientRect();
    const history = document.querySelector('.history-card').getBoundingClientRect();
    const translator = document.querySelector('.translator-card').getBoundingClientRect();
    const result = document.querySelector('#resultCard').getBoundingClientRect();
    return {
      shellWidth: Math.round(shell.width),
      historyLeft: Math.round(history.left),
      translatorLeft: Math.round(translator.left),
      resultLeft: Math.round(result.left),
      sideBySide: history.right <= translator.left && translator.right <= result.left,
      resultWidth: Math.round(result.width)
    };
  });
  await page.close();
  return metrics;
}

const report = {
  url,
  mobile: await checkMobile(),
  desktop: await checkDesktop()
};

await browser.close();
await fs.writeFile(path.join(outDir, 'layout-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

async function box(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  });
}
