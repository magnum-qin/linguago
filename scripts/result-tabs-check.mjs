import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('.');
const publicDir = join(root, 'public');
const port = 4176;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const mockTranslation = {
  original: '你好',
  type: 'word',
  translation: '你好',
  detected_source_lang: 'zh',
  provider: 'mock',
  model: 'mock',
  translations: {
    zh: { text: '你好', phonetic: 'ni hao', audio_text: '你好' },
    en: { text: 'Hello', phonetic: 'heh-low', audio_text: 'Hello' },
    'pt-BR': { text: 'Olá', phonetic: 'o-la', audio_text: 'Olá' },
    ja: { text: 'こんにちは', phonetic: 'konnichiwa', audio_text: 'こんにちは' }
  },
  word_details: {
    zh: { word: '你好', definition: '用于问候。' },
    en: { word: 'Hello', definition: 'A greeting.' },
    'pt-BR': { word: 'Olá', definition: 'Uma saudação.' },
    ja: { word: 'こんにちは', definition: '挨拶。' }
  },
  examples: [
    {
      sentence: '你好，很高兴见到你。',
      translations: {
        zh: '你好，很高兴见到你。',
        en: 'Hello, nice to meet you.',
        'pt-BR': 'Olá, prazer em conhecer você.',
        ja: 'こんにちは、お会いできてうれしいです。'
      }
    }
  ]
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);

  if (url.pathname === '/api/settings') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ provider: 'auto', model: 'mock-model' }));
    return;
  }

  if (url.pathname === '/api/translate') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(mockTranslation));
    return;
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(publicDir, pathname);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream'
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

await new Promise((resolveServer) => server.listen(port, '127.0.0.1', resolveServer));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });

  const initial = await page.evaluate(() => ({
    hasThemeTopButton: Boolean(document.querySelector('#themeToggleButton')),
    hasSettingsTopButton: Boolean(document.querySelector('#settingsButton')),
    oldThemeToggleInSettings: Boolean(document.querySelector('#themeToggle')),
    oldLanguageTabs: document.querySelectorAll('.lang-tab').length
  }));

  await page.click('#settingsButton');
  const settings = await page.evaluate(() => ({
    overlayRect: document.querySelector('#settingsOverlay')?.getBoundingClientRect().toJSON(),
    hasDarkModeText: document.querySelector('#settingsPanel')?.textContent?.includes('暗黑模式') || false
  }));
  await page.mouse.click(5, 5);
  await page.fill('#textInput', '你好');
  await page.click('#translateButton');
  await page.waitForSelector('#resultCard:not(.hidden)');

  const en = await readResultState(page);
  await page.click(".result-tab[data-lang='pt-BR']");
  const pt = await readResultState(page);
  await page.click(".result-tab[data-lang='zh']");
  const zh = await readResultState(page);
  await page.click(".result-tab[data-lang='ja']");
  const ja = await readResultState(page);

  console.log(
    JSON.stringify(
      {
        initial,
        settings,
        en,
        pt,
        zh,
        ja
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
  server.close();
}

async function readResultState(page) {
  return page.evaluate(() => ({
    activeLang: document.querySelector('.result-tab.active')?.getAttribute('data-lang'),
    tabOrder: Array.from(document.querySelectorAll('.result-tab')).map((tab) => tab.getAttribute('data-lang')),
    tabCount: document.querySelectorAll('.result-tab').length,
    lineCount: document.querySelectorAll('#translationCard .compact-line').length,
    text: document.querySelector('#translationCard strong')?.textContent?.trim(),
    detailCount: document.querySelectorAll('#wordDetailsList .word-detail-card').length,
    detailText: document.querySelector('#wordDetailsList .word-detail-card')?.textContent?.trim(),
    exampleCount: document.querySelectorAll('#examplesList .example-card').length,
    exampleText: document.querySelector('#examplesList .example-card')?.textContent?.trim()
  }));
}
