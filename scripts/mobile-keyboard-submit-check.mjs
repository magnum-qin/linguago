import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const url = process.env.PWA_URL || 'http://127.0.0.1:4174';
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const launchOptions = { headless: true };
try {
  await fs.access(edgePath);
  launchOptions.executablePath = edgePath;
} catch {
  // Fall back to Playwright's browser when Edge is unavailable.
}
const browser = await chromium.launch(launchOptions);

async function checkContext(options) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  let requests = 0;

  await page.route('**/api/translate-stream', async (route) => {
    requests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: '{"event":"done","data":{"ok":true}}\n'
    });
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  const textarea = page.locator('textarea').first();
  await textarea.fill('Mobile keyboard submission test');
  await textarea.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(80);

  const result = await page.evaluate(() => {
    const input = document.querySelector('textarea');
    return {
      activeTag: document.activeElement?.tagName || '',
      activeIsTextarea: document.activeElement === input,
      enterKeyHint: input?.getAttribute('enterkeyhint') || '',
      value: input?.value || ''
    };
  });

  await context.close();
  return { ...result, requests };
}

const mobile = await checkContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});

const desktop = await checkContext({ viewport: { width: 1280, height: 800 } });
await browser.close();

const failures = [];
if (mobile.requests !== 1) failures.push(`mobile requests: expected 1, got ${mobile.requests}`);
if (mobile.activeIsTextarea) failures.push('mobile textarea remained focused');
if (mobile.enterKeyHint !== 'go') failures.push(`mobile enterkeyhint: expected go, got ${mobile.enterKeyHint}`);
if (mobile.value.includes('\n')) failures.push('mobile Enter inserted a newline');
if (desktop.requests !== 1) failures.push(`desktop requests: expected 1, got ${desktop.requests}`);
if (!desktop.activeIsTextarea) failures.push('desktop textarea lost focus');

console.log(JSON.stringify({ ok: failures.length === 0, url, mobile, desktop, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
