const CACHE_NAME = "linguago-shell-v28";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];
const APP_SHELL_PATHS = new Set(APP_SHELL);
const INDEX_PATH = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate" || url.pathname === "/" || url.pathname === INDEX_PATH) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(cacheFirstAsset(url.pathname));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map((path) => cache.add(path)));
}

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(INDEX_PATH, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = (await caches.match(INDEX_PATH)) || (await caches.match("/"));
    return cached || offlineHtml();
  }
}

async function cacheFirstAsset(pathname) {
  const cached = await caches.match(pathname);
  const request = new Request(new URL(pathname, self.location.origin), {
    method: "GET",
    credentials: "same-origin"
  });
  const update = fetchAndCache(request).catch(() => cached);
  return cached || update || new Response("", { status: 503, statusText: "Offline" });
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = fetchAndCache(request).catch(() => cached);
  return cached || update || new Response("", { status: 503, statusText: "Offline" });
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

function offlineHtml() {
  return new Response("<!doctype html><html><head><meta charset=\"utf-8\"><title>LinguaGo</title></head><body>LinguaGo</body></html>", {
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
