import fs from "node:fs";
import path from "node:path";

const fixturePath = path.resolve("test-fixtures/dictionary-hit-results.json");
const LANGS = ["en", "pt-BR", "zh", "ja"];
const traditionalSmokeChars = /[\u9019\u500b\u5011\u4f86\u8aaa\u6642\u9084\u5f8c\u767c\u807d\u8207\u5c0d\u6703\u8868\u5b78\u958b\u95dc\u9ad4]/u;

const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const failures = [];

if (!Array.isArray(fixture.fixtures) || fixture.fixtures.length === 0) {
  failures.push("fixtures must be a non-empty array");
}

for (const item of fixture.fixtures || []) {
  validateDictionaryHit(item.id || "unnamed", item.response);
}

if (failures.length > 0) {
  console.error(`Dictionary hit fixture check failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  fixture: path.relative(process.cwd(), fixturePath),
  fixtures: fixture.fixtures.length
}, null, 2));

function validateDictionaryHit(id, response) {
  if (!response || typeof response !== "object") {
    failures.push(`${id}: response must be an object`);
    return;
  }

  expect(id, response.type === "word", "type must be word");
  expect(id, response.provider === "dictionary", "provider must be dictionary");
  expect(id, response.model === "cloudflare-d1-v2", "model must be cloudflare-d1-v2");

  for (const lang of LANGS) {
    const translation = response.translations?.[lang];
    expect(id, translation?.text, `translations.${lang}.text is required`);
    expect(id, response.word_details?.[lang]?.word, `word_details.${lang}.word is required`);
    expect(id, response.word_details?.[lang]?.definition, `word_details.${lang}.definition is required`);
  }

  const senses = collectRenderableSenses(response);
  expect(id, senses.length > 0, "at least one renderable sense is required");

  const orders = senses.map((sense) => sense.sense_order);
  const uniqueOrders = new Set(orders);
  expect(id, uniqueOrders.size === orders.length, "sense_order must be unique in renderable senses");

  for (const sense of senses) {
    const label = `sense ${sense.sense_order}`;
    for (const lang of LANGS) {
      const localization = sense.localizations?.[lang];
      expect(id, localization?.term, `${label} missing ${lang} term`);
      expect(id, localization?.definition || sense.definitions?.[lang], `${label} missing ${lang} definition`);
      if (lang === "zh") expect(id, localization?.reading, `${label} missing zh reading`);
      if (lang === "ja") expect(id, localization?.reading, `${label} missing ja reading`);
      if (lang === "en" || lang === "pt-BR") {
        expect(id, localization?.pronunciation, `${label} missing ${lang} pronunciation`);
      }
    }

    for (const example of sense.examples || []) {
      for (const lang of LANGS) {
        expect(id, example.localizations?.[lang]?.text || example.translations?.[lang], `${label} example missing ${lang}`);
      }
      const zhText = example.localizations?.zh?.text || example.translations?.zh || "";
      expect(id, !traditionalSmokeChars.test(zhText), `${label} example contains likely Traditional Chinese`);
    }
  }

  const groups = Array.isArray(response.pronunciation_groups) ? response.pronunciation_groups : [];
  for (const group of groups) {
    expect(id, group.reading, `pronunciation group ${group.group_order || ""} missing reading`);
    expect(id, group.reading_system, `pronunciation group ${group.group_order || ""} missing reading_system`);
    expect(id, Array.isArray(group.senses) && group.senses.length > 0, `pronunciation group ${group.reading || ""} has no senses`);
  }
}

function collectRenderableSenses(response) {
  const grouped = Array.isArray(response.pronunciation_groups)
    ? response.pronunciation_groups.flatMap((group) => Array.isArray(group.senses) ? group.senses : [])
    : [];
  return grouped.length > 0 ? grouped : (Array.isArray(response.senses) ? response.senses : []);
}

function expect(id, condition, message) {
  if (!condition) failures.push(`${id}: ${message}`);
}
