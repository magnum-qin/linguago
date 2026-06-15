import fs from "node:fs";

const sw = fs.readFileSync("public/sw.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const requiredAssets = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

const errors = [];
if (!/CACHE_NAME\s*=\s*"linguago-shell-v\d+(?:-[a-z0-9-]+)?"/.test(sw)) {
  errors.push("CACHE_NAME must use linguago-shell-v<number> with an optional suffix.");
}
for (const asset of requiredAssets) {
  if (!sw.includes(`"${asset}"`)) {
    errors.push(`APP_SHELL is missing ${asset}.`);
  }
}
if (!sw.includes('url.pathname.startsWith("/api/")')) {
  errors.push("/api/* network bypass is missing.");
}
if (!index.includes('type="module" src="/src/main.ts"')) {
  errors.push("index.html should load the Vite Vue entry /src/main.ts as a module.");
}
if (!sw.includes('url.pathname.startsWith("/assets/")')) {
  errors.push("Vite hashed /assets/* cache handling is missing.");
}

console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
if (errors.length) process.exitCode = 1;
