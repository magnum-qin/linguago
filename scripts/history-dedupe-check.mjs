import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const publicDir = path.resolve('public');
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const filePath = path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(publicDir)) return response.writeHead(403).end();
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      'content-type': ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'text/html'
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.route('**/api/settings', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
);
await page.route('**/api/dictionary/stats', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted_words":3158}' })
);
await page.route('**/api/translate', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const text = body.text || '';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      type: 'word',
      original: text,
      target_lang: 'en',
      detected_source_lang: 'auto',
      translation: `${text}-translated`,
      translations: {
        en: { text: `${text}-translated`, phonetic: '', audio_text: text },
        'pt-BR': { text: text, phonetic: '', audio_text: text },
        zh: { text: text, phonetic: '', audio_text: text },
        ja: { text: text, phonetic: '', audio_text: text }
      },
      word_details: {},
      examples: []
    })
  });
});

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle' });

async function translate(text) {
  await page.locator('#textInput').fill(text);
  await page.locator('#translateButton').click();
  await page.waitForSelector('#translateButton:not(.loading)');
}

await translate('apple');
await translate('banana');
await translate('apple');

const history = await page.evaluate(() =>
  JSON.parse(localStorage.getItem('linguago-history-v5') || '[]').map((item) => item.source)
);

console.log(JSON.stringify({ history, uniqueCount: new Set(history).size }, null, 2));

await browser.close();
server.close();
