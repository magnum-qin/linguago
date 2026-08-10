const base = process.env.API_BASE_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const runTranslate = process.env.RUN_TRANSLATE === '1';

async function readJson(path, init) {
  const response = await fetch(new URL(path, base), init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { path, status: response.status, ok: response.ok, json };
}

const checks = [await readJson('/api/health'), await readJson('/api/models'), await readJson('/api/settings')];

if (runTranslate) {
  checks.push(
    await readJson('/api/translate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: process.env.SMOKE_TEXT || '你好',
        source_lang: 'auto',
        target_lang: process.env.SMOKE_TARGET || 'en',
        provider: process.env.SMOKE_PROVIDER || 'auto',
        model: process.env.SMOKE_MODEL || undefined
      })
    })
  );
}

console.log(JSON.stringify({ base, runTranslate, checks }, null, 2));

if (checks.some((check) => !check.ok)) {
  process.exitCode = 1;
}
