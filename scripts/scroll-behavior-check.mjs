import { chromium } from "playwright";

const url = "https://translation-pwa.qhzggzh-linguago.workers.dev";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForSelector("#textInput");

async function snapshot(label) {
  return page.evaluate((name) => {
    const card = document.querySelector(".translator-card")?.getBoundingClientRect();
    const result = document.querySelector("#resultCard")?.getBoundingClientRect();
    return {
      label: name,
      scrollY: window.scrollY,
      bodyClasses: document.body.className,
      activeId: document.activeElement?.id || "",
      card: card
        ? { top: Math.round(card.top), bottom: Math.round(card.bottom), height: Math.round(card.height) }
        : null,
      result: result
        ? { top: Math.round(result.top), bottom: Math.round(result.bottom), height: Math.round(result.height) }
        : null
    };
  }, label);
}

const beforeFocus = await snapshot("before-focus");
await page.locator("#textInput").tap();
await page.waitForTimeout(450);
const afterFocus = await snapshot("after-focus");

await page.locator("#textInput").fill("hello");
await page.locator("#translateButton").tap();
await page.waitForSelector("#resultCard:not(.hidden)");
await page.waitForTimeout(900);
const afterTranslate = await snapshot("after-translate");

console.log(
  JSON.stringify(
    {
      url,
      beforeFocus,
      afterFocus,
      focusScrollDelta: afterFocus.scrollY - beforeFocus.scrollY,
      afterTranslate
    },
    null,
    2
  )
);

await browser.close();
