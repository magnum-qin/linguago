import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const url = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const outDir = path.resolve('output/playwright/online-dictionary-focused');
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const traditionalSmokeChars =
  /[\u9019\u500b\u5011\u4f86\u8aaa\u6642\u9084\u5f8c\u767c\u807d\u8207\u5c0d\u6703\u8868\u5b78\u958b\u95dc\u9ad4]/u;
const viewports = [
  { name: 'mobile', width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1366, height: 900, isMobile: false, hasTouch: false }
];
const terms = [
  {
    term: '\u4e2d',
    expectedText: ['zhong', 'medium; intermediary', 'm\u00e9dio']
  },
  {
    term: '\u6746',
    expectedText: ['gan', 'pole; post; staff', '\u68d2; \u7aff', 'haste; poste; vara']
  },
  {
    term: '\u4f60\u597d',
    expectedText: ['hello', '\u4f60\u597d', '\u3053\u3093\u306b\u3061\u306f', 'ol\u00e1']
  },
  // The UI renders only the selected target-language result for a word
  // lookup; assert that any of the four localization terms appears.
  { term: 'inside', expectedText: ['inside', '\u91cc\u9762', 'dentro'] },
  { term: '\u79d8\u5bc6', expectedText: ['secret', '\u79d8\u5bc6', 'segredo'] },
  { term: '\u4f55\u6642', expectedText: ['when', '\u4f55\u6642', '\u4f55\u65f6', 'quando'] },
  { term: '\u56fd\u969b', expectedText: ['international', '\u56fd\u969b', '\u56fd\u9645\u7684', 'internacional'] },
  { term: '\u30d3\u30b8\u30bf\u30fc', expectedText: ['visitor', '\u8bbf\u5ba2', '\u30d3\u30b8\u30bf\u30fc', 'visitante'] },
  { term: 'maremoto', expectedText: ['seaquake', '\u6d77\u9707', 'maremoto'] },
  { term: 'is\u00f4mero', expectedText: ['isomer', '\u5f02\u6784\u4f53', '\u7570\u6027\u4f53', 'is\u00f4mero'] },
  { term: 'eucarionte', expectedText: ['eukaryote', '\u771f\u6838\u751f\u7269', 'eucarionte'] },
  { term: 'comercializa\u00e7\u00e3o', expectedText: ['commercialization', '\u5546\u4e1a\u5316', '\u5546\u696d\u5316', 'comercializa\u00e7\u00e3o'] },
  { term: 'radicalismo', expectedText: ['radicalism', '\u6fc0\u8fdb\u4e3b\u4e49', '\u6025\u9032\u4e3b\u7fa9', 'radicalismo'] },
  { term: 'supersimetria', expectedText: ['supersymmetry', '\u8d85\u5bf9\u79f0', '\u8d85\u5bfe\u79f0\u7406\u8ad6', 'supersimetria'] }
];

await fs.mkdir(outDir, { recursive: true });

const launchOptions = { headless: true };
if (await exists(edgePath)) {
  launchOptions.executablePath = edgePath;
}

const report = {
  url,
  generated_at: new Date().toISOString(),
  browser: launchOptions.executablePath ? 'msedge' : 'playwright-chromium',
  viewports: []
};

try {
  for (const viewport of viewports) {
    const browser = await chromium.launch(launchOptions);
    try {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: viewport.isMobile ? 2 : 1,
        isMobile: viewport.isMobile,
        hasTouch: viewport.hasTouch
      });
      const viewportReport = { name: viewport.name, terms: [] };
      for (const [index, item] of terms.entries()) {
        if (index > 0) {
          // Pace browser-driven lookups so bursts stay clear of any
          // provider-side throttling between items.
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        viewportReport.terms.push(await checkRenderedTerm(page, item, viewport.name, index + 1));
      }
      await page.close();
      report.viewports.push(viewportReport);
    } finally {
      await browser.close();
    }
  }
} finally {
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
}

console.log(JSON.stringify(report, null, 2));
const failures = report.viewports.flatMap((viewport) =>
  viewport.terms.flatMap((item) => item.errors.map((error) => `${viewport.name}/${item.term}: ${error}`))
);
if (failures.length > 0) {
  console.error(`Focused render check failed:\n${failures.join('\n')}`);
  process.exit(1);
}

async function checkRenderedTerm(page, item, viewportName, ordinal) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  let rendered = false;
  const expectedStableText = item.expectedText.map(normalizeSearchText);
  for (let attempt = 1; attempt <= 3 && !rendered; attempt += 1) {
    if (attempt > 1) {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    }
    const textarea = page.locator('textarea').first();
    await textarea.fill(item.term);
    await page.waitForFunction(
      (expected) => document.querySelector('textarea')?.value === expected,
      item.term,
      { timeout: 5000 }
    );
    await page.waitForTimeout(500);
    if ((await textarea.inputValue()) !== item.term) {
      await textarea.fill(item.term);
      await page.waitForTimeout(250);
    }
    const translateButton = page
      .locator('button')
      .filter({ hasText: /\u7ffb\u8bd1|Traduzir/i })
      .last();
    await translateButton.waitFor({ state: 'visible' });
    await translateButton.click();
    rendered = await page
      .waitForFunction(
        (expected) => {
          const text = document.body.innerText
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase();
          return expected.some((value) => text.includes(value));
        },
        expectedStableText,
        { timeout: attempt === 1 ? 15000 : 45000 }
      )
      .then(() => true)
      .catch(() => false);
    if (rendered) {
      await page.waitForTimeout(750);
      rendered = await page.evaluate(
        (expected) => {
          const text = document.body.innerText
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase();
          return expected.some((value) => text.includes(value));
        },
        expectedStableText
      );
    }
  }
  if (!rendered) throw new Error(`No rendered result after retrying ${item.term}`);
  await page.waitForTimeout(900);

  const tabTexts = await collectTabTexts(page);
  const screenshot = `${viewportName}-${String(ordinal).padStart(2, '0')}-${safeName(item.term)}.png`;
  await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });

  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      title: document.querySelector('h1')?.textContent?.trim() || '',
      visibleTextPreview: text.slice(0, 2500),
      hasDictionary: /dictionary|dicion/i.test(text),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }
    };
  });

  const errors = [];
  if (!state.hasDictionary) errors.push('page did not render a dictionary result');
  if (state.hasHorizontalOverflow) errors.push('page has horizontal overflow');

  const combinedText = [state.visibleTextPreview, ...tabTexts.map((tab) => tab.visibleText)]
    .join('\n')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  for (const expected of item.expectedText) {
    const normalizedExpected = expected
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase();
    if (!combinedText.includes(normalizedExpected)) errors.push(`missing visible text ${expected}`);
  }

  const chineseTabText = tabTexts.find((tab) => /ZH|\u4e2d/i.test(tab.label))?.visibleText || combinedText;
  if (traditionalSmokeChars.test(chineseTabText)) {
    errors.push('Chinese tab contains likely Traditional Chinese characters');
  }

  return {
    term: item.term,
    ok: errors.length === 0,
    screenshot,
    tabTexts: tabTexts.map((tab) => ({ label: tab.label, preview: tab.visibleText.slice(0, 700) })),
    ...state,
    errors
  };
}

async function collectTabTexts(page) {
  const tabs = page.locator('[role="tab"], .v-tab, .custom-tab-btn');
  const count = await tabs.count();
  const states = [];
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    const label = (await tab.textContent().catch(() => ''))?.trim() || `tab-${i}`;
    await tab.click().catch(() => {});
    await page.waitForTimeout(300);
    const visibleText = await page.evaluate(() => document.body.innerText);
    states.push({ label, visibleText });
  }
  return states;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeName(value) {
  return (
    value
      .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'term'
  );
}

function normalizeSearchText(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
