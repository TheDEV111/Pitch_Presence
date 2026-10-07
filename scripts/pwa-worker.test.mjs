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
  runInNewContext(
    serviceWorkerSource({ version: 'new', staticAssets: ['/_next/static/build/app.js'] }),
    {
      self: {
        location: { origin: 'https://pitch.test' },
        addEventListener: (name, handler) => {
          listeners[name] = handler;
        },
        skipWaiting,
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
  return { listeners, cache, caches, fetch, skipWaiting, request };
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
