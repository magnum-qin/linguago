import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const url = process.env.PWA_URL || 'http://127.0.0.1:4175';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const launchOptions = { headless: true };
try {
  await fs.access(edgePath);
  launchOptions.executablePath = edgePath;
} catch {
  // Fall back to Playwright's browser when Edge is unavailable.
}

const browser = await chromium.launch(launchOptions);
const context = await browser.newContext({
  viewport: { width: 390, height: 500 },
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block'
});
const page = await context.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Settings' }).click();

const panel = page.locator('.settings-panel');
await panel.waitFor();
await page.waitForTimeout(220);
const before = await panel.evaluate((element) => {
  const style = getComputedStyle(element);
  const content = element.closest('.v-overlay__content');
  return {
    top: element.getBoundingClientRect().top,
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
    overscrollBehaviorY: style.overscrollBehaviorY,
    touchAction: style.touchAction,
    contentTransition: content ? getComputedStyle(content).transitionProperty : '',
    contentClass: content?.className || '',
    contentStyle: content?.getAttribute('style') || ''
  };
});

const box = await panel.boundingBox();
if (!box) throw new Error('Settings panel has no bounding box');
const cdp = await page.context().newCDPSession(page);
const x = box.x + box.width / 2;
const startY = Math.min(box.y + box.height - 48, 452);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x, y: startY, radiusX: 4, radiusY: 4, force: 1 }]
});
for (let step = 1; step <= 6; step += 1) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: startY - step * 24, radiusX: 4, radiusY: 4, force: 1 }]
  });
  await page.waitForTimeout(12);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(120);
const after = await panel.evaluate((element) => ({
  top: element.getBoundingClientRect().top,
  scrollTop: element.scrollTop
}));
await browser.close();

const failures = [];
if (before.scrollHeight <= before.clientHeight) failures.push('short mobile viewport did not create internal scrolling');
if (after.scrollTop <= before.scrollTop) failures.push('settings panel did not scroll internally');
if (Math.abs(after.top - before.top) > 0.5) failures.push(`panel moved during internal scroll: ${before.top} -> ${after.top}`);
if (before.backdropFilter !== 'none') failures.push(`expensive backdrop filter remained: ${before.backdropFilter}`);
if (before.overscrollBehaviorY !== 'contain') failures.push(`overscroll is not contained: ${before.overscrollBehaviorY}`);
if (before.touchAction !== 'pan-y') failures.push(`unexpected touch action: ${before.touchAction}`);

console.log(JSON.stringify({ ok: failures.length === 0, url, before, after, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
