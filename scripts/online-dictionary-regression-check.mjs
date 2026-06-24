import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const outDir = path.resolve("output/online-dictionary-regression");
const langs = ["zh", "en", "pt-BR", "ja"];

const cases = [
  {
    id: "zh-zhong-polyphone",
    text: "\u4e2d",
    source_lang: "zh",
    minSenses: 2,
    requirePronunciationGroups: true
  },
  {
    id: "zh-lingwai-overrides",
    text: "\u53e6\u5916",
    source_lang: "zh",
    expectedTermsByOrder: {
      1: { en: "another", zh: "\u53e6\u5916", ja: "\u5225\u306e" },
      2: { en: "additionally", zh: "\u53e6\u5916", ja: "\u3055\u3089\u306b" },
      3: { en: "furthermore", zh: "\u800c\u4e14", ja: "\u305d\u306e\u4e0a" }
    }
  },
  {
    id: "ja-itsu-sense-order",
    text: "\u4f55\u6642",
    source_lang: "ja",
    expectedTermsByOrder: {
      1: { en: "when", ja: "\u3044\u3064" },
      2: { en: "what time", ja: "\u4f55\u6642" },
      3: { en: "normal times", ja: "\u4f55\u6642" }
    }
  },
  {
    id: "ja-kokusai-overrides",
    text: "\u56fd\u969b",
    source_lang: "ja",
    expectedTermsByOrder: {
      1: { en: "international", zh: "\u56fd\u9645\u7684", ja: "\u56fd\u969b" },
      2: { en: "diplomatic relations", zh: "\u56fd\u9645\u4ea4\u5f80", ja: "\u56fd\u4ea4" }
    }
  },
  {
    id: "ja-visitor-overrides",
    text: "\u30d3\u30b8\u30bf\u30fc",
    source_lang: "ja",
    expectedTermsByOrder: {
      1: { en: "visitor", zh: "\u8bbf\u5ba2", ja: "\u30d3\u30b8\u30bf\u30fc" },
      2: { en: "visiting team", zh: "\u5ba2\u961f", ja: "\u30d3\u30b8\u30bf\u30fc\u30c1\u30fc\u30e0" }
    }
  },
  {
    id: "zh-bi-overrides",
    text: "\u9589",
    source_lang: "zh",
    expectedTermsByOrder: {
      1: { en: "close", ja: "\u9589\u3058\u308b" },
      2: { en: "obstruct; block up", ja: "\u585e\u3050" },
      3: { en: "shut; close", ja: "\u9589\u3058\u308b" }
    }
  },
  {
    id: "zh-secret-disambiguation",
    text: "\u79d8\u5bc6",
    source_lang: "zh",
    minSenses: 1,
    expectedDetectedSourceLang: "zh"
  },
  {
    id: "ja-secret-disambiguation",
    text: "\u79d8\u5bc6",
    source_lang: "ja",
    minSenses: 1,
    expectedDetectedSourceLang: "ja"
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

await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error(`Online dictionary regression failed:\n${failures.join("\n")}`);
  process.exit(1);
}

async function checkHealth() {
  const response = await fetch(new URL("/health", baseUrl), {
    signal: AbortSignal.timeout(30000)
  });
  const rawText = await response.text();
  const data = safeJson(rawText);
  const stats = data?.dictionary?.stats || {};
  const errors = [];

  if (!response.ok) errors.push(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  if (!data?.ok) errors.push("health ok is not true");
  if (stats.source !== "cloudflare-d1-v2") errors.push(`dictionary source is ${stats.source || "missing"}`);
  if (Number(stats.entries || 0) < 23000) errors.push(`entries ${stats.entries || 0} < 23000`);
  if (Number(stats.senses || 0) < 28000) errors.push(`senses ${stats.senses || 0} < 28000`);
  if (Number(stats.sense_localizations || 0) < 110000) {
    errors.push(`sense_localizations ${stats.sense_localizations || 0} < 110000`);
  }
  if (stats.policy !== "product_complete_4_lang_accepted_senses_only") {
    errors.push(`policy is ${stats.policy || "missing"}`);
  }

  return {
    ok: errors.length === 0,
    status: response.status,
    stats,
    errors
  };
}

async function checkTerm(item) {
  const started = Date.now();
  const response = await fetch(new URL("/api/translate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: item.text,
      source_lang: item.source_lang,
      target_lang: item.target_lang || "en",
      provider: "auto"
    }),
    signal: AbortSignal.timeout(60000)
  });

  const rawText = await response.text();
  const data = safeJson(rawText);
  const errors = [];

  if (!response.ok) errors.push(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  if (!data || typeof data !== "object") errors.push("response is not a JSON object");
  if (data?.provider !== "dictionary") errors.push(`provider is ${data?.provider || "missing"}, expected dictionary`);
  if (data?.model !== "cloudflare-d1-v2") errors.push(`model is ${data?.model || "missing"}, expected cloudflare-d1-v2`);
  if (data?.type !== "word") errors.push(`type is ${data?.type || "missing"}, expected word`);

  const detected = data?.detected_source_lang || data?.source_lang;
  if (item.expectedDetectedSourceLang && detected !== item.expectedDetectedSourceLang) {
    errors.push(`detected source lang is ${detected || "missing"}, expected ${item.expectedDetectedSourceLang}`);
  }

  const senses = Array.isArray(data?.senses) ? data.senses : [];
  const expectedMinSenses = item.minSenses || Object.keys(item.expectedTermsByOrder || {}).length || 1;
  if (senses.length < expectedMinSenses) {
    errors.push(`senses length ${senses.length}, expected >= ${expectedMinSenses}`);
  }

  validateSenseOrder(senses, errors);
  validateLocalizations(senses, errors);
  validateExpectedTerms(item.expectedTermsByOrder || {}, senses, errors);
  validatePronunciationGroups(item, data, errors);
  validateExamples(data, errors);

  return {
    id: item.id,
    text: item.text,
    ok: errors.length === 0,
    elapsed_ms: Date.now() - started,
    status: response.status,
    provider: data?.provider,
    model: data?.model,
    cached: data?.cached,
    cache_hit: data?.cache_hit,
    translation: data?.translation,
    detected_source_lang: detected,
    senses: senses.length,
    sense_orders: senses.map((sense) => sense.sense_order),
    first_terms: senses.slice(0, 4).map((sense) => ({
      order: sense.sense_order,
      en: sense.localizations?.en?.term,
      zh: sense.localizations?.zh?.term,
      "pt-BR": sense.localizations?.["pt-BR"]?.term,
      ja: sense.localizations?.ja?.term
    })),
    pronunciation_groups: Array.isArray(data?.pronunciation_groups)
      ? data.pronunciation_groups.map((group) => ({
          group_order: group.group_order,
          reading: group.reading,
          reading_system: group.reading_system,
          sense_orders: Array.isArray(group.senses) ? group.senses.map((sense) => sense.sense_order) : []
        }))
      : [],
    errors
  };
}

function validateSenseOrder(senses, errors) {
  for (const [index, sense] of senses.entries()) {
    const expectedOrder = index + 1;
    if (sense.sense_order !== expectedOrder) {
      errors.push(`sense at index ${index} has order ${sense.sense_order}, expected ${expectedOrder}`);
    }
  }
}

function validateLocalizations(senses, errors) {
  for (const sense of senses) {
    const order = sense.sense_order || "?";
    for (const lang of langs) {
      const localization = sense.localizations?.[lang];
      const definition = sense.definitions?.[lang] || localization?.definition;
      if (!localization?.term) errors.push(`sense ${order} missing ${lang} localization.term`);
      if (!definition) errors.push(`sense ${order} missing ${lang} definition`);
    }
  }
}

function validateExpectedTerms(expectedTermsByOrder, senses, errors) {
  const byOrder = new Map(senses.map((sense) => [sense.sense_order, sense]));
  for (const [orderText, expectedTerms] of Object.entries(expectedTermsByOrder)) {
    const sense = byOrder.get(Number(orderText));
    if (!sense) {
      errors.push(`missing expected sense order ${orderText}`);
      continue;
    }
    for (const [lang, expectedTerm] of Object.entries(expectedTerms)) {
      const actual = sense.localizations?.[lang]?.term;
      if (actual !== expectedTerm) {
        errors.push(`sense ${orderText} ${lang} term is ${actual || "missing"}, expected ${expectedTerm}`);
      }
    }
  }
}

function validatePronunciationGroups(item, data, errors) {
  const groups = Array.isArray(data?.pronunciation_groups) ? data.pronunciation_groups : [];
  if (item.requirePronunciationGroups && groups.length === 0) {
    errors.push("missing pronunciation_groups");
  }
  const groupedSenseOrders = groups.flatMap((group) =>
    Array.isArray(group.senses) ? group.senses.map((sense) => sense.sense_order) : []
  );
  if (new Set(groupedSenseOrders).size !== groupedSenseOrders.length) {
    errors.push("duplicate senses across pronunciation_groups");
  }
}

function validateExamples(data, errors) {
  const examples = Array.isArray(data?.examples) ? data.examples : [];
  for (const [index, example] of examples.entries()) {
    for (const lang of Object.keys(example.localizations || {})) {
      const text = example.localizations?.[lang]?.text;
      if (typeof text === "string" && /&[A-Za-z0-9#]+;/.test(text)) {
        errors.push(`example ${index + 1} ${lang} contains HTML entity`);
      }
    }
  }
}

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
