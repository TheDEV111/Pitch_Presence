import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';

const env = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'logging-session-secret-0000000000000000',
  QR_SIGNING_SECRET: 'logging-qr-secret-00000000000000000000',
  RESEND_API_KEY: 're_test_placeholder',
  LOG_LEVEL: 'silent',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const apps: Awaited<ReturnType<typeof buildApp>>['app'][] = [];

async function liveRequest(
  trustProxy: string,
  headers: Record<string, string>,
  remoteAddress: string,
) {
  const { app } = await buildApp(loadConfig({ ...env, TRUST_PROXY: trustProxy }));
  apps.push(app);
  const info = vi.spyOn(app.log, 'info');
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/health/live',
    headers,
    remoteAddress,
  });
  const line = info.mock.calls.find(([, message]) => message === 'request completed')?.[0] as
    | Record<string, unknown>
    | undefined;
  return { response, line };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

it('logs the forwarded client IP when the peer is a trusted proxy', async () => {
  const { line } = await liveRequest(
    '172.21.0.0/16',
    { 'x-forwarded-for': '203.0.113.7' },
    '172.21.0.2',
  );
  expect(line).toMatchObject({ ip: '203.0.113.7', status: 200 });
});

it('ignores X-Forwarded-For from an untrusted peer', async () => {
  const { line } = await liveRequest(
    '172.21.0.0/16',
    { 'x-forwarded-for': '203.0.113.7' },
    '198.51.100.9',
  );
  expect(line).toMatchObject({ ip: '198.51.100.9' });
});

it('ignores X-Forwarded-For when TRUST_PROXY is unset', async () => {
  const { line } = await liveRequest('', { 'x-forwarded-for': '203.0.113.7' }, '172.21.0.2');
  expect(line).toMatchObject({ ip: '172.21.0.2' });
});

it('generates a UUID request id, logs it and returns it in X-Request-Id', async () => {
  const { response, line } = await liveRequest('', {}, '127.0.0.1');
  expect(response.headers['x-request-id']).toMatch(uuid);
  expect(line?.requestId).toBe(response.headers['x-request-id']);
});

it('keeps a well-formed upstream X-Request-Id', async () => {
  const { response, line } = await liveRequest(
    '',
    { 'x-request-id': 'traefik-abc.123' },
    '127.0.0.1',
  );
  expect(response.headers['x-request-id']).toBe('traefik-abc.123');
  expect(line?.requestId).toBe('traefik-abc.123');
});

it('replaces an unsafe or oversized upstream request id', async () => {
  for (const bad of ['bad id\nINJECTED', 'x'.repeat(129), '<script>']) {
    const { response } = await liveRequest('', { 'x-request-id': bad }, '127.0.0.1');
    expect(response.headers['x-request-id']).toMatch(uuid);
  }
});

it('no longer honours the Fastify default request-id header', async () => {
  const { response } = await liveRequest('', { 'request-id': 'client-chosen' }, '127.0.0.1');
  expect(response.headers['x-request-id']).toMatch(uuid);
});
