import { chromium } from "playwright";

async function check(viewport, name) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  await page.goto("https://translation-pwa.qhzggzh-linguago.workers.dev", { waitUntil: "networkidle" });
  await page.locator("#text").fill("你好吗");
  await page.locator("#go").click();
  await page.waitForSelector("#results:not(.hidden)", { timeout: 20000 });
  await page.locator("#settingsBtn").click();
  await page.waitForSelector("#settingsOverlay:not(.hidden)", { timeout: 5000 });
  const result = await page.evaluate(() => {
    const overlay = document.querySelector("#settingsOverlay");
    const settings = document.querySelector("#settings");
    const text = document.querySelector("#text");
    const overlayRect = overlay.getBoundingClientRect();
    const settingsRect = settings.getBoundingClientRect();
    const textStyle = getComputedStyle(text);
    const topCenter = document.elementFromPoint(window.innerWidth / 2, 20);
    const modalCenter = document.elementFromPoint(settingsRect.left + settingsRect.width / 2, settingsRect.top + settingsRect.height / 2);
    return {
      overlayParent: overlay.parentElement.tagName,
      overlayZ: getComputedStyle(overlay).zIndex,
      overlayCoversViewport:
        Math.round(overlayRect.left) <= 0 &&
        Math.round(overlayRect.top) <= 0 &&
        Math.round(overlayRect.right) >= window.innerWidth &&
        Math.round(overlayRect.bottom) >= window.innerHeight,
      textAlign: textStyle.textAlign,
      topCenterElement: {
        tag: topCenter?.tagName,
        id: topCenter?.id,
        className: String(topCenter?.className || "")
      },
      modalCenterElement: {
        tag: modalCenter?.tagName,
        id: modalCenter?.id,
        className: String(modalCenter?.className || "")
      }
    };
  });
  await page.screenshot({ path: `output/playwright/${name}-modal-overlay.png`, fullPage: true });
  await browser.close();
  return result;
}

const mobile = await check({ width: 390, height: 844 }, "mobile");
const desktop = await check({ width: 1440, height: 950 }, "desktop");
console.log(JSON.stringify({ mobile, desktop }, null, 2));
