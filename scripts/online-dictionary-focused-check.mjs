import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl = process.env.PWA_URL || 'https://translation-pwa.qhzggzh-linguago.workers.dev';
const outDir = path.resolve('output/online-dictionary-focused-check');
const langs = ['zh', 'en', 'pt-BR', 'ja'];
const expectedCounts = {
  entries: 44549,
  senses: 51738,
  sense_localizations: 206952,
  examples: 3030,
  example_localizations: 11898
};
const traditionalSmokeChars =
  /[\u9019\u500b\u5011\u4f86\u8aaa\u6642\u9084\u5f8c\u767c\u807d\u8207\u5c0d\u6703\u8868\u5b78\u958b\u95dc\u9ad4]/u;

const cases = [
  {
    id: 'zh-zhong-polyphone',
    term: '中',
    minSenses: 5,
    requirePronunciationGroups: true,
    expectedReadings: ['zhōng', 'zhòng'],
    expectedTerms: ['medium; intermediary', 'hit; strike', 'win; be selected']
  },
  {
    id: 'zh-gan-polyphone',
    term: '杆',
    minSenses: 2,
    requirePronunciationGroups: true,
    expectedReadings: ['gān', 'gǎn'],
    expectedTerms: ['pole; post; staff', 'shaft; handle; classifier']
  },
  { id: 'zh-nihao', term: '你好', minSenses: 1, expectedTerms: ['hello'] },
  { id: 'en-inside', term: 'inside', minSenses: 1, requirePronunciationGroups: true, expectedTerms: ['inside'] },
  { id: 'zh-secret', term: '秘密', minSenses: 2, requirePronunciationGroups: true, expectedTerms: ['secret'] },
  { id: 'ja-itsu', term: '何時', minSenses: 3, requirePronunciationGroups: true, expectedTerms: ['when', 'what time'] },
  { id: 'ja-kokusai', term: '国際', minSenses: 2, requirePronunciationGroups: true, expectedTerms: ['international'] },
  {
    id: 'ja-visitor',
    term: 'ビジター',
    minSenses: 2,
    requirePronunciationGroups: true,
    expectedTerms: ['visitor', 'visiting team']
  },
  { id: 'pt-maremoto', term: 'maremoto', minSenses: 1, expectedTerms: ['seaquake', '\u6d77\u9707'] },
  { id: 'pt-isomero', term: 'is\u00f4mero', minSenses: 1, expectedTerms: ['isomer', '\u5f02\u6784\u4f53'] },
  { id: 'pt-eucarionte', term: 'eucarionte', minSenses: 1, expectedTerms: ['eukaryote', '\u771f\u6838\u751f\u7269'] },
  {
    id: 'pt-comercializacao',
    term: 'comercializa\u00e7\u00e3o',
    minSenses: 1,
    expectedTerms: ['commercialization']
  },
  {
    id: 'pt-radicalismo',
    term: 'radicalismo',
    minSenses: 1,
    requirePronunciationGroups: true,
    expectedTerms: ['radicalism']
  },
  {
    id: 'pt-supersimetria',
    term: 'supersimetria',
    minSenses: 1,
    requirePronunciationGroups: true,
    expectedReadings: ['/su.pe.si.me.\u02c8t\u027ei.\u0250/'],
    expectedTerms: ['supersymmetry', '\u8d85\u5bf9\u79f0', '\u8d85\u5bfe\u79f0\u7406\u8ad6']
  },
  { id: 'v94-unilateralmente', term: 'unilateralmente', minSenses: 1, expectedTerms: ['one-sidedly'] },
  { id: 'v94-paleontologia', term: 'paleontologia', minSenses: 1, expectedTerms: ['paleontology'] },
  { id: 'v94-atalaia', term: 'atalaia', minSenses: 1, expectedTerms: ['watchtower'] },
  { id: 'v94-taxonomia', term: 'taxonomia', minSenses: 1, expectedTerms: ['taxonomy'] },
  { id: 'v94-embriologia', term: 'embriologia', minSenses: 1, expectedTerms: ['embryology'] },
  { id: 'v94-condimento', term: 'condimento', minSenses: 1, expectedTerms: ['condiment'] },
  { id: 'v94-climatologia', term: 'climatologia', minSenses: 1, expectedTerms: ['climatology'] },
  { id: 'v94-mineralogia', term: 'mineralogia', minSenses: 1, expectedTerms: ['mineralogy'] },
  { id: 'v94-corola', term: 'corola', minSenses: 1, expectedTerms: ['corolla'] },
  { id: 'v94-racionalismo', term: 'racionalismo', minSenses: 1, expectedTerms: ['rationalism'] },
  {
    id: 'ja-protractor-form-lookup',
    term: '\u5206\u5ea6\u5668',
    minSenses: 1,
    requirePronunciationGroups: true,
    expectedReadings: ['\u3076\u3093\u3069\u304d'],
    expectedTerms: ['protractor', 'transferidor', '\u91cf\u89d2\u5668']
  }
];

await fs.mkdir(outDir, { recursive: true });

const report = {
  baseUrl,
  generated_at: new Date().toISOString(),
  health: await checkHealth(),
  cases: []
};

for (const item of cases) {
  report.cases.push(await checkTerm(item));
}

const failures = [
  ...report.health.errors.map((error) => `health: ${error}`),
  ...report.cases.flatMap((item) => item.errors.map((error) => `${item.id}: ${error}`))
];
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error(`Focused dictionary check failed:\n${failures.join('\n')}`);
  process.exit(1);
}

async function checkHealth() {
  const response = await fetch(new URL('/health', baseUrl), { signal: AbortSignal.timeout(60000) });
  const rawText = await response.text();
  const data = safeJson(rawText);
  const errors = [];
  const stats = data?.dictionary?.stats || {};

  if (!response.ok) errors.push(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  if (!data?.ok) errors.push('health ok is not true');
  if (stats.source !== 'cloudflare-d1-v2') errors.push(`dictionary source is ${stats.source || 'missing'}`);
  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (Number(stats[key]) !== expected) errors.push(`${key} is ${stats[key]}, expected ${expected}`);
  }

  return { ok: errors.length === 0, status: response.status, stats, errors };
}

async function checkTerm(item) {
  const started = Date.now();
  const response = await fetch(new URL('/api/translate', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: item.term,
      source_lang: 'auto',
      target_lang: 'en',
      provider: 'auto'
    }),
    signal: AbortSignal.timeout(60000)
  });

  const rawText = await response.text();
  const data = safeJson(rawText);
  const errors = [];

  if (!response.ok) errors.push(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  if (!data || typeof data !== 'object') errors.push('response is not a JSON object');
  if (data?.provider !== 'dictionary') errors.push(`provider is ${data?.provider || 'missing'}, expected dictionary`);
  if (data?.model !== 'cloudflare-d1-v2')
    errors.push(`model is ${data?.model || 'missing'}, expected cloudflare-d1-v2`);
  if (data?.type !== 'word') errors.push(`type is ${data?.type || 'missing'}, expected word`);

  const senses = Array.isArray(data?.senses) ? data.senses : [];
  if (senses.length < item.minSenses) errors.push(`senses length ${senses.length}, expected >= ${item.minSenses}`);

  for (const [index, sense] of senses.entries()) {
    const expectedOrder = index + 1;
    if (sense.sense_order !== expectedOrder) {
      errors.push(`sense ${index} order is ${sense.sense_order}, expected ${expectedOrder}`);
    }
    for (const lang of langs) {
      const localization = sense.localizations?.[lang];
      const definition = sense.definitions?.[lang] || localization?.definition;
      if (!localization?.term) errors.push(`sense ${expectedOrder} missing ${lang} localization.term`);
      if (!definition) errors.push(`sense ${expectedOrder} missing ${lang} definition`);
    }
  }

  const groups = Array.isArray(data?.pronunciation_groups) ? data.pronunciation_groups : [];
  if (item.requirePronunciationGroups && groups.length === 0) errors.push('missing pronunciation_groups');
  if (groups.length > 0) {
    const groupedSenseOrders = groups.flatMap((group) =>
      Array.isArray(group.senses) ? group.senses.map((sense) => sense.sense_order) : []
    );
    const uniqueGrouped = new Set(groupedSenseOrders);
    if (uniqueGrouped.size !== groupedSenseOrders.length) errors.push('duplicate senses across pronunciation_groups');
  }

  const serialized = JSON.stringify(data);
  for (const reading of item.expectedReadings || []) {
    if (!serialized.includes(reading)) errors.push(`missing expected pronunciation reading ${reading}`);
  }
  for (const term of item.expectedTerms || []) {
    if (!serialized.includes(term)) errors.push(`missing expected term ${term}`);
  }

  const zhExampleText = Array.isArray(data?.examples)
    ? data.examples.map((example) => example?.localizations?.zh?.text || example?.translations?.zh || '').join('\n')
    : '';
  if (traditionalSmokeChars.test(zhExampleText))
    errors.push('zh examples contain likely Traditional Chinese characters');

  return {
    id: item.id,
    term: item.term,
    ok: errors.length === 0,
    elapsed_ms: Date.now() - started,
    status: response.status,
    provider: data?.provider,
    model: data?.model,
    title: data?.translation,
    detected_source_lang: data?.detected_source_lang,
    senses: senses.length,
    pronunciation_groups: groups.map((group) => ({
      group_order: group.group_order,
      reading: group.reading,
      reading_system: group.reading_system,
      sense_orders: Array.isArray(group.senses) ? group.senses.map((sense) => sense.sense_order) : []
    })),
    examples: Array.isArray(data?.examples) ? data.examples.length : 0,
    zh_example_preview: zhExampleText.slice(0, 300),
    errors
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
