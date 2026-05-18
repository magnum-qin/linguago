const CACHE_NAME = "linguago-shell-v11";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/apple-touch-icon.png"
];
const APP_SHELL_PATHS = new Set(APP_SHELL);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
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

  const isNavigation = event.request.mode === "navigate";
  const isShellAsset = APP_SHELL_PATHS.has(url.pathname);
  if (isNavigation || isShellAsset) {
    event.respondWith(cacheFirst(event.request, isNavigation ? "/index.html" : url.pathname));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

async function cacheFirst(request, fallbackPath) {
  const cached = await caches.match(request).then((match) => match || caches.match(fallbackPath));
  const update = refreshCache(request).catch(() => cached);
  return cached || update;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const update = refreshCache(request).catch(() => cached);
  return cached || update;
}

async function refreshCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}
