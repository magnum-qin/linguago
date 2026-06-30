import fs from "node:fs";
import path from "node:path";

const workerPath = path.resolve("worker/index.ts");
const source = fs.readFileSync(workerPath, "utf8");
const failures = [];

const safeLookupCalls = source.match(/safeLookupDictionaryFirst\(\{/g) || [];
if (safeLookupCalls.length < 2) {
  failures.push(`expected both translate paths to call safeLookupDictionaryFirst, found ${safeLookupCalls.length}`);
}

if (/const dictionaryResponse = await lookupDictionaryFirst\(\{/u.test(source)) {
  failures.push("direct lookupDictionaryFirst call remains in translate path");
}

const helperStart = source.indexOf("async function safeLookupDictionaryFirst");
const helperEnd = source.indexOf("async function handleTranslateStream");
const helper = helperStart >= 0 && helperEnd > helperStart ? source.slice(helperStart, helperEnd) : "";
if (!helper) {
  failures.push("safeLookupDictionaryFirst helper not found before handleTranslateStream");
} else {
  if (!/try\s*\{/u.test(helper)) failures.push("safeLookupDictionaryFirst must use try/catch");
  if (!/catch\s*\(error\)/u.test(helper)) failures.push("safeLookupDictionaryFirst must catch dictionary errors");
  if (!/return await lookupDictionaryFirst\(input\)/u.test(helper)) {
    failures.push("safeLookupDictionaryFirst must delegate to lookupDictionaryFirst");
  }
  if (!/dictionary_lookup_failed_falling_back/u.test(helper)) {
    failures.push("safeLookupDictionaryFirst must log a fallback warning");
  }
  if (!/return null/u.test(helper)) failures.push("safeLookupDictionaryFirst must return null on dictionary failure");
}

if (failures.length > 0) {
  console.error(`Worker dictionary fallback check failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  file: path.relative(process.cwd(), workerPath),
  safe_lookup_calls: safeLookupCalls.length
}, null, 2));
