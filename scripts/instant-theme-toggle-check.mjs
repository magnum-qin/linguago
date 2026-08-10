import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto('https://translation-pwa.qhzggzh-linguago.workers.dev', { waitUntil: 'networkidle' });
await page.locator('#settingsButton').click();
await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 5000 });
const before = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  overlayBg: getComputedStyle(document.querySelector('#settingsOverlay')).backgroundColor
}));
await page.locator('#themeToggleButton').click();
await page.waitForTimeout(250);
const after = await page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  bodyBg: getComputedStyle(document.body).backgroundColor,
  htmlInlineBg: document.documentElement.style.backgroundColor,
  bodyInlineBg: document.body.style.backgroundColor,
  overlayBg: getComputedStyle(document.querySelector('#settingsOverlay')).backgroundColor,
  overlayHidden: document.querySelector('#settingsOverlay').classList.contains('hidden'),
  themeColors: Array.from(document.querySelectorAll("meta[name='theme-color']")).map((node) =>
    node.getAttribute('content')
  )
}));
await browser.close();
console.log(JSON.stringify({ before, after }, null, 2));
