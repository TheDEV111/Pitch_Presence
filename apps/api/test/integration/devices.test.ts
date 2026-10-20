import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { User } from '@pitchpresence/database';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import { digest } from '../../src/plugins/core.js';
import { testDatabase } from '../fixtures/database.js';
import { bankProviders, seedTeam } from '../fixtures/team.js';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'devices-session-secret-00000000000000000',
  QR_SIGNING_SECRET: 'devices-qr-secret-0000000000000000000000',
  LOG_LEVEL: 'silent',
});
const providers = {
  ...bankProviders,
  sendOtp: async () => {},
  initialize: async () => {
    throw new Error('Not used');
  },
  verify: async () => {
    throw new Error('Not used');
  },
};
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let staff: User, foreign: User, player: User;
let hash: string;
type Session = Awaited<ReturnType<typeof backend.services.auth.createSession>>;
function request(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  session: Session,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return backend.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      'content-type': 'application/json',
      cookie: `pitchpresence=${session.token}`,
      'x-csrf-token': session.csrfToken,
      ...headers,
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  hash = await argon2.hash('CoachPass123!');
});
beforeEach(async () => {
  async function coach() {
    return seedTeam(
      fixture.db,
      await fixture.db.user.create({
        data: {
          email: `${randomUUID()}@example.test`,
          name: 'Coach',
          role: 'MANAGER',
          passwordHash: hash,
          isVerified: true,
          active: true,
        },
      }),
    );
  }
  staff = await coach();
  foreign = await coach();
  const pinHash = await argon2.hash('2468');
  await fixture.db.account.update({ where: { id: staff.accountId }, data: { pinHash } });
  player = await fixture.db.user.create({
    data: {
      accountId: staff.accountId,
      email: staff.email,
      name: 'Player',
      teamId: foreign.teamId,
      role: 'PLAYER',
      pinHash,
      isVerified: true,
      active: true,
    },
  });
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});

it('stores coarse login labels and lists current sessions newest first without credential data', async () => {
  const existing = await backend.services.auth.createSession(staff);
  const login = await request(
    'POST',
    '/auth/staff-login',
    existing,
    { email: staff.email, password: 'CoachPass123!' },
    {
      'user-agent':
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
    },
  );
  expect(login.statusCode, login.body).toBe(200);
  const cookie = login.cookies.find((item) => item.name === 'pitchpresence')!.value;
  const current = { ...existing, token: cookie, csrfToken: login.json().csrfToken };
  const old = await fixture.db.deviceSession.findFirstOrThrow({
    where: { userId: staff.id, deviceLabel: null },
  });
  await fixture.db.deviceSession.update({
    where: { id: old.id },
    data: { lastUsedAt: new Date(Date.now() - 3600000) },
  });
  const expired = await fixture.db.deviceSession.create({
    data: { userId: staff.id, tokenHash: randomUUID(), expiresAt: new Date(0) },
  });
  const result = await request('GET', '/auth/sessions?limit=1', current);
  const first = result.json().items[0];
  expect(first.deviceLabel).toBe('Chrome on Android');
  expect(first.isCurrent).toBe(true);
  expect(first).not.toHaveProperty('tokenHash');
  expect(first).not.toHaveProperty('token');
  expect(first).not.toHaveProperty('userAgent');
  const next = await request(
    'GET',
    `/auth/sessions?limit=1&cursor=${result.json().nextCursor}`,
    current,
  );
  expect(next.json().items[0].id).toBe(old.id);
  expect(next.json().items[0].deviceLabel).toBeNull();
  expect(next.json().items[0].isCurrent).toBe(false);
  await new JobRunner(fixture.db, config, providers, backend.services.payments).maintain();
  expect(await fixture.db.deviceSession.findUnique({ where: { id: expired.id } })).toBeNull();
  expect((await request('GET', '/auth/me', current)).statusCode).toBe(200);
});

it('requires reauthentication and revokes other sessions across teams, preserving this device and other accounts', async () => {
  const current = await backend.services.auth.createSession(staff);
  const another = await backend.services.auth.createSession(player);
  const outsider = await backend.services.auth.createSession(foreign);
  const anotherRow = await fixture.db.deviceSession.findFirstOrThrow({
    where: { userId: player.id },
  });
  // Revocation must also remove private notification subscriptions.
  const staffOther = await backend.services.auth.createSession(staff);
  const staffOtherRow = await fixture.db.deviceSession.findUniqueOrThrow({
    where: { tokenHash: digest(staffOther.token) },
  });
  await fixture.db.pushSubscription.create({
    data: {
      userId: staff.id,
      teamId: staff.teamId!,
      sessionId: staffOtherRow.id,
      endpointHash: randomUUID(),
      encryptedSubscription: 'test-encrypted',
      vapidPublicKey: 'test-public',
    },
  });
  const denied = await request('POST', '/auth/sessions/revoke-others', current, {
    credential: 'wrong',
  });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('REAUTHENTICATION_FAILED');
  expect((await request('GET', '/auth/me', another)).statusCode).toBe(200);
  expect(
    (
      await request(
        'POST',
        '/auth/sessions/revoke-others',
        current,
        {
          credential: 'CoachPass123!',
        },
        { 'x-csrf-token': 'incorrect' },
      )
    ).statusCode,
  ).toBe(403);
  const result = await request('POST', '/auth/sessions/revoke-others', current, {
    credential: 'CoachPass123!',
  });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().revoked).toBe(2);
  expect((await request('GET', '/auth/me', current)).statusCode).toBe(200);
  expect((await request('GET', '/auth/me', another)).statusCode).toBe(401);
  expect((await request('GET', '/auth/me', staffOther)).statusCode).toBe(401);
  expect((await request('GET', '/auth/me', outsider)).statusCode).toBe(200);
  expect(await fixture.db.pushSubscription.count({ where: { sessionId: staffOtherRow.id } })).toBe(
    0,
  );
  expect(
    (await fixture.db.deviceSession.findUniqueOrThrow({ where: { id: anotherRow.id } })).revokedAt,
  ).not.toBeNull();
});

it('requires a player PIN and prevents revoking a session owned by another account', async () => {
  const current = await backend.services.auth.createSession(player);
  const another = await backend.services.auth.createSession(staff);
  const outsider = await backend.services.auth.createSession(foreign);
  const foreignRow = await fixture.db.deviceSession.findFirstOrThrow({
    where: { userId: foreign.id },
  });
  expect((await request('GET', `/auth/sessions?cursor=${foreignRow.id}`, current)).statusCode).toBe(
    404,
  );
  expect((await request('DELETE', `/auth/sessions/${foreignRow.id}`, current)).statusCode).toBe(
    404,
  );
  expect(
    (
      await request('POST', '/auth/sessions/revoke-others', current, {
        credential: 'CoachPass123!',
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await request('POST', '/auth/sessions/revoke-others', current, { credential: '2468' })).json()
      .revoked,
  ).toBe(1);
  expect((await request('GET', '/auth/me', current)).statusCode).toBe(200);
  expect((await request('GET', '/auth/me', another)).statusCode).toBe(401);
  expect((await request('GET', '/auth/me', outsider)).statusCode).toBe(200);
});

it('limits repeated credential guesses without revoking any sessions', async () => {
  const current = await backend.services.auth.createSession(player);
  for (let i = 0; i < 5; i++)
    expect(
      (await request('POST', '/auth/sessions/revoke-others', current, { credential: '0000' }))
        .statusCode,
    ).toBe(403);
  expect(
    (await request('POST', '/auth/sessions/revoke-others', current, { credential: '2468' }))
      .statusCode,
  ).toBe(429);
  expect((await request('GET', '/auth/me', current)).statusCode).toBe(200);
});
