import fs from "node:fs";

const sw = fs.readFileSync("public/sw.js", "utf8");
const index = fs.readFileSync("public/index.html", "utf8");
const requiredAssets = [
  "/app.js",
  "/styles.css",
  "/js/api.js",
  "/js/text-utils.js",
  "/js/pronunciation.js"
];

const errors = [];
if (!/CACHE_NAME\s*=\s*"linguago-shell-v\d+"/.test(sw)) {
  errors.push("CACHE_NAME must use linguago-shell-v<number>.");
}
for (const asset of requiredAssets) {
  if (!sw.includes(`"${asset}"`)) {
    errors.push(`APP_SHELL is missing ${asset}.`);
  }
}
if (!sw.includes('url.pathname.startsWith("/api/")')) {
  errors.push("/api/* network bypass is missing.");
}
if (!index.includes('type="module" src="/app.js?')) {
  errors.push("index.html should load versioned /app.js as a module.");
}

console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
if (errors.length) process.exitCode = 1;
