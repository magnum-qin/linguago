import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const url = process.env.PWA_URL || "https://translation-pwa.qhzggzh-linguago.workers.dev";
const outDir = path.resolve("output/playwright/online-dictionary-focused");
const traditionalSmokeChars = /[這個們夾碼東學開車會裡為與於體見說語點對時過還後發應嗎認識]/u;
const terms = [
  { term: "中", expectedText: ["zhōng", "zhòng", "medium", "hit"] },
  { term: "inside", expectedText: ["inside", "/ˈɪn.saɪd/"] },
  { term: "although", expectedText: ["although", "/ɔːlˈðoʊ/"] }
];

await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});

const report = {
  url,
  generated_at: new Date().toISOString(),
  terms: []
};

try {
  for (const [index, item] of terms.entries()) {
    report.terms.push(await checkRenderedTerm(page, item, index + 1));
  }
} finally {
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
const failures = report.terms.flatMap((item) => item.errors.map((error) => `${item.term}: ${error}`));
if (failures.length > 0) {
  console.error(`Focused render check failed:\n${failures.join("\n")}`);
  process.exit(1);
}

async function checkRenderedTerm(page, item, ordinal) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.locator("textarea").first().fill(item.term);
  await page.locator("button").filter({ hasText: /Traduzir/i }).last().click();
  await page.waitForFunction(
    () => {
      const text = document.body.innerText.toLowerCase();
      return text.includes("dictionary") || text.includes("dicion") || text.includes("ai") || text.includes("error:");
    },
    undefined,
    { timeout: 45000 }
  );
  await page.waitForTimeout(800);

  const tabTexts = await collectTabTexts(page);
  const screenshot = `${String(ordinal).padStart(2, "0")}-${safeName(item.term)}.png`;
  await page.screenshot({ path: path.join(outDir, screenshot), fullPage: true });

  const state = await page.evaluate(() => {
    const text = document.body.innerText;
    return {
      title: document.querySelector("h1")?.textContent?.trim() || "",
      visibleTextPreview: text.slice(0, 1800),
      hasDictionary: /dictionary|dicion/i.test(text),
      hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth
      }
    };
  });

  const errors = [];
  if (!state.hasDictionary) errors.push("page did not render a dictionary result");
  if (state.hasHorizontalOverflow) errors.push("page has horizontal overflow");
  const combinedText = [state.visibleTextPreview, ...tabTexts.map((tab) => tab.visibleText)].join("\n");
  for (const expected of item.expectedText) {
    if (!combinedText.includes(expected)) errors.push(`missing visible text ${expected}`);
  }
  const chineseTabText = tabTexts.find((tab) => tab.label === "中")?.visibleText || "";
  if (traditionalSmokeChars.test(chineseTabText)) {
    errors.push("Chinese tab contains likely Traditional Chinese characters");
  }

  return {
    term: item.term,
    ok: errors.length === 0,
    screenshot,
    tabTexts: tabTexts.map((tab) => ({ label: tab.label, preview: tab.visibleText.slice(0, 700) })),
    ...state,
    errors
  };
}

async function collectTabTexts(page) {
  const tabs = page.locator('[role="tab"], .v-tab');
  const count = await tabs.count();
  const states = [];
  for (let i = 0; i < count; i++) {
    const tab = tabs.nth(i);
    const label = (await tab.textContent().catch(() => ""))?.trim() || `tab-${i}`;
    await tab.click().catch(() => {});
    await page.waitForTimeout(300);
    const visibleText = await page.evaluate(() => document.body.innerText);
    states.push({ label, visibleText });
  }
  return states;
}

function safeName(value) {
  return value
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "term";
}
