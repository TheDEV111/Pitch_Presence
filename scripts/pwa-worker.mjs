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
  self.addEventListener('message', (event) => {
    if (event.data?.type === 'RECEIPT_PUSH_CAPABILITIES')
      event.ports?.[0]?.postMessage({ receipts: true });
  });
  const receiptUrl = (value) => {
    try {
      const url = new URL(value, self.location.origin);
      return url.origin === self.location.origin &&
        url.pathname === '/management/dues' &&
        !url.hash &&
        (!url.search || /^\?month=\d{4}-(0[1-9]|1[0-2])$/.test(url.search))
        ? url.href
        : self.location.origin + '/management/dues';
    } catch {
      return self.location.origin + '/management/dues';
    }
  };
  self.addEventListener('push', (event) => {
    let payload = {};
    try {
      payload = event.data?.json() ?? {};
    } catch {
      /* Generic notification remains visible. */
    }
    event.waitUntil(
      self.registration.showNotification('New dues receipt', {
        body: 'A payment receipt is waiting for staff review. Open PitchPresence to check it.',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: /^[a-f0-9-]{36}$/i.test(payload.receiptId ?? '')
          ? `receipt-${payload.receiptId}`
          : 'receipt-review',
        data: { url: receiptUrl(payload.url) },
      }),
    );
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = receiptUrl(event.notification.data?.url);
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) {
          const navigated = await existing.navigate(target);
          if (navigated) return navigated.focus();
        }
        return self.clients.openWindow(target);
      })(),
    );
  });
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
