import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", { waitUntil: "networkidle" });
const geometry = await page.evaluate(() => {
  const pick = (selector) => {
    const node = document.querySelector(selector);
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      selector,
      display: style.display,
      widthStyle: style.width,
      justifySelf: style.justifySelf,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      center: Math.round(rect.left + rect.width / 2)
    };
  };
  return {
    viewportCenter: window.innerWidth / 2,
    app: pick(".app"),
    hero: pick(".hero"),
    input: pick(".input"),
    text: pick("#text"),
    actions: pick(".actions")
  };
});
await browser.close();
console.log(JSON.stringify(geometry, null, 2));
