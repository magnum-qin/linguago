import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const outDir = path.resolve("output/online-dictionary-focused-check");
const langs = ["zh", "en", "pt-BR", "ja"];
const traditionalSmokeChars = /[這個們夾碼東學開車會裡為與於體見說語點對時過還後發應嗎認識]/u;
const cases = [
  { term: "中", minSenses: 2, requirePronunciationGroups: true, expectedReadings: ["zhōng", "zhòng"] },
  { term: "inside", minSenses: 1, requirePronunciationGroups: true },
  { term: "breaks", minSenses: 1 },
  { term: "although", minSenses: 1 },
  { term: "cor", minSenses: 1 }
];

await fs.mkdir(outDir, { recursive: true });

const report = {
  baseUrl,
  generated_at: new Date().toISOString(),
  cases: []
};

for (const item of cases) {
  report.cases.push(await checkTerm(item));
}

const failures = report.cases.flatMap((item) => item.errors.map((error) => `${item.term}: ${error}`));
await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  console.error(`Focused dictionary check failed:\n${failures.join("\n")}`);
  process.exit(1);
}

async function checkTerm(item) {
  const started = Date.now();
  const response = await fetch(new URL("/api/translate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: item.term,
      source_lang: "auto",
      target_lang: "en",
      provider: "auto"
    }),
    signal: AbortSignal.timeout(60000)
  });

  const rawText = await response.text();
  const data = safeJson(rawText);
  const errors = [];

  if (!response.ok) {
    errors.push(`HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  }
  if (!data || typeof data !== "object") {
    errors.push("response is not a JSON object");
  }
  if (data?.provider !== "dictionary") errors.push(`provider is ${data?.provider || "missing"}, expected dictionary`);
  if (data?.model !== "cloudflare-d1-v2") errors.push(`model is ${data?.model || "missing"}, expected cloudflare-d1-v2`);
  if (data?.type !== "word") errors.push(`type is ${data?.type || "missing"}, expected word`);

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
  if (item.requirePronunciationGroups && groups.length === 0) {
    errors.push("missing pronunciation_groups");
  }
  if (groups.length > 0) {
    const groupedSenseOrders = groups.flatMap((group) =>
      Array.isArray(group.senses) ? group.senses.map((sense) => sense.sense_order) : []
    );
    const uniqueGrouped = new Set(groupedSenseOrders);
    if (uniqueGrouped.size !== groupedSenseOrders.length) {
      errors.push("duplicate senses across pronunciation_groups");
    }
  }
  if (item.expectedReadings) {
    const text = JSON.stringify(groups);
    for (const reading of item.expectedReadings) {
      if (!text.includes(reading)) errors.push(`missing expected pronunciation reading ${reading}`);
    }
  }
  const zhExampleText = Array.isArray(data?.examples)
    ? data.examples.map((example) => example?.localizations?.zh?.text || example?.translations?.zh || "").join("\n")
    : "";
  if (traditionalSmokeChars.test(zhExampleText)) {
    errors.push("zh examples contain likely Traditional Chinese characters");
  }

  return {
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
