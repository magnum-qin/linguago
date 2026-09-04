import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://translation-pwa.qhzggzh-linguago.workers.dev', {
  waitUntil: 'domcontentloaded'
});

const payload = await page.evaluate(async () => {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: `hello ${Date.now()}`,
      source_lang: 'auto',
      target_lang: 'zh',
      provider: 'auto',
      model: 'qwen3.8-flash'
    })
  });
  return {
    status: response.status,
    text: await response.text()
  };
});

console.log(JSON.stringify(payload, null, 2));
await browser.close();
