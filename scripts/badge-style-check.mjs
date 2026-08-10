import { chromium } from 'playwright';

const url = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('#textInput').fill('你好');
await page.locator('#translateButton').click();
await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 30000 });
await page.locator('#translateButton:not(.loading)').waitFor({ timeout: 30000 });

const styles = await page.evaluate(() => {
  const pick = (selector) => {
    const node = document.querySelector(selector);
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent,
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      letterSpacing: style.letterSpacing,
      lineHeight: style.lineHeight,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  };
  return {
    modeBadge: pick('#modeBadge'),
    providerBadge: pick('#providerBadge'),
    sectionLabel: pick('.section-label')
  };
});

await browser.close();
console.log(JSON.stringify(styles, null, 2));
