import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { digest, keyedDigest, rateLimit } from '../../src/plugins/core.js';
import { testDatabase } from '../fixtures/database.js';
import { bankProviders } from '../fixtures/team.js';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'onboarding-session-secret-000000000000000',
  QR_SIGNING_SECRET: 'onboarding-qr-secret-00000000000000000000',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
const token = 'team-invitation-for-group-onboarding-test';
const post = (path: string, payload: unknown) =>
  backend.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: { origin: config.APP_URL, 'content-type': 'application/json' },
    payload: JSON.stringify(payload),
  });
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, {
    db: fixture.db,
    providers: {
      ...bankProviders,
      sendOtp: async () => {},
      initialize: async () => {
        throw new Error('Not used');
      },
      verify: async () => {
        throw new Error('Not used');
      },
    },
  });
  const owner = await fixture.db.user.create({
    data: {
      name: 'Coach',
      email: 'owner@test.com',
      role: 'MANAGER',
      passwordHash: await argon2.hash('StaffPass123!'),
    },
  });
  const team = await fixture.db.team.create({ data: { name: 'Group FC', createdBy: owner.id } });
  await fixture.db.user.update({ where: { id: owner.id }, data: { teamId: team.id } });
  await fixture.db.invitation.create({
    data: {
      teamId: team.id,
      createdBy: owner.id,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
});
beforeEach(async () => {
  await fixture.db.rateLimitBucket.deleteMany();
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
it('onboards fifty players on one IP and leaves staff registration independent', async () => {
  for (let i = 0; i < 50; i++) {
    const result = await post('/auth/register', {
      name: `Player ${i}`,
      email: `player${i}@test.com`,
      pin: '1234',
      invitationToken: token,
    });
    expect(result.statusCode, result.body).toBe(200);
  }
  const staff = await post('/auth/staff-register', {
    name: 'Staff',
    email: 'staff@test.com',
    password: 'StaffPass123!',
  });
  expect(staff.statusCode, staff.body).toBe(200);
  expect(await fixture.db.user.count({ where: { role: 'PLAYER' } })).toBe(50);
  expect(
    (
      await fixture.db.rateLimitBucket.findUniqueOrThrow({
        where: { key: 'register-v2:PLAYER:127.0.0.1' },
      })
    ).count,
  ).toBe(50);
  expect(
    (
      await fixture.db.rateLimitBucket.findUniqueOrThrow({
        where: { key: 'register-v2:MANAGER:127.0.0.1' },
      })
    ).count,
  ).toBe(1);
}, 60000);
it('counts failed submissions per normalized email across both registration roles', async () => {
  const email = 'failed@test.com';
  for (let i = 0; i < 5; i++) {
    const result = await post('/auth/register', {
      name: 'Failed',
      email: ' FAILED@test.com ',
      pin: '1234',
      invitationToken: 'invalid-invitation-token-long-enough',
    });
    expect(result.statusCode).toBe(422);
  }
  const blocked = await post('/auth/staff-register', {
    name: 'Staff',
    email,
    password: 'StaffPass123!',
  });
  expect(blocked.statusCode).toBe(429);
  const wait = blocked.json().error.retryAfterSeconds;
  expect(wait).toBeGreaterThan(0);
  expect(wait).toBeLessThanOrEqual(900);
  expect(Number(blocked.headers['retry-after'])).toBe(wait);
  expect(await fixture.db.user.findFirst({ where: { email } })).toBeNull();
});
it('retains email verification cooldown while allowing many accounts to request codes', async () => {
  const first = await post('/auth/resend-otp', { email: 'unknown@test.com' });
  expect(first.statusCode).toBe(200);
  const second = await post('/auth/resend-otp', { email: 'unknown@test.com' });
  expect(second.statusCode).toBe(429);
  expect(second.json().error.retryAfterSeconds).toBeLessThanOrEqual(60);
  for (let i = 0; i < 50; i++)
    expect((await post('/auth/resend-otp', { email: `unknown${i}@test.com` })).statusCode).toBe(
      200,
    );
  const hourKey = `otp-hour:${keyedDigest(config.SESSION_SECRET, 'hour@test.com')}`;
  await fixture.db.rateLimitBucket.create({
    data: { key: hourKey, count: 5, expiresAt: new Date(Date.now() + 3600000) },
  });
  expect((await post('/auth/resend-otp', { email: 'hour@test.com' })).statusCode).toBe(429);
});
it('permits fifty invitation previews and exposes a wait when the limit is reached', async () => {
  for (let i = 0; i < 50; i++)
    expect(
      (await backend.app.inject({ url: `/api/v1/invitations/preview?token=${token}` })).statusCode,
    ).toBe(200);
  await fixture.db.rateLimitBucket.update({
    where: { key: 'invitation-preview-v2:127.0.0.1' },
    data: { count: 120 },
  });
  const blocked = await backend.app.inject({ url: `/api/v1/invitations/preview?token=${token}` });
  expect(blocked.statusCode).toBe(429);
  expect(blocked.json().error.retryAfterSeconds).toBeGreaterThan(0);
});
it('atomically limits concurrent requests, preserves expiry on rejection and resets expired windows', async () => {
  const key = randomUUID();
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () => rateLimit(fixture.db, key, 5, 60)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  const before = await fixture.db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  await expect(rateLimit(fixture.db, key, 5, 60)).rejects.toMatchObject({
    status: 429,
    retryAfterSeconds: expect.any(Number),
  });
  const after = await fixture.db.rateLimitBucket.findUniqueOrThrow({ where: { key } });
  expect(after.expiresAt).toEqual(before.expiresAt);
  await fixture.db.rateLimitBucket.update({
    where: { key },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await rateLimit(fixture.db, key, 5, 60);
  expect((await fixture.db.rateLimitBucket.findUniqueOrThrow({ where: { key } })).count).toBe(1);
});

it('enforces the higher player and independent staff IP ceilings before creating accounts', async () => {
  for (const [role, count, path, credential] of [
    ['PLAYER', 120, '/auth/register', { pin: '1234', invitationToken: token }],
    ['MANAGER', 30, '/auth/staff-register', { password: 'StaffPass123!' }],
  ] as const) {
    await fixture.db.rateLimitBucket.create({
      data: {
        key: `register-v2:${role}:127.0.0.1`,
        count,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const result = await post(path, {
      name: 'Limited',
      email: `${role.toLowerCase()}-limited@test.com`,
      ...credential,
    });
    expect(result.statusCode).toBe(429);
    expect(result.json().error.retryAfterSeconds).toBeLessThanOrEqual(3600);
  }
});
it('returns a timed login-account lockout without extending its expiry', async () => {
  const email = 'login-lock@test.com';
  const key = `login-account:${keyedDigest(config.SESSION_SECRET, email)}`;
  const expiresAt = new Date(Date.now() + 600000);
  await fixture.db.rateLimitBucket.create({ data: { key, count: 5, expiresAt } });
  const result = await post('/auth/staff-login', { email, password: 'StaffPass123!' });
  expect(result.statusCode).toBe(429);
  expect(result.json().error.retryAfterSeconds).toBeGreaterThan(0);
  expect(result.json().error.retryAfterSeconds).toBeLessThanOrEqual(600);
  expect(
    (await fixture.db.rateLimitBucket.findUniqueOrThrow({ where: { key } })).expiresAt,
  ).toEqual(expiresAt);
});
