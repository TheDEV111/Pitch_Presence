import { expect, it, vi } from 'vitest';
import { createECDH, randomBytes } from 'node:crypto';
import { loadConfig } from '../../src/config/index.js';
const { sendNotification } = vi.hoisted(() => ({ sendNotification: vi.fn() }));
vi.mock('web-push', () => ({ default: { sendNotification } }));
import { createPushSender } from '../../src/infrastructure/push.js';
const vapid = createECDH('prime256v1');
vapid.generateKeys();
const config = loadConfig({
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'push-unit-session-secret-00000000000',
  QR_SIGNING_SECRET: 'push-unit-qr-secret-000000000000000',
  VAPID_PUBLIC_KEY: vapid.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: vapid.getPrivateKey().toString('base64url'),
  VAPID_SUBJECT: 'mailto:contact@example.com',
});
const client = createECDH('prime256v1');
client.generateKeys();
const subscription = {
  endpoint: 'https://web.push.apple.com/test',
  keys: {
    p256dh: client.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
};
const payload = {
  receiptId: '10000000-0000-4000-8000-000000000001',
  url: '/management/dues?month=2026-10',
};
it('uses encrypted standards-based push with bounded timeout, TTL and a stable retry topic', async () => {
  sendNotification.mockResolvedValue({ statusCode: 201 });
  expect(await createPushSender(config)(subscription, payload)).toBe('sent');
  const [, content, options] = sendNotification.mock.calls[0]!;
  expect(JSON.parse(content)).toEqual(payload);
  expect(options).toMatchObject({ contentEncoding: 'aes128gcm', TTL: 3600, timeout: 10000 });
  expect(options.topic).toHaveLength(32);
});
it('drops expired subscriptions and strips sensitive provider exceptions before retrying', async () => {
  for (const statusCode of [404, 410]) {
    sendNotification.mockRejectedValueOnce({ statusCode });
    expect(await createPushSender(config)(subscription, payload)).toBe('gone');
  }
  sendNotification.mockRejectedValueOnce({ statusCode: 503, message: subscription.endpoint });
  await expect(createPushSender(config)(subscription, payload)).rejects.toThrow(
    'Push provider unavailable',
  );
});
it('rejects partial and mismatched VAPID configuration without printing secret values', () => {
  expect(() =>
    loadConfig({ ...config, PORT: String(config.PORT), VAPID_PRIVATE_KEY: 'invalid-secret' }),
  ).toThrow('Push notifications require');
  expect(() => loadConfig({ ...config, PORT: String(config.PORT), VAPID_SUBJECT: '' })).toThrow(
    'Push notifications require',
  );
});
