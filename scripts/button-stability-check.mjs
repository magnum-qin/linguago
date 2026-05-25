import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const outDir = path.join(root, "output", "playwright");
await fs.mkdir(outDir, { recursive: true });

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html" :
      ext === ".js" ? "text/javascript" :
      ext === ".css" ? "text/css" :
      ext === ".svg" ? "image/svg+xml" :
      "application/octet-stream";
    response.writeHead(200, { "content-type": type });
    response.end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });

async function inspect(viewport, name) {
  const page = await browser.newPage({ viewport });
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ provider: "auto", model: "qwen3.6-flash" })
    })
  );
  await page.route("**/api/dictionary/stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accepted_words: 1186 })
    })
  );
  await page.route("**/api/translate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        type: "word",
        detected_source_lang: "en",
        target_lang: "zh",
        original: "you",
        translation: "你",
        provider: "dictionary",
        model: "louis-sqlite",
        cached: true,
        translations: {
          en: { text: "you", phonetic: "ju", audio_text: "you" },
          "pt-BR": { text: "você", phonetic: "vo-se", audio_text: "você" },
          zh: { text: "你", phonetic: "ni", audio_text: "你" },
          ja: { text: "あなた", phonetic: "anata", audio_text: "あなた" }
        },
        word_details: {
          zh: { word: "你", definition: "第二人称代词。" }
        },
        examples: [
          {
            sentence: "Are you ready?",
            translations: {
              en: "Are you ready?",
              "pt-BR": "Você está pronto?",
              zh: "你准备好了吗？",
              ja: "準備できましたか？"
            }
          }
        ]
      })
    });
  });

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("#translateButton .button-lang-secondary");

  async function measure(label) {
    return page.evaluate((state) => {
      const selectors = {
        theme: "#themeToggleButton",
        settings: "#settingsButton",
        clear: "#clearButton",
        translate: "#translateButton",
        historyClear: "#clearHistoryButton",
        save: "#saveModelButton",
        verify: "#verifyModelButton",
        providerBadge: "#providerBadge",
        tabs: "#resultLanguageTabs",
        tab: ".result-tab"
      };

      const box = (selector) => {
        const node = document.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          radius: style.borderRadius,
          text: node.textContent.trim().replace(/\s+/g, " ")
        };
      };

      return Object.fromEntries(
        Object.entries(selectors).map(([key, selector]) => [key, box(selector)])
      ) || { state };
    }, label);
  }

  const idle = await measure("idle");
  await page.locator("#settingsButton").click();
  await page.waitForSelector("#saveModelButton .button-lang-secondary");
  const settingsOpen = await measure("settingsOpen");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  await page.locator("#textInput").fill("you");
  await page.locator("#translateButton").click();
  await page.waitForSelector("#translateButton.loading");
  const loading = await measure("loading");
  await page.waitForSelector("#translateButton:not(.loading)");
  await page.waitForTimeout(150);
  const result = await measure("result");
  await page.screenshot({ path: path.join(outDir, `button-stability-${name}.png`), fullPage: true });
  await page.close();

  const delta = {};
  for (const key of ["clear", "translate", "historyClear", "save", "verify", "providerBadge"]) {
    delta[key] = {
      idleToLoadingH: (loading[key]?.height || 0) - (idle[key]?.height || 0),
      idleToLoadingW: (loading[key]?.width || 0) - (idle[key]?.width || 0),
      loadingToResultH: (result[key]?.height || 0) - (loading[key]?.height || 0),
      loadingToResultW: (result[key]?.width || 0) - (loading[key]?.width || 0)
    };
  }

  return { viewport, idle, settingsOpen, loading, result, delta };
}

const report = {
  mobile: await inspect({ width: 390, height: 844 }, "mobile"),
  desktop: await inspect({ width: 1440, height: 900 }, "desktop")
};

await browser.close();
server.close();

await fs.writeFile(
  path.join(outDir, "button-stability-report.json"),
  `${JSON.stringify(report, null, 2)}\n`
);
console.log(JSON.stringify(report, null, 2));
