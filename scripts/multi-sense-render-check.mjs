import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright";

const root = resolve(".");
const publicDir = join(root, "public");
const port = 4186;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const mockTranslation = {
  original: "set",
  type: "word",
  translation: "设置",
  detected_source_lang: "en",
  provider: "dictionary",
  model: "louis-sqlite",
  cached: true,
  translations: {
    zh: { text: "设置", phonetic: "she zhi", audio_text: "设置" },
    en: { text: "set", phonetic: "/set/", audio_text: "set" },
    "pt-BR": { text: "definir", phonetic: "de-fi-nir", audio_text: "definir" },
    ja: { text: "設定する", phonetic: "せっていする", audio_text: "設定する" }
  },
  word_details: {
    zh: { word: "设置", definition: "放置、设定或一组固定内容。" },
    en: { word: "set", definition: "To put, configure, or a collection." },
    "pt-BR": { word: "definir", definition: "Colocar, configurar ou um conjunto." },
    ja: { word: "設定する", definition: "置く、設定する、または集合。" }
  },
  senses: [
    {
      sense_order: 1,
      part_of_speech: "verb",
      gloss_key: "put in place",
      definitions: {
        zh: "把某物放在指定位置。",
        en: "To put something in a particular place.",
        "pt-BR": "Colocar algo em um lugar especifico.",
        ja: "何かを特定の場所に置く。"
      }
    },
    {
      sense_order: 2,
      part_of_speech: "verb",
      gloss_key: "configure",
      definitions: {
        zh: "调整或配置一个值、时间或选项。",
        en: "To configure a value, time, or option.",
        "pt-BR": "Configurar um valor, horario ou opcao.",
        ja: "値、時刻、または選択肢を設定する。"
      }
    },
    {
      sense_order: 3,
      part_of_speech: "noun",
      gloss_key: "collection",
      definitions: {
        zh: "一组相关的物品或成员。",
        en: "A group of related things or members.",
        "pt-BR": "Um grupo de coisas ou membros relacionados.",
        ja: "関連する物や要素の集まり。"
      }
    }
  ],
  examples: [
    {
      sentence: "Set the cup on the table.",
      translations: {
        zh: "把杯子放在桌上。",
        en: "Set the cup on the table.",
        "pt-BR": "Coloque o copo na mesa.",
        ja: "カップをテーブルに置いて。"
      }
    }
  ]
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);

  if (url.pathname === "/api/settings") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ provider: "auto", model: "mock-model" }));
    return;
  }

  if (url.pathname === "/api/dictionary/stats") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ accepted_words: 34956 }));
    return;
  }

  if (url.pathname === "/api/translate") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(mockTranslation));
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(publicDir, pathname);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
});

await new Promise((resolveServer) => server.listen(port, "127.0.0.1", resolveServer));

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
  await page.fill("#textInput", "set");
  await page.click("#translateButton");
  await page.waitForSelector("#wordDetailsList .sense-card");
  await page.click(".result-tab[data-lang='zh']");

  const result = await page.evaluate(() => ({
    cards: document.querySelectorAll("#wordDetailsList .sense-card").length,
    indexes: Array.from(document.querySelectorAll("#wordDetailsList .sense-index")).map((node) =>
      node.textContent?.trim()
    ),
    text: document.querySelector("#wordDetailsList")?.textContent || "",
    rects: Array.from(document.querySelectorAll("#wordDetailsList .sense-card")).map((node) => {
      const rect = node.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height) };
    })
  }));

  if (result.cards !== 3) throw new Error(`Expected 3 sense cards, saw ${result.cards}`);
  if (!result.text.includes("把某物放在指定位置") || !result.text.includes("调整或配置")) {
    throw new Error("Selected-language sense definitions were not rendered.");
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  server.close();
}
