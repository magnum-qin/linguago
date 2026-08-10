import { chromium } from 'playwright';

const url = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';

async function check(viewport, name) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport, isMobile: viewport.width < 700, hasTouch: viewport.width < 700 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#textInput').fill('你好吗');
  await page.locator('#translateButton').click();
  await page.waitForSelector('#resultCard:not(.hidden)', { timeout: 30000 });
  await page.locator('#settingsButton').click();
  await page.waitForSelector('#settingsOverlay:not(.hidden)', { timeout: 5000 });
  const result = await page.evaluate(() => {
    const overlay = document.querySelector('#settingsOverlay');
    const panel = document.querySelector('#settingsPanel');
    const textInput = document.querySelector('#textInput');
    const overlayRect = overlay.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const textStyle = getComputedStyle(textInput);
    const topCenter = document.elementFromPoint(window.innerWidth / 2, 20);
    const modalCenter = document.elementFromPoint(
      panelRect.left + panelRect.width / 2,
      panelRect.top + panelRect.height / 2
    );
    return {
      overlayParent: overlay.parentElement.tagName,
      overlayZ: getComputedStyle(overlay).zIndex,
      overlayCoversViewport:
        Math.round(overlayRect.left) <= 0 &&
        Math.round(overlayRect.top) <= 0 &&
        Math.round(overlayRect.right) >= window.innerWidth &&
        Math.round(overlayRect.bottom) >= window.innerHeight,
      inputTextAlign: textStyle.textAlign,
      topCenterElement: {
        tag: topCenter?.tagName,
        id: topCenter?.id,
        className: String(topCenter?.className || '')
      },
      modalCenterElement: {
        tag: modalCenter?.tagName,
        id: modalCenter?.id,
        className: String(modalCenter?.className || '')
      }
    };
  });
  await page.screenshot({ path: `output/playwright/${name}-modal-overlay.png`, fullPage: true });
  await browser.close();
  return result;
}

const mobile = await check({ width: 390, height: 844 }, 'mobile');
const desktop = await check({ width: 1440, height: 950 }, 'desktop');
console.log(JSON.stringify({ mobile, desktop }, null, 2));
