import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const outDir = path.resolve('output/playwright/online-ui-smoke');
const terms = [
  { term: 'hello', expectProvider: 'dictionary', expectText: ['hello', '/həˈloʊ/', '你好'] },
  { term: '\u4f60\u597d', expectProvider: 'dictionary', expectText: ['hello', 'nǐ hǎo', '你好'] },
  { term: 'appearance', expectProvider: 'dictionary', expectText: ['appearance', '/əˈpɪərəns/', '样子'] },
  { term: 'notindictionarywordxyz', expectProvider: 'ai-or-error', expectText: [] }
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

const page = await context.newPage();
const consoleMessages = [];
const failedRequests = [];
const apiResponses = [];

page.on('console', (message) => {
  const text = message.text();
  if (!text.includes('Download the Vue Devtools')) {
    consoleMessages.push({ type: message.type(), text });
  }
});
page.on('requestfailed', (request) => {
  failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText || ''
  });
});
page.on('response', (response) => {
  if (response.url().includes('/api/translate') || response.url().includes('/api/dictionary/stats')) {
    apiResponses.push({ url: response.url(), status: response.status() });
  }
});

const report = {
  url,
  generated_at: new Date().toISOString(),
  viewport: '390x844 mobile',
  terms: [],
  consoleMessages,
  failedRequests,
  apiResponses
};

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.screenshot({ path: path.join(outDir, '00-initial.png'), fullPage: true });

  for (const [index, test] of terms.entries()) {
    const item = await runTerm(page, test, index + 1);
    report.terms.push(item);
  }

  await page.setViewportSize({ width: 1365, height: 768 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await submitTerm(page, 'hello');
  await page.screenshot({ path: path.join(outDir, 'desktop-hello.png'), fullPage: true });
  report.desktop = await collectState(page);
} finally {
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));

async function runTerm(page, test, ordinal) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const start = Date.now();
  let error = '';
  try {
    await submitTerm(page, test.term, test.expectProvider === 'ai-or-error' ? 70000 : 35000);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const state = await collectState(page);
  const tabStates = await collectTabStates(page);
  const screenshot = `${String(ordinal).padStart(2, '0')}-${safeName(test.term)}.png`;
  await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });

  const text = [state.visibleText, ...tabStates.map((tab) => tab.visibleText)].join('\n');
  const missingExpectedText = test.expectText.filter((value) => !text.includes(value));
  const providerOk =
    test.expectProvider === 'ai-or-error'
      ? state.provider !== 'dictionary' || Boolean(error)
      : state.provider === test.expectProvider;

  return {
    term: test.term,
    elapsed_ms: Date.now() - start,
    screenshot,
    error,
    provider_ok: providerOk,
    missing_expected_text: missingExpectedText,
    state,
    tabStates
  };
}

async function submitTerm(page, term, timeout = 35000) {
  const textarea = page.locator('textarea').first();
  await textarea.fill(term);
  await page
    .locator('button')
    .filter({ hasText: /Traduzir/i })
    .last()
    .click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText.toLowerCase();
      return text.includes('dictionary') || text.includes('dicion') || text.includes('ai') || text.includes('error:');
    },
    undefined,
    { timeout }
  );
  await page.waitForTimeout(500);
}

async function collectTabStates(page) {
  const tabs = page.locator('[role="tab"], .v-tab');
  const count = await tabs.count();
  const states = [];
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    const label = (await tab.textContent().catch(() => ''))?.trim() || `tab-${i}`;
    await tab.click().catch(() => {});
    await page.waitForTimeout(250);
    const state = await collectState(page);
    states.push({ label, ...state });
  }
  return states;
}

async function collectState(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText;
    const resultCards = Array.from(document.querySelectorAll("section div[class*='rounded']"));
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .v-tab')).map((node) => node.textContent?.trim());
    const lines = bodyText
      .split(/\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    const provider = lines.some((line) => line === 'DICIONÁRIO PRINCIPAL' || line === 'Dicionário Principal')
      ? 'dictionary'
      : lines.some((line) => line === 'EM CACHE' || line === 'Em cache')
        ? 'cached'
        : lines.includes('AI')
          ? 'ai'
          : bodyText.includes('Error:')
            ? 'error'
            : 'unknown';
    return {
      provider,
      title: document.querySelector('h1')?.textContent?.trim() || '',
      tabs,
      visibleText: bodyText,
      visibleTextPreview: bodyText.slice(0, 1200),
      resultCardCount: resultCards.length,
      buttonCount: document.querySelectorAll('button').length,
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }
    };
  });
}

function safeName(value) {
  return (
    value
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'term'
  );
}
