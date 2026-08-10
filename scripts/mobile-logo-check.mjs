import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto('https://translation-pwa.qhzggzh-linguago.workers.dev', { waitUntil: 'networkidle' });
const result = await page.evaluate(() => {
  const gear = document.querySelector('.gear');
  const tabs = document.querySelector('.tabs');
  const top = document.querySelector('.top');
  const tabsRect = tabs.getBoundingClientRect();
  const topRect = top.getBoundingClientRect();
  return {
    hasGear: Boolean(gear),
    topText: top.textContent.trim(),
    tabsWidth: Math.round(tabsRect.width),
    topWidth: Math.round(topRect.width)
  };
});
await browser.close();
console.log(JSON.stringify(result, null, 2));
