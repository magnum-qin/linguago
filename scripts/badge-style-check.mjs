import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", { waitUntil: "networkidle" });
await page.locator("#text").fill("你好");
await page.locator("#go").click();
await page.waitForSelector("#results:not(.hidden)", { timeout: 20000 });

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
      height: Math.round(rect.height)
    };
  };
  return {
    badge: pick("#badge"),
    sectionTitle: pick(".section-title .small")
  };
});

await browser.close();
console.log(JSON.stringify(styles, null, 2));
