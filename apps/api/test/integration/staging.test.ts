import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { createProviders } from '../../src/infrastructure/providers.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import { encrypt } from '../../src/infrastructure/secrets.js';
import { digest } from '../../src/plugins/core.js';
import { testDatabase } from '../fixtures/database.js';
import { seedTeam } from '../fixtures/team.js';
import { stagingEnv } from '../fixtures/staging.js';

const config = loadConfig(stagingEnv);
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let coach: Awaited<ReturnType<typeof seedTeam>>;
let cookie: string;
let csrf: string;
let token: string;

function post(path: string, payload: object, authenticated = false) {
  return backend.app.inject({
    method: 'POST',
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      ...(authenticated ? { cookie, 'x-csrf-token': csrf } : {}),
    },
    payload,
  });
}

beforeAll(async () => {
  // Embedded PostgreSQL is injected; no connection to the fixture's Supabase URI occurs.
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db });
  coach = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Staging Coach',
        email: 'coach@example.test',
        role: 'MANAGER',
        passwordHash: await argon2.hash('CoachPass123!'),
        active: true,
        isVerified: true,
      },
    }),
    false,
  );
  const login = await post('/auth/staff-login', { email: coach.email, password: 'CoachPass123!' });
  expect(login.statusCode, login.body).toBe(200);
  const header = login.headers['set-cookie'];
  cookie = (Array.isArray(header) ? header[0]! : (header as string)).split(';')[0]!;
  csrf = login.json().csrfToken;
  expect(cookie).toMatch(/^__Host-pitchpresence=/);
  expect(Array.isArray(header) ? header.join(';') : header).toContain('Secure');
  const invite = await post('/management/invitations', {}, true);
  expect(invite.statusCode, invite.body).toBe(200);
  expect(new URL(invite.json().registrationUrl).origin).toBe(config.APP_URL);
  token = new URL(invite.json().registrationUrl).searchParams.get('invite')!;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});

it('blocks registration, recovery and invitations before creating records, jobs or credential changes', async () => {
  const before = await Promise.all([
    fixture.db.account.count(),
    fixture.db.user.count(),
    fixture.db.invitation.count(),
    fixture.db.verificationToken.count(),
    fixture.db.backgroundJob.count(),
  ]);
  const email = 'unapproved@example.test';
  for (const [path, body, authenticated] of [
    ['/auth/staff-register', { email, name: 'Unapproved', password: 'CoachPass123!' }, false],
    ['/auth/register', { email, name: 'Unapproved', pin: '2468', invitationToken: token }, false],
    ['/auth/password-reset/request', { email }, false],
    ['/auth/pin-reset/request', { email }, false],
    ['/auth/resend-otp', { email }, false],
    ['/auth/password-reset/confirm', { email, otp: '123456', password: 'CoachPass123!' }, false],
    ['/management/staff-invitations', { email }, true],
  ] as const) {
    const response = await post(path, body, authenticated);
    expect(response.statusCode, response.body).toBe(403);
    expect(response.json().error.code).toBe('STAGING_EMAIL_NOT_ALLOWED');
  }
  expect(
    await Promise.all([
      fixture.db.account.count(),
      fixture.db.user.count(),
      fixture.db.invitation.count(),
      fixture.db.verificationToken.count(),
      fixture.db.backgroundJob.count(),
    ]),
  ).toEqual(before);
});

it('allows fresh test accounts and bound staff invitations without weakening origin or cookie checks', async () => {
  const player = await post('/auth/register', {
    email: 'player@example.test',
    name: 'Test Player',
    pin: '2468',
    invitationToken: token,
  });
  expect(player.statusCode, player.body).toBe(200);
  expect(
    await fixture.db.user.findFirst({
      where: { email: 'player@example.test', teamId: coach.teamId },
    }),
  ).not.toBeNull();
  const invite = await post(
    '/management/staff-invitations',
    { email: 'second@example.test' },
    true,
  );
  expect(invite.statusCode, invite.body).toBe(200);
  const wrongOrigin = await backend.app.inject({
    method: 'POST',
    url: '/api/v1/auth/staff-register',
    headers: { origin: 'https://pitch-presence.kairos-devs.com' },
    payload: { email: 'second@example.test', name: 'Second', password: 'CoachPass123!' },
  });
  expect(wrongOrigin.json().error.code).toBe('ORIGIN_INVALID');
  const wrongCookie = await backend.app.inject({
    method: 'GET',
    url: '/api/v1/auth/me',
    headers: { cookie: cookie.replace('__Host-pitchpresence=', 'pitchpresence=') },
  });
  expect(wrongCookie.statusCode).toBe(401);
});

it('makes blocked worker deliveries terminal on the first attempt and clears sensitive payloads', async () => {
  // Drain test jobs without delivering; only the synthetic job below will be eligible.
  await fixture.db.backgroundJob.updateMany({ data: { completedAt: new Date(), payload: {} } });
  const removed = await fixture.db.user.create({
    data: {
      name: 'Previously approved',
      email: 'no-longer-approved@example.test',
      role: 'MANAGER',
      passwordHash: 'not-used',
      active: true,
      isVerified: false,
    },
  });
  const challenge = await fixture.db.verificationToken.create({
    data: {
      userId: removed.id,
      purpose: 'VERIFY_EMAIL',
      otpHash: digest('test'),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  const job = await fixture.db.backgroundJob.create({
    data: {
      kind: 'EMAIL_OTP',
      deduplicationKey: randomUUID(),
      payload: {
        userId: removed.id,
        challengeId: challenge.id,
        email: removed.email,
        purpose: 'VERIFY_EMAIL',
        encryptedOtp: encrypt(config.SESSION_SECRET, '123456'),
      },
    },
  });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const runner = new JobRunner(
    fixture.db,
    config,
    createProviders(config),
    backend.services.payments,
  );
  expect(await runner.tick()).toBe(true);
  const failed = await fixture.db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(failed.attempts).toBe(1);
  expect(failed.failedAt).not.toBeNull();
  expect(failed.lastError).toBe('STAGING_EMAIL_NOT_ALLOWED');
  expect(failed.payload).toEqual({});
  expect(failed.leaseToken).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  expect(await runner.tick()).toBe(false);
});
