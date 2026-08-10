import { chromium } from 'playwright';

const url = 'https://translation-pwa.qhzggzh-linguago.workers.dev';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#resultCard');

async function snapshot(label) {
  return page.evaluate((name) => {
    const result = document.querySelector('#resultCard')?.getBoundingClientRect();
    const tabs = document.querySelector('#resultLanguageTabs')?.getBoundingClientRect();
    const translation = document.querySelector('#translationCard')?.getBoundingClientRect();
    const activeTab = document.querySelector('.result-tab.active')?.getBoundingClientRect();
    return {
      label: name,
      bodyClasses: document.body.className,
      result: result ? { width: Math.round(result.width), height: Math.round(result.height) } : null,
      resultTop: result ? Math.round(result.top) : null,
      tabs: tabs ? { width: Math.round(tabs.width), height: Math.round(tabs.height) } : null,
      tabsTop: tabs ? Math.round(tabs.top) : null,
      translation: translation
        ? { width: Math.round(translation.width), height: Math.round(translation.height) }
        : null,
      activeTab: activeTab ? { width: Math.round(activeTab.width), height: Math.round(activeTab.height) } : null
    };
  }, label);
}

const idle = await snapshot('idle');
await page.locator('#textInput').fill('你好');
await page.locator('#translateButton').click();
await page.waitForTimeout(250);
const loading = await snapshot('loading');
await page.waitForSelector("#resultCard:not([aria-busy='true'])", { timeout: 30000 });
await page.waitForTimeout(650);
const result = await snapshot('result');

console.log(
  JSON.stringify(
    {
      url,
      idle,
      loading,
      result,
      tabHeightDeltaIdleToLoading: loading.tabs.height - idle.tabs.height,
      tabTopDeltaIdleToLoading: loading.tabsTop - idle.tabsTop,
      tabTopDeltaLoadingToResult: result.tabsTop - loading.tabsTop,
      translationHeightDeltaIdleToLoading: loading.translation.height - idle.translation.height,
      translationHeightDeltaLoadingToResult: result.translation.height - loading.translation.height
    },
    null,
    2
  )
);

await browser.close();
