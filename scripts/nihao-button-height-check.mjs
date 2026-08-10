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

async function snapshot(label) {
  return page.evaluate((name) => {
    const input = document.querySelector('#textInput');
    const buttonLabel = document.querySelector("#translateButton [data-i18n='translate']");
    const inputRect = input?.getBoundingClientRect();
    return {
      label: name,
      inputHeight: Math.round(inputRect?.height || 0),
      inputTop: Math.round(inputRect?.top || 0),
      buttonText: buttonLabel?.innerText || '',
      buttonSlashCount: (buttonLabel?.innerText.match(/\//g) || []).length,
      buttonLineCount: buttonLabel ? buttonLabel.innerText.split(/\n+/).filter(Boolean).length : 0
    };
  }, label);
}

await page.locator('#textInput').fill('你好');
await page.waitForTimeout(250);
const before = await snapshot('before-translate');
await page.locator('#translateButton').tap();
await page.waitForSelector('#resultCard:not(.hidden)');
await page.waitForTimeout(1200);
const after = await snapshot('after-translate');

console.log(
  JSON.stringify(
    {
      url,
      before,
      after,
      heightDelta: after.inputHeight - before.inputHeight
    },
    null,
    2
  )
);

await browser.close();
