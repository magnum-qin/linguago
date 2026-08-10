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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
let requests = 0;

await page.route('**/api/translate-stream', async () => {
  requests += 1;
  await new Promise(() => {});
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('textarea').fill('Long translation request');
const action = page.getByTestId('translation-action');
await action.click();
await page.getByText('中止 / Parar').waitFor();
await action.click();
await page.getByText('翻译 / Traduzir').waitFor();
await page.waitForTimeout(100);

const result = {
  requests,
  actionText: (await action.innerText()).trim(),
  errorVisible: await page.getByText(/^Error:/).count()
};
await browser.close();

const failures = [];
if (result.requests !== 1) failures.push(`expected one translation request, got ${result.requests}`);
if (!result.actionText.includes('翻译')) failures.push(`button did not return to translate state: ${result.actionText}`);
if (result.errorVisible !== 0) failures.push('aborting displayed an error result');

console.log(JSON.stringify({ ok: failures.length === 0, url, result, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
