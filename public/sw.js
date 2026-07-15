const CACHE_NAME = "linguago-shell-v42-vue";
const APP_SHELL = [
  "/",
  "/index.html",
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
    event.respondWith(staleWhileRevalidateNavigation(event.request));
    return;
  }

  // Vite assets (hashed) can be cached safely forever
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirstAsset(event.request, url.pathname));
    return;
  }

  if (APP_SHELL_PATHS.has(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(APP_SHELL.map((path) => cache.add(path)));
}

async function staleWhileRevalidateNavigation(request) {
  const cached = await caches.match(INDEX_PATH) || await caches.match("/");
  const update = fetch(request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(INDEX_PATH, response.clone()).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  
  return cached || update;
}

async function cacheFirstAsset(request, pathname) {
  const cached = await caches.match(request);
  if (cached) return cached;
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    return new Response("", { status: 503, statusText: "Offline" });
  }
}

async function networkFirstAsset(request, pathname) {
  try {
    return await fetchAndCache(request);
  } catch {
    const cached = await caches.match(request) || await caches.match(pathname);
    return cached || new Response("", { status: 503, statusText: "Offline" });
  }
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
