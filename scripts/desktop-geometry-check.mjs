import { chromium } from "playwright";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
await page.goto(url, { waitUntil: "networkidle" });
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
    shell: pick(".app-shell"),
    history: pick(".history-card"),
    translator: pick(".translator-card"),
    result: pick("#resultCard"),
    textInput: pick("#textInput"),
    actionBar: pick(".action-bar")
  };
});
await browser.close();
console.log(JSON.stringify(geometry, null, 2));
