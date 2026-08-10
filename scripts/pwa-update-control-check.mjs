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
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true
});
const page = await context.newPage();
let updateChecks = 0;

page.on('request', (request) => {
  if (request.url().includes('__pwa_update=')) updateChecks += 1;
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Settings' }).click();
const button = page.getByTestId('check-pwa-update');
await button.click();
await page.getByText('已是最新版本 / Atualizado').waitFor();

const result = {
  updateChecks,
  buttonText: (await button.innerText()).trim(),
  disabled: await button.isDisabled()
};
await browser.close();

const failures = [];
if (result.updateChecks !== 1) failures.push(`expected one cache-bypassing update check, got ${result.updateChecks}`);
if (!result.buttonText.includes('已是最新版本')) failures.push(`unexpected button text: ${result.buttonText}`);
if (result.disabled) failures.push('update button remained disabled after the check');

console.log(JSON.stringify({ ok: failures.length === 0, url, result, failures }, null, 2));
if (failures.length > 0) process.exitCode = 1;
