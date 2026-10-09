import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { testDatabase } from '../fixtures/database.js';
import { seedTeam, bankProviders } from '../fixtures/team.js';
import { encrypt, decrypt } from '../../src/infrastructure/secrets.js';
import { localMonth, keyedDigest } from '../../src/plugins/core.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import type { PushSender } from '../../src/infrastructure/push.js';
import type { Providers } from '../../src/infrastructure/providers.js';
import type { User } from '@pitchpresence/database';

const keys = createECDH('prime256v1');
keys.generateKeys();
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'notification-test-session-secret-00000000',
  QR_SIGNING_SECRET: 'notification-test-qr-secret-000000000000',
  VAPID_PUBLIC_KEY: keys.getPublicKey().toString('base64url'),
  VAPID_PRIVATE_KEY: Buffer.from(
    keys.getPrivateKey().toString('hex').padStart(64, '0'),
    'hex',
  ).toString('base64url'),
  VAPID_SUBJECT: 'mailto:test@example.com',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let staff: User, colleague: User, outsider: User, player: User;
let sessions: Record<string, Awaited<ReturnType<typeof backend.services.auth.createSession>>>;
let pinHash: string, accountId: string, duesId: string;
const sendPush = vi.fn<PushSender>().mockResolvedValue('sent');
const providers: Providers = {
  ...bankProviders,
  sendOtp: async () => {},
  initialize: async () => {
    throw new Error('Paystack is paused');
  },
  verify: async () => {
    throw new Error('Paystack is paused');
  },
};
const runner = () =>
  new JobRunner(fixture.db, config, providers, backend.services.payments, () => {}, sendPush);
function subscription(name = randomUUID()) {
  const client = createECDH('prime256v1');
  client.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: {
      p256dh: client.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}
function request(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown = {},
  actor = staff,
) {
  const session = sessions[actor.id]!;
  return backend.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      cookie: `pitchpresence=${session.token}`,
      'x-csrf-token': session.csrfToken,
      'content-type': 'application/json',
    },
    ...(method !== 'GET' ? { payload: JSON.stringify(body) } : {}),
  });
}
async function upload(suffix = 'one') {
  const body = {
    amount: 300000,
    accountId,
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    content: Buffer.from(
      `%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n% ${suffix}\n%%EOF\n`,
    ).toString('base64'),
  };
  const result = await request('POST', `/me/dues/${duesId}/receipt`, body, player);
  expect(result.statusCode).toBe(200);
  return result.json<{ id: string }>();
}
async function drain() {
  const worker = runner();
  while (await worker.tick()) {}
}
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  pinHash = await argon2.hash('1234');
});
afterAll(async () => {
  await backend?.app.close();
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.db.backgroundJob.deleteMany();
  await fixture.db.pushSubscription.deleteMany();
  sendPush.mockReset().mockResolvedValue('sent');
  const createStaff = () =>
    fixture.db.user.create({
      data: {
        email: `${randomUUID()}@example.com`,
        name: 'Coach',
        role: 'MANAGER',
        passwordHash: pinHash,
        active: true,
        isVerified: true,
        activatedAt: new Date(),
      },
    });
  staff = await seedTeam(fixture.db, await createStaff(), false);
  outsider = await seedTeam(fixture.db, await createStaff(), false);
  colleague = await fixture.db.user.create({
    data: {
      name: 'Assistant coach',
      email: `${randomUUID()}@example.com`,
      teamId: staff.teamId,
      role: 'MANAGER',
      passwordHash: pinHash,
      active: true,
      isVerified: true,
      activatedAt: new Date(),
    },
  });
  player = await fixture.db.user.create({
    data: {
      name: 'Tobi Ade',
      email: `${randomUUID()}@example.com`,
      teamId: staff.teamId,
      role: 'PLAYER',
      pinHash,
      active: true,
      isVerified: true,
      activatedAt: new Date(),
    },
  });
  sessions = {};
  for (const user of [staff, colleague, outsider, player])
    sessions[user.id] = await backend.services.auth.createSession(user);
  const account = await fixture.db.teamTransferAccount.create({
    data: {
      teamId: staff.teamId!,
      configuredBy: staff.id,
      bankName: 'Test Bank',
      accountName: 'Team',
      accountLast4: '1111',
      encryptedNumber: encrypt(config.DATA_ENCRYPTION_SECRET, '1111111111'),
    },
  });
  accountId = account.id;
  await fixture.db.team.update({
    where: { id: staff.teamId! },
    data: { transferAccountId: accountId },
  });
  await backend.services.dues.configure(localMonth(), 300000, staff.id, 'test');
  duesId = (await backend.services.dues.own(player)).items[0]!.id;
});

it('staff opt in securely, endpoints and keys stay private, and players cannot subscribe', async () => {
  const input = subscription();
  expect((await request('POST', '/management/notifications/push', input, player)).statusCode).toBe(
    403,
  );
  for (const endpoint of [
    'http://fcm.googleapis.com/a',
    'https://127.0.0.1/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://user:pass@fcm.googleapis.com/a',
    'https://web.push.apple.com:444/a',
  ])
    expect(
      (await request('POST', '/management/notifications/push', { ...input, endpoint })).statusCode,
    ).toBe(422);
  expect(
    (
      await request('POST', '/management/notifications/push', {
        ...input,
        keys: { ...input.keys, auth: 'bad' },
      })
    ).statusCode,
  ).toBe(422);
  expect((await request('GET', '/management/notifications/push')).json()).toMatchObject({
    available: true,
    enabled: false,
  });
  expect((await request('POST', '/management/notifications/push', input)).json()).toEqual({
    enabled: true,
  });
  await request('POST', '/management/notifications/push', input);
  expect(await fixture.db.pushSubscription.count()).toBe(1);
  const row = await fixture.db.pushSubscription.findFirstOrThrow();
  expect(row.encryptedSubscription).not.toContain(input.endpoint);
  expect(JSON.parse(decrypt(config.DATA_ENCRYPTION_SECRET, row.encryptedSubscription))).toEqual(
    input,
  );
  const settings = await request('GET', '/management/notifications/push');
  expect(settings.body).not.toContain(input.keys.auth);
  expect(settings.body).not.toContain(input.endpoint);
  expect(settings.body).not.toContain(config.VAPID_PRIVATE_KEY);
});
it('a successful upload fans out to team staff only and its retry never creates another alert', async () => {
  await request('POST', '/management/notifications/push', subscription(), staff);
  await request('POST', '/management/notifications/push', subscription(), colleague);
  await request('POST', '/management/notifications/push', subscription(), outsider);
  const receipt = await upload();
  await upload();
  expect(await fixture.db.backgroundJob.count({ where: { kind: 'PUSH_RECEIPT_SUBMITTED' } })).toBe(
    2,
  );
  expect((await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } })).status).toBe(
    'NOT_PAID',
  );
  await drain();
  expect(sendPush).toHaveBeenCalledTimes(2);
  for (const [, payload] of sendPush.mock.calls)
    expect(payload).toEqual({
      receiptId: receipt.id,
      url: `/management/dues?month=${localMonth()}`,
    });
  expect(JSON.stringify(sendPush.mock.calls.map((call) => call[1]))).not.toContain(player.name);
  await drain();
  expect(sendPush).toHaveBeenCalledTimes(2);
});
it('push failures do not lose the receipt, are retried, and gone subscriptions are removed', async () => {
  await request('POST', '/management/notifications/push', subscription());
  const receipt = await upload();
  sendPush.mockRejectedValueOnce(new Error('temporary network problem'));
  await drain();
  const job = await fixture.db.backgroundJob.findFirstOrThrow({
    where: { kind: 'PUSH_RECEIPT_SUBMITTED' },
  });
  expect(job.completedAt).toBeNull();
  expect(job.attempts).toBe(1);
  expect(await fixture.db.paymentReceipt.findUnique({ where: { id: receipt.id } })).not.toBeNull();
  await fixture.db.backgroundJob.update({
    where: { id: job.id },
    data: { availableAt: new Date() },
  });
  sendPush.mockResolvedValueOnce('gone');
  await drain();
  expect(await fixture.db.pushSubscription.count()).toBe(0);
  expect(
    (await fixture.db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } })).completedAt,
  ).not.toBeNull();
});
it('reviewed receipts, revoked sessions and disabled devices receive no queued push', async () => {
  await request('POST', '/management/notifications/push', subscription(), staff);
  await request('POST', '/management/notifications/push', subscription(), colleague);
  await upload();
  await request('DELETE', '/management/notifications/push', {}, colleague);
  expect((await request('POST', '/auth/logout')).statusCode).toBe(200);
  await drain();
  expect(sendPush).not.toHaveBeenCalled();
  // A newly opted-in staff device can still skip an already-reviewed receipt.
  sessions[staff.id] = await backend.services.auth.createSession(staff);
  await request('POST', '/management/notifications/push', subscription());
  const existing = await fixture.db.paymentReceipt.findUniqueOrThrow({
    where: {
      paymentId: (await fixture.db.payment.findFirstOrThrow({ where: { monthlyDuesId: duesId } }))
        .id,
    },
  });
  await request('POST', `/management/receipts/${existing.id}/review`, { decision: 'APPROVE' });
  const sub = await fixture.db.pushSubscription.findFirstOrThrow();
  await fixture.db.backgroundJob.create({
    data: {
      teamId: staff.teamId!,
      kind: 'PUSH_RECEIPT_SUBMITTED',
      payload: { receiptId: existing.id, subscriptionId: sub.id },
      deduplicationKey: randomUUID(),
    },
  });
  await drain();
  expect(sendPush).not.toHaveBeenCalled();
});
it('new consent on a shared browser cannot redirect an old team notification to its new owner', async () => {
  const input = subscription();
  await request('POST', '/management/notifications/push', input);
  await upload();
  const before = await fixture.db.pushSubscription.findFirstOrThrow();
  await request('POST', '/management/notifications/push', input, outsider);
  const after = await fixture.db.pushSubscription.findFirstOrThrow();
  expect(after.id).not.toBe(before.id);
  expect(after.teamId).toBe(outsider.teamId);
  await drain();
  expect(sendPush).not.toHaveBeenCalled();
});
it('dues search is case insensitive, paginated and scoped to the manager’s team', async () => {
  for (const name of ['Tobi Bamidele', 'Sola Ade', 'Tobi Outside'])
    await fixture.db.user.create({
      data: {
        name,
        email: `${randomUUID()}@example.com`,
        teamId: name.endsWith('Outside') ? outsider.teamId : staff.teamId,
        role: 'PLAYER',
        pinHash,
        active: true,
        isVerified: true,
        activatedAt: new Date(),
      },
    });
  const first = (await request('GET', '/management/dues?search=TOBI&limit=1')).json();
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).not.toBeNull();
  const second = (
    await request('GET', `/management/dues?search=tobi&limit=1&cursor=${first.nextCursor}`)
  ).json();
  expect(second.items).toHaveLength(1);
  expect(second.nextCursor).toBeNull();
  expect([first.items[0].player.name, second.items[0].player.name].sort()).toEqual([
    'Tobi Ade',
    'Tobi Bamidele',
  ]);
  expect((await request('GET', '/management/dues?search=missing')).json().items).toEqual([]);
  expect((await request('GET', '/management/dues?search=tobi&status=PAID')).json().items).toEqual(
    [],
  );
});
it('removing a player preserves dues, revokes every device, blocks reactivation, and returns a specific login error', async () => {
  const receipt = await upload();
  const secondSession = await backend.services.auth.createSession(player);
  expect(
    (await request('POST', `/management/players/${player.id}/remove`, {}, outsider)).statusCode,
  ).toBe(404);
  expect((await request('POST', `/management/players/${staff.id}/remove`)).statusCode).toBe(404);
  expect(
    (await request('POST', `/management/players/${player.id}/remove`, {}, player)).statusCode,
  ).toBe(403);
  const removed = await request('POST', `/management/players/${player.id}/remove`);
  expect(removed.json()).toMatchObject({ active: false, teamId: staff.teamId });
  expect(removed.json().removedAt).toBeTruthy();
  expect(
    await fixture.db.deviceSession.count({ where: { userId: player.id, revokedAt: null } }),
  ).toBe(0);
  expect((await request('GET', '/auth/me', {}, player)).json().error.code).toBe('PLAYER_REMOVED');
  await expect(backend.services.auth.resolve(secondSession.token, true)).rejects.toMatchObject({
    code: 'PLAYER_REMOVED',
  });
  const login = (pin: string) =>
    backend.app.inject({
      method: 'POST',
      url: '/api/v1/auth/device-login',
      headers: { origin: config.APP_URL },
      payload: { email: player.email, pin },
    });
  expect((await login('1234')).json().error.code).toBe('PLAYER_REMOVED');
  expect((await login('9999')).json().error.code).toBe('LOGIN_FAILED');
  expect(
    (await request('PATCH', `/management/players/${player.id}`, { active: true })).json().error
      .code,
  ).toBe('PLAYER_REMOVED');
  expect(
    (await request('GET', '/management/players'))
      .json()
      .items.some((u: { id: string }) => u.id === player.id),
  ).toBe(false);
  expect(
    (await request('GET', '/management/players?includeRemoved=true'))
      .json()
      .items.some((u: { id: string }) => u.id === player.id),
  ).toBe(true);
  expect(
    (await request('GET', '/management/dues?search=Tobi')).json().items[0].payments[0].receipt.id,
  ).toBe(receipt.id);
  expect((await request('POST', `/management/players/${player.id}/remove`)).statusCode).toBe(200);
  expect(
    await fixture.db.auditEvent.count({ where: { action: 'PLAYER_REMOVED', entityId: player.id } }),
  ).toBe(1);
});
it('removal consumes pending verification and reset codes, preventing onboarding from reactivating an account', async () => {
  await backend.services.auth.issueOtp(player.email, 'PIN_RESET');
  expect(
    await fixture.db.verificationToken.count({ where: { userId: player.id, consumedAt: null } }),
  ).toBe(1);
  await request('POST', `/management/players/${player.id}/remove`);
  expect(
    await fixture.db.verificationToken.count({ where: { userId: player.id, consumedAt: null } }),
  ).toBe(0);
  await fixture.db.rateLimitBucket.deleteMany({
    where: { key: `otp-cooldown:${keyedDigest(config.SESSION_SECRET, player.email)}` },
  });
  const jobsBefore = await fixture.db.backgroundJob.count();
  await backend.services.auth.issueOtp(player.email, 'PIN_RESET');
  expect(await fixture.db.backgroundJob.count()).toBe(jobsBefore);
  expect(await fixture.db.paymentReceipt.count({ where: { playerId: player.id } })).toBe(0);
});
