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
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('load');
await page.getByRole('button', { name: 'Settings' }).click();

const panel = page.locator('.m3-dialog-card--fixed');
const scroller = page.locator('.m3-dialog-body');
await panel.waitFor();
await page.waitForTimeout(220);
const before = await scroller.evaluate((element) => {
  const panel = element.closest('.m3-dialog-card--fixed');
  const style = getComputedStyle(panel);
  const scrollerStyle = getComputedStyle(element);
  const content = panel.closest('.v-overlay__content');
  return {
    top: panel.getBoundingClientRect().top,
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    backdropFilter: style.backdropFilter || style.webkitBackdropFilter || '',
    overscrollBehaviorY: scrollerStyle.overscrollBehaviorY,
    touchAction: scrollerStyle.touchAction,
    contentTransition: content ? getComputedStyle(content).transitionProperty : '',
    contentClass: content?.className || '',
    contentStyle: content?.getAttribute('style') || ''
  };
});

const cdp = await page.context().newCDPSession(page);
const headerBox = await page.locator('.m3-dialog-header').boundingBox();
if (!headerBox) throw new Error('Settings header has no bounding box');
const headerX = headerBox.x + headerBox.width / 2;
const headerStartY = headerBox.y + headerBox.height / 2;
const pageScrollBeforeHeaderDrag = await page.evaluate(() => window.scrollY);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: headerX, y: headerStartY, radiusX: 4, radiusY: 4, force: 1 }]
});
for (let step = 1; step <= 5; step += 1) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: headerX, y: headerStartY + step * 20, radiusX: 4, radiusY: 4, force: 1 }]
  });
  await page.waitForTimeout(12);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(100);
const afterHeaderDrag = await panel.evaluate((element) => ({
  top: element.getBoundingClientRect().top,
  pageScroll: window.scrollY
}));

const box = await scroller.boundingBox();
if (!box) throw new Error('Settings scroll body has no bounding box');
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
const after = await scroller.evaluate((element) => ({
  top: element.closest('.m3-dialog-card--fixed').getBoundingClientRect().top,
  scrollTop: element.scrollTop
}));

await page.locator('.m3-native-select').first().click();
await page.getByText('Cloudflare Workers AI', { exact: true }).last().click();
const fixedBeforeEditor = await panel.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, height: rect.height };
});
await page.getByRole('button', { name: '编辑模型 / Editar' }).click();
await page.waitForTimeout(380);
const editorState = await panel.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  const body = element.querySelector('.m3-dialog-body');
  return {
    top: rect.top,
    height: rect.height,
    bodyScrollHeight: body?.scrollHeight || 0,
    bodyClientHeight: body?.clientHeight || 0
  };
});
const modelRows = await page.locator('.model-row').count();
const closeButtonName = await page
  .getByRole('button', { name: '关闭设置 / Fechar configurações' })
  .getAttribute('aria-label');
await page.mouse.click(5, 5);
await panel.waitFor({ state: 'hidden' });
await page.getByRole('button', { name: 'Settings' }).click();
const providerAfterScrimClose = await page.locator('#translation-provider').inputValue();
await browser.close();

const failures = [];
if (before.scrollHeight <= before.clientHeight)
  failures.push('short mobile viewport did not create internal scrolling');
if (after.scrollTop <= before.scrollTop) failures.push('settings panel did not scroll internally');
if (Math.abs(after.top - before.top) > 0.5)
  failures.push(`panel moved during internal scroll: ${before.top} -> ${after.top}`);
if (before.backdropFilter !== 'none') failures.push(`expensive backdrop filter remained: ${before.backdropFilter}`);
if (before.overscrollBehaviorY !== 'contain')
  failures.push(`overscroll is not contained: ${before.overscrollBehaviorY}`);
if (before.touchAction !== 'pan-y') failures.push(`unexpected touch action: ${before.touchAction}`);
if (Math.abs(afterHeaderDrag.top - before.top) > 0.5)
  failures.push(`panel moved when its header was dragged: ${before.top} -> ${afterHeaderDrag.top}`);
if (afterHeaderDrag.pageScroll !== pageScrollBeforeHeaderDrag)
  failures.push(
    `page scrolled when the dialog header was dragged: ${pageScrollBeforeHeaderDrag} -> ${afterHeaderDrag.pageScroll}`
  );
if (Math.abs(editorState.top - fixedBeforeEditor.top) > 0.5)
  failures.push(`panel moved when model manager opened: ${fixedBeforeEditor.top} -> ${editorState.top}`);
if (Math.abs(editorState.height - fixedBeforeEditor.height) > 0.5)
  failures.push(`panel height changed when model manager opened: ${fixedBeforeEditor.height} -> ${editorState.height}`);
if (editorState.bodyScrollHeight <= editorState.bodyClientHeight)
  failures.push('model manager did not keep long content inside the dialog scroll body');
if (modelRows < 1) failures.push('model manager rendered no model rows');
if (closeButtonName !== '关闭设置 / Fechar configurações')
  failures.push('settings close button has no accessible name');
if (providerAfterScrimClose !== '智能路由 / Auto')
  failures.push(`scrim close did not revert settings like the close button: ${providerAfterScrimClose}`);

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      url,
      before,
      afterHeaderDrag,
      after,
      fixedBeforeEditor,
      editorState,
      modelRows,
      providerAfterScrimClose,
      failures
    },
    null,
    2
  )
);
if (failures.length > 0) process.exitCode = 1;
