import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('public');
const server = http.createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.join(root, pathname);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  const type =
    ext === '.html'
      ? 'text/html'
      : ext === '.js'
        ? 'text/javascript'
        : ext === '.css'
          ? 'text/css'
          : 'application/octet-stream';
  response.writeHead(200, { 'content-type': type });
  fs.createReadStream(filePath).pipe(response);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitForTheme(page, 'dark', 'system');
  const darkSystem = await readTheme(page);

  await setSystemColorScheme(page, 'light');
  const lightSystem = await readTheme(page);

  await page.locator('#themeToggleButton').click();
  await page.waitForTimeout(80);
  const forcedDark = await readTheme(page);

  await page.locator('#themeToggleButton').click();
  await page.waitForTimeout(80);
  const forcedLight = await readTheme(page);

  await page.locator('#themeToggleButton').click();
  await page.waitForTimeout(80);
  const backToSystem = await readTheme(page);

  const migratedPage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await migratedPage.emulateMedia({ colorScheme: 'dark' });
  await migratedPage.goto(url, { waitUntil: 'domcontentloaded' });
  await migratedPage.evaluate(() => {
    localStorage.setItem('linguago-settings-v1', JSON.stringify({ theme: 'light' }));
  });
  await migratedPage.reload({ waitUntil: 'domcontentloaded' });
  await waitForTheme(migratedPage, 'dark', 'system');
  const migratedOldTheme = await readTheme(migratedPage);
  await migratedPage.close();

  console.log(
    JSON.stringify({ darkSystem, lightSystem, forcedDark, forcedLight, backToSystem, migratedOldTheme }, null, 2)
  );

  if (darkSystem.theme !== 'dark' || darkSystem.preference !== 'system')
    throw new Error('dark system theme did not apply');
  if (lightSystem.theme !== 'light' || lightSystem.preference !== 'system')
    throw new Error('light system theme did not apply');
  if (forcedDark.theme !== 'dark' || forcedDark.preference !== 'dark')
    throw new Error('forced dark theme did not apply');
  if (forcedLight.theme !== 'light' || forcedLight.preference !== 'light')
    throw new Error('forced light theme did not apply');
  if (backToSystem.theme !== 'light' || backToSystem.preference !== 'system')
    throw new Error('theme did not cycle back to system');
  if (migratedOldTheme.theme !== 'dark' || migratedOldTheme.preference !== 'system')
    throw new Error('old stored theme did not migrate to system');
} finally {
  await browser.close();
  server.close();
}

async function setSystemColorScheme(page, colorScheme) {
  await page.emulateMedia({ colorScheme });
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
  });
  await waitForTheme(page, colorScheme, 'system');
}

async function waitForTheme(page, theme, preference) {
  await page.waitForFunction(
    ({ theme, preference }) =>
      document.documentElement.dataset.theme === theme &&
      document.documentElement.dataset.themePreference === preference,
    { theme, preference },
    { timeout: 1500 }
  );
}

async function readTheme(page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    preference: document.documentElement.dataset.themePreference,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    themeColors: Array.from(document.querySelectorAll("meta[name='theme-color']")).map((node) =>
      node.getAttribute('content')
    ),
    buttonBox: document.querySelector('#themeToggleButton')?.getBoundingClientRect().toJSON()
  }));
}
