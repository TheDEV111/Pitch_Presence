import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import type { User } from '@pitchpresence/database';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { digest, localMonth } from '../../src/plugins/core.js';
import { decrypt } from '../../src/infrastructure/secrets.js';
import { testDatabase } from '../fixtures/database.js';
import { bankProviders, seedTeam } from '../fixtures/team.js';

const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'memberships-session-secret-000000000000000',
  QR_SIGNING_SECRET: 'memberships-qr-secret-0000000000000000000',
  MULTI_TEAM_ENABLED: 'true',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let coach: User, other: User;
const password = 'CoachPass123!';
type Session = { token: string; csrfToken: string };
const request = (method: 'GET' | 'POST', path: string, body?: unknown, session?: Session) =>
  backend.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      'content-type': 'application/json',
      ...(session
        ? { cookie: `pitchpresence=${session.token}`, 'x-csrf-token': session.csrfToken }
        : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
function sessionOf(result: Awaited<ReturnType<typeof request>>): Session {
  return {
    token: result.cookies.find((cookie) => cookie.name === 'pitchpresence')!.value,
    csrfToken: result.json().csrfToken,
  };
}
async function invitation(owner: User, kind: 'PLAYER' | 'MANAGER', email?: string) {
  const token = `${randomUUID()}-${randomUUID()}`;
  await fixture.db.invitation.create({
    data: {
      teamId: owner.teamId!,
      createdBy: owner.id,
      kind,
      email,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return token;
}
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
  const hash = await argon2.hash(password);
  coach = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Henry',
        email: 'henry@example.test',
        role: 'MANAGER',
        passwordHash: hash,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    }),
  );
  other = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Other',
        email: 'other@example.test',
        role: 'MANAGER',
        passwordHash: hash,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    }),
  );
});
beforeEach(async () => {
  await fixture.db.rateLimitBucket.deleteMany();
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
let player: User;
let playerSession: Session;
it('joins another team as a player with one identity and preserved original membership', async () => {
  const original = await fixture.db.user.findUniqueOrThrow({ where: { id: coach.id } });
  const token = await invitation(other, 'PLAYER');
  const session = await backend.services.auth.createSession(coach);
  const joined = await request('POST', '/auth/invitations/accept', { token, pin: '2468' }, session);
  expect(joined.statusCode, joined.body).toBe(200);
  expect(joined.json().user.role).toBe('PLAYER');
  expect(joined.json().user.teamId).toBe(other.teamId);
  expect(joined.json().memberships).toHaveLength(2);
  playerSession = sessionOf(joined);
  player = await fixture.db.user.findUniqueOrThrow({ where: { id: joined.json().user.id } });
  expect(player.accountId).toBe(coach.accountId);
  expect(player.id).not.toBe(coach.id);
  expect(await fixture.db.user.findUniqueOrThrow({ where: { id: coach.id } })).toEqual(original);
  expect(await fixture.db.account.count({ where: { email: coach.email } })).toBe(1);
  expect((await request('GET', '/auth/me', undefined, session)).statusCode).toBe(401);
  const replay = await request('POST', '/auth/invitations/accept', { token }, playerSession);
  expect(replay.statusCode).toBe(200);
  expect(replay.json().user.id).toBe(player.id);
  expect(await fixture.db.user.count({ where: { accountId: coach.accountId } })).toBe(2);
  playerSession = sessionOf(replay);
  await fixture.db.monthlyDues.create({
    data: { teamId: player.teamId!, playerId: player.id, month: localMonth() },
  });
});
it('PIN authentication cannot open coaching routes or switch to staff without a password', async () => {
  const login = await request('POST', '/auth/device-login', { email: coach.email, pin: '2468' });
  expect(login.statusCode).toBe(200);
  const session = sessionOf(login);
  expect(login.json().authMethod).toBe('PIN');
  expect(login.json().user.id).toBe(player.id);
  expect((await request('GET', '/management/overview', undefined, session)).statusCode).toBe(403);
  expect(
    (await request('POST', '/auth/memberships/switch', { membershipId: coach.id }, session))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        'POST',
        '/auth/memberships/switch',
        { membershipId: coach.id, password: 'Incorrect1!' },
        session,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await request(
        'POST',
        '/auth/memberships/switch',
        { membershipId: other.id, password },
        session,
      )
    ).statusCode,
  ).toBe(404);
  const switched = await request(
    'POST',
    '/auth/memberships/switch',
    { membershipId: coach.id, password },
    session,
  );
  expect(switched.statusCode, switched.body).toBe(200);
  expect(switched.json().authMethod).toBe('PASSWORD');
  expect(switched.json().user.id).toBe(coach.id);
  expect((await request('GET', '/auth/me', undefined, session)).statusCode).toBe(401);
  const overview = await request('GET', '/management/overview', undefined, sessionOf(switched));
  expect(overview.statusCode).toBe(200);
  expect(overview.json().team.id).toBe(coach.teamId);
});
it('duplicates are rejected at signup without changing identity credentials or membership', async () => {
  const before = await fixture.db.account.findUniqueOrThrow({ where: { id: coach.accountId } });
  const token = await invitation(other, 'PLAYER');
  const duplicate = await request('POST', '/auth/register', {
    name: 'Replacement',
    email: coach.email,
    pin: '9999',
    invitationToken: token,
  });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.json().error.code).toBe('ACCOUNT_EXISTS');
  expect(await fixture.db.account.findUniqueOrThrow({ where: { id: coach.accountId } })).toEqual(
    before,
  );
});
it('a player establishes a password using email recovery before accepting staff membership', async () => {
  const pinHash = await argon2.hash('1234');
  const newcomer = await fixture.db.user.create({
    data: {
      name: 'New coach',
      email: 'new@example.test',
      pinHash,
      teamId: other.teamId,
      active: true,
      isVerified: true,
    },
  });
  const token = await invitation(coach, 'MANAGER', newcomer.email);
  const session = await backend.services.auth.createSession(newcomer);
  const denied = await request('POST', '/auth/invitations/accept', { token }, session);
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('PASSWORD_REQUIRED');
  expect(
    (await request('POST', '/auth/password-reset/request', { email: newcomer.email })).statusCode,
  ).toBe(200);
  const job = await fixture.db.backgroundJob.findFirstOrThrow({
    where: { kind: 'EMAIL_OTP', payload: { path: ['userId'], equals: newcomer.id } },
    orderBy: { createdAt: 'desc' },
  });
  const otp = decrypt(
    config.SESSION_SECRET,
    (job.payload as { encryptedOtp: string }).encryptedOtp,
  );
  expect(
    (
      await request('POST', '/auth/password-reset/confirm', {
        email: newcomer.email,
        otp,
        password,
      })
    ).statusCode,
  ).toBe(200);
  const login = await request('POST', '/auth/staff-login', { email: newcomer.email, password });
  expect(login.statusCode, login.body).toBe(200);
  expect(login.json().authMethod).toBe('PASSWORD');
  const accepted = await request('POST', '/auth/invitations/accept', { token }, sessionOf(login));
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(accepted.json().user.role).toBe('MANAGER');
  expect(accepted.json().user.teamId).toBe(coach.teamId);
});
it('removal from one team preserves access and historical identity in another', async () => {
  const admin = await backend.services.auth.createSession(other);
  const removed = await request('POST', `/management/players/${player.id}/remove`, {}, admin);
  expect(removed.statusCode, removed.body).toBe(200);
  const login = await request('POST', '/auth/staff-login', { email: coach.email, password });
  expect(login.statusCode).toBe(200);
  expect(login.json().user.id).toBe(coach.id);
  expect((await fixture.db.user.findUniqueOrThrow({ where: { id: coach.id } })).active).toBe(true);
  const denied = await request('POST', '/auth/device-login', { email: coach.email, pin: '2468' });
  expect(denied.statusCode).toBe(403);
  expect(denied.json().error.code).toBe('PLAYER_REMOVED');
});

it('rejects stale-tab reads and mutations before they can affect the newly selected team', async () => {
  const session = await backend.services.auth.createSession(coach);
  const email = 'should-not-be-invited@example.test';
  const result = await backend.app.inject({
    method: 'POST',
    url: '/api/v1/management/staff-invitations',
    headers: {
      origin: config.APP_URL,
      'content-type': 'application/json',
      cookie: `pitchpresence=${session.token}`,
      'x-csrf-token': session.csrfToken,
      'x-membership-id': other.id,
    },
    payload: JSON.stringify({ email }),
  });
  expect(result.statusCode).toBe(409);
  expect(result.json().error.code).toBe('WORKSPACE_CHANGED');
  expect(await fixture.db.invitation.count({ where: { email } })).toBe(0);
  const read = await backend.app.inject({
    url: '/api/v1/management/overview',
    headers: { cookie: `pitchpresence=${session.token}`, 'x-membership-id': other.id },
  });
  expect(read.statusCode).toBe(409);
});

it('keeps same-month player dues and visibility separate across memberships', async () => {
  const owner = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Third',
        email: 'third@example.test',
        role: 'MANAGER',
        passwordHash: await argon2.hash(password),
        active: true,
        isVerified: true,
      },
    }),
  );
  const token = await invitation(owner, 'PLAYER');
  const session = await backend.services.auth.createSession(coach);
  const accepted = await request('POST', '/auth/invitations/accept', { token }, session);
  expect(accepted.statusCode).toBe(200);
  const member = accepted.json().user;
  const currentDues = await fixture.db.monthlyDues.create({
    data: { teamId: owner.teamId!, playerId: member.id, month: localMonth() },
  });
  const rows = await fixture.db.monthlyDues.findMany({
    where: { player: { accountId: coach.accountId }, month: localMonth() },
  });
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.teamId)).size).toBe(2);
  const result = await request('GET', '/me/dues', undefined, sessionOf(accepted));
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().items.map((row: { id: string }) => row.id)).toContain(currentDues.id);
  expect(result.json().items.every((row: { playerId: string }) => row.playerId === member.id)).toBe(
    true,
  );
});
