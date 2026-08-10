export type PwaUpdateResult = 'current' | 'updating';

const UPDATE_QUERY = '__pwa_update';
const APP_CACHE_PREFIX = 'linguago-shell-';

const getModuleEntry = (root: ParentNode, baseUrl: string) => {
  const script = root.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script?.src ? new URL(script.src, baseUrl).pathname : '';
};

export async function checkForPwaUpdate(): Promise<PwaUpdateResult> {
  const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
  await registration?.update();

  const updateUrl = new URL('/', window.location.origin);
  updateUrl.searchParams.set(UPDATE_QUERY, Date.now().toString());
  const response = await fetch(updateUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Update check failed with HTTP ${response.status}`);
  }

  const latestHtml = await response.text();
  const latestDocument = new DOMParser().parseFromString(latestHtml, 'text/html');
  const currentEntry = getModuleEntry(document, window.location.href);
  const latestEntry = getModuleEntry(latestDocument, response.url || updateUrl.href);

  if (!latestEntry || latestEntry === currentEntry) {
    return 'current';
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.filter((name) => name.startsWith(APP_CACHE_PREFIX)).map((name) => caches.delete(name))
    );
  }

  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  window.location.replace(updateUrl.href);
  return 'updating';
}
