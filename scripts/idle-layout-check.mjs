import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const publicDir = path.resolve("public");
const outDir = path.resolve("output", "playwright");
await fs.mkdir(outDir, { recursive: true });

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  const filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir)) return response.writeHead(403).end();
  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "content-type": ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "text/html"
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 760 } });

await page.route("**/api/settings", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
);
await page.route("**/api/dictionary/stats", (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: "{\"accepted_words\":3158}" })
);

await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
await page.screenshot({ path: path.join(outDir, "idle-layout-desktop.png"), fullPage: true });

const report = await page.evaluate(() => {
  const head = document.querySelector(".result-head")?.innerText.trim();
  const idleMessage = getComputedStyle(document.querySelector("#resultCard"), "::after").content;
  const card = document.querySelector("#translationCard")?.getBoundingClientRect();
  return {
    head,
    idleMessage,
    translationCard: card ? { top: Math.round(card.top), bottom: Math.round(card.bottom) } : null
  };
});
console.log(JSON.stringify(report, null, 2));

await browser.close();
server.close();
