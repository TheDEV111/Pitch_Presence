export function serviceWorkerSource({ version, staticAssets }) {
  return `(${worker.toString()})(${JSON.stringify(version)}, ${JSON.stringify(staticAssets)});\n`;
}

function worker(version, staticAssets) {
  const cacheName = `pitchpresence-static-${version}`;
  const essentials = [
    '/offline.html',
    '/pwa/offline.css',
    '/pwa/offline.js',
    '/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/maskable-512.png',
    '/icons/apple-touch-icon.png',
  ];
  const approved = new Set([...essentials, ...staticAssets]);
  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(essentials)));
    // Do not skipWaiting: active forms and training sessions keep their worker version.
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith('pitchpresence-static-') && name !== cacheName)
              .map((name) => caches.delete(name)),
          ),
        ),
    );
  });
  self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    if (
      request.method !== 'GET' ||
      url.origin !== self.location.origin ||
      url.pathname === '/api' ||
      url.pathname.startsWith('/api/') ||
      request.headers.get('RSC') === '1' ||
      request.headers.has('Next-Router-Prefetch')
    )
      return;
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).catch(async () => {
          const fallback = await (await caches.open(cacheName)).match('/offline.html');
          return fallback ?? Response.error();
        }),
      );
      return;
    }
    if (url.search || !approved.has(url.pathname)) return;
    event.respondWith(
      (async () => {
        const cache = await caches.open(cacheName);
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === 'basic' && !response.redirected) {
          await cache.put(url.pathname, response.clone()).catch(() => {});
        }
        return response;
      })(),
    );
  });
}
