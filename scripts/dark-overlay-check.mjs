import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto('https://translation-pwa.qhzggzh-linguago.workers.dev', { waitUntil: 'networkidle' });
await page.locator('#settingsButton').click();
await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 5000 });
await page.locator('#themeToggleButton').click();

const result = await page.evaluate(() => {
  const overlay = document.querySelector('#settingsOverlay');
  return {
    overlayBackground: getComputedStyle(overlay).backgroundColor,
    overlayBackdrop: getComputedStyle(overlay).backdropFilter,
    bodyBackground: getComputedStyle(document.body).backgroundColor
  };
});

await browser.close();
console.log(JSON.stringify(result, null, 2));
