import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto('https://translation-pwa.qhzggzh-linguago.workers.dev', { waitUntil: 'networkidle' });
await page.locator('#settingsButton').click();
await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 5000 });
await page.locator('#providerSelect').focus();

const style = await page.locator('#providerSelect').evaluate((node) => {
  const computed = getComputedStyle(node);
  return {
    borderRadius: computed.borderRadius,
    appearance: computed.appearance || computed.webkitAppearance,
    transition: computed.transition,
    boxShadow: computed.boxShadow,
    backgroundImage: computed.backgroundImage
  };
});

await browser.close();
console.log(JSON.stringify(style, null, 2));
