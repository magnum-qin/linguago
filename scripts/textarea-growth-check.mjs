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
    const input = document.querySelector("#textInput");
    const action = document.querySelector(".action-bar");
    const inputRect = input?.getBoundingClientRect();
    const actionRect = action?.getBoundingClientRect();
    return {
      label: name,
      scrollY: Math.round(window.scrollY),
      placeholder: input?.getAttribute("placeholder"),
      textAlign: input ? getComputedStyle(input).textAlign : "",
      input: inputRect
        ? { top: Math.round(inputRect.top), bottom: Math.round(inputRect.bottom), height: Math.round(inputRect.height) }
        : null,
      action: actionRect
        ? { top: Math.round(actionRect.top), bottom: Math.round(actionRect.bottom), height: Math.round(actionRect.height) }
        : null
    };
  }, label);
}

const initial = await snapshot("initial");
await page.locator("#textInput").tap();
await page.waitForTimeout(250);
const focused = await snapshot("focused");
await page.locator("#textInput").fill("第一行\n第二行\n第三行");
await page.waitForTimeout(700);
const grown = await snapshot("grown");

console.log(
  JSON.stringify(
    {
      url,
      initial,
      focused,
      grown,
      focusScrollDelta: focused.scrollY - initial.scrollY,
      actionBottomDeltaAfterGrowth: grown.action.bottom - focused.action.bottom,
      inputHeightDeltaAfterGrowth: grown.input.height - focused.input.height
    },
    null,
    2
  )
);

await browser.close();
