import { chromium } from 'playwright';

const url = 'https://translation-pwa.qhzggzh-linguago.workers.dev';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#textInput');

function roundedRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    top: Math.round(rect.top),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

async function snapshot(label) {
  return page.evaluate((name) => {
    const rectFor = (selector) => {
      const node = document.querySelector(selector);
      if (!node) {
        return null;
      }

      const rect = node.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };

    return {
      label: name,
      scrollY: Math.round(window.scrollY),
      bodyClasses: document.body.className,
      resultBusy: document.querySelector('#resultCard')?.getAttribute('aria-busy'),
      modeText: document.querySelector('#modeBadge')?.textContent?.trim(),
      statusText: document.querySelector('#statusText')?.textContent?.trim(),
      translator: rectFor('.translator-card'),
      result: rectFor('#resultCard'),
      resultHead: rectFor('.result-head'),
      tabs: rectFor('#resultLanguageTabs'),
      translation: rectFor('#translationCard'),
      clearButton: rectFor('#clearButton'),
      translateButton: rectFor('#translateButton')
    };
  }, label);
}

function delta(after, before, selector) {
  const a = after[selector];
  const b = before[selector];
  if (!a || !b) {
    return null;
  }

  return {
    top: a.top - b.top,
    height: a.height - b.height,
    bottom: a.bottom - b.bottom
  };
}

const before = await snapshot('before-input');
await page.locator('#textInput').fill('hello');
const filled = await snapshot('filled-before-click');
await page.locator('#translateButton').tap();
await page.waitForSelector('#resultCard:not(.hidden)');
await page.waitForTimeout(150);
const loading = await snapshot('loading-150ms');
await page.waitForSelector("#resultCard:not([aria-busy='true'])", { timeout: 30000 });
await page.waitForTimeout(450);
const result = await snapshot('result-450ms');

const report = {
  url,
  before,
  filled,
  loading,
  result,
  deltas: {
    clickFilledToLoading: {
      translator: delta(loading, filled, 'translator'),
      result: delta(loading, filled, 'result'),
      resultHead: delta(loading, filled, 'resultHead'),
      tabs: delta(loading, filled, 'tabs'),
      translation: delta(loading, filled, 'translation'),
      clearButton: delta(loading, filled, 'clearButton'),
      translateButton: delta(loading, filled, 'translateButton')
    },
    loadingToResult: {
      translator: delta(result, loading, 'translator'),
      result: delta(result, loading, 'result'),
      resultHead: delta(result, loading, 'resultHead'),
      tabs: delta(result, loading, 'tabs'),
      translation: delta(result, loading, 'translation'),
      clearButton: delta(result, loading, 'clearButton'),
      translateButton: delta(result, loading, 'translateButton')
    }
  }
};

console.log(JSON.stringify(report, null, 2));

await browser.close();
