import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { serviceWorkerSource } from './pwa-worker.mjs';

function harness() {
  const listeners = {};
  const cache = {
    addAll: vi.fn().mockResolvedValue(undefined),
    match: vi.fn(),
    put: vi.fn().mockResolvedValue(undefined),
  };
  const caches = {
    open: vi.fn().mockResolvedValue(cache),
    keys: vi
      .fn()
      .mockResolvedValue([
        'pitchpresence-static-old',
        'unrelated-app-cache',
        'pitchpresence-static-new',
      ]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const fetch = vi.fn();
  const skipWaiting = vi.fn();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const clients = {
    matchAll: vi.fn().mockResolvedValue([]),
    openWindow: vi.fn().mockResolvedValue(undefined),
  };
  runInNewContext(
    serviceWorkerSource({ version: 'new', staticAssets: ['/_next/static/build/app.js'] }),
    {
      self: {
        location: { origin: 'https://pitch.test' },
        addEventListener: (name, handler) => {
          listeners[name] = handler;
        },
        skipWaiting,
        registration: { showNotification },
        clients,
      },
      caches,
      fetch,
      URL,
      Response,
      Set,
      Promise,
    },
  );
  function request(path, options = {}) {
    const respondWith = vi.fn();
    listeners.fetch({
      request: {
        url: 'https://pitch.test' + path,
        method: 'GET',
        mode: 'cors',
        headers: new Headers(),
        ...options,
      },
      respondWith,
    });
    return respondWith;
  }
  return { listeners, cache, caches, fetch, skipWaiting, request, showNotification, clients };
}

it('never intercepts API writes, API reads, route data, or unapproved assets', () => {
  const h = harness();
  for (const path of [
    '/api/v1/auth/me',
    '/api',
    '/media/hero.mp4',
    '/fonts/unapproved.woff2',
    '/management?_rsc=x',
  ])
    expect(h.request(path)).not.toHaveBeenCalled();
  expect(h.request('/api/v1/attendance/check-in', { method: 'POST' })).not.toHaveBeenCalled();
  expect(h.request('/management', { headers: new Headers({ RSC: '1' }) })).not.toHaveBeenCalled();
  expect(
    h.request('/management', { headers: new Headers({ 'Next-Router-Prefetch': '1' }) }),
  ).not.toHaveBeenCalled();
});

it('falls back on failed navigations without caching documents or query tokens', async () => {
  const h = harness();
  const offline = new Response('Reconnect');
  h.cache.match.mockResolvedValue(offline);
  h.fetch.mockRejectedValue(new TypeError('network unavailable'));
  const response = h.request('/register?invite=private', { mode: 'navigate' });
  expect(await response.mock.calls[0][0]).toBe(offline);
  expect(h.cache.match).toHaveBeenCalledWith('/offline.html');
  expect(h.cache.put).not.toHaveBeenCalled();
});

it('preserves server errors rather than replacing them with the offline screen', async () => {
  const h = harness();
  const failure = new Response('Unavailable', { status: 503 });
  h.fetch.mockResolvedValue(failure);
  const response = h.request('/management', { mode: 'navigate' });
  expect(await response.mock.calls[0][0]).toBe(failure);
  expect(h.cache.match).not.toHaveBeenCalled();
  expect(h.cache.put).not.toHaveBeenCalled();
});

it('caches only approved successful nonredirected static responses', async () => {
  const h = harness();
  h.cache.match.mockResolvedValue(undefined);
  const staticResponse = { ok: true, type: 'basic', redirected: false, clone: () => 'copy' };
  h.fetch.mockResolvedValue(staticResponse);
  const result = h.request('/_next/static/build/app.js');
  expect(await result.mock.calls[0][0]).toBe(staticResponse);
  expect(h.cache.put).toHaveBeenCalledWith('/_next/static/build/app.js', 'copy');
  expect(h.request('/_next/static/build/app.js?token=private')).not.toHaveBeenCalled();
});

it('installs only essential public assets and waits for open windows to close', async () => {
  const h = harness();
  const waitUntil = vi.fn();
  h.listeners.install({ waitUntil });
  await waitUntil.mock.calls[0][0];
  expect(h.cache.addAll.mock.calls[0][0]).toContain('/offline.html');
  expect(h.cache.addAll.mock.calls[0][0].some((path) => /api|media|fonts/.test(path))).toBe(false);
  expect(h.skipWaiting).not.toHaveBeenCalled();
  h.listeners.activate({ waitUntil });
  await waitUntil.mock.calls[1][0];
  expect(h.caches.delete).toHaveBeenCalledExactlyOnceWith('pitchpresence-static-old');
});

it('push messages show generic lock-screen text and cannot supply an external navigation target', async () => {
  const h = harness();
  const waitUntil = vi.fn();
  h.listeners.push({
    data: {
      json: () => ({
        receiptId: '10000000-0000-4000-8000-000000000001',
        url: 'https://evil.test/steal',
        body: 'Player name and payment details',
      }),
    },
    waitUntil,
  });
  await waitUntil.mock.calls[0][0];
  const [title, options] = h.showNotification.mock.calls[0];
  expect(title).toBe('New dues receipt');
  expect(options.body).not.toContain('Player name');
  expect(options.data.url).toBe('https://pitch.test/management/dues');
  expect(options.tag).toBe('receipt-10000000-0000-4000-8000-000000000001');
  expect(h.cache.put).not.toHaveBeenCalled();
});

it('receipt notification taps open the correct month and focus an existing app window', async () => {
  const h = harness();
  const waitUntil = vi.fn();
  const focus = vi.fn().mockResolvedValue(undefined);
  const navigate = vi.fn().mockResolvedValue({ focus });
  h.clients.matchAll.mockResolvedValue([{ url: 'https://pitch.test/account', navigate }]);
  const close = vi.fn();
  h.listeners.notificationclick({
    notification: { close, data: { url: '/management/dues?month=2026-10' } },
    waitUntil,
  });
  await waitUntil.mock.calls[0][0];
  expect(close).toHaveBeenCalled();
  expect(navigate).toHaveBeenCalledWith('https://pitch.test/management/dues?month=2026-10');
  expect(focus).toHaveBeenCalled();
  expect(h.clients.openWindow).not.toHaveBeenCalled();
});

it('malformed pushes still display a notification and clicks without an open app stay on the trusted route', async () => {
  const h = harness();
  const waitUntil = vi.fn();
  h.listeners.push({
    data: {
      json: () => {
        throw new Error('bad payload');
      },
    },
    waitUntil,
  });
  await waitUntil.mock.calls[0][0];
  expect(h.showNotification).toHaveBeenCalled();
  h.listeners.notificationclick({
    notification: { close: vi.fn(), data: { url: '/api/v1/receipts/secret/file' } },
    waitUntil,
  });
  await waitUntil.mock.calls[1][0];
  expect(h.clients.openWindow).toHaveBeenCalledWith('https://pitch.test/management/dues');
});
