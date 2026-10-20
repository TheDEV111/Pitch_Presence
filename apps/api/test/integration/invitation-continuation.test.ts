import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { User } from '@pitchpresence/database';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { digest } from '../../src/plugins/core.js';
import { encrypt } from '../../src/infrastructure/secrets.js';
import { testDatabase } from '../fixtures/database.js';
import { bankProviders, seedTeam } from '../fixtures/team.js';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'continuation-session-secret-000000000000',
  DATA_ENCRYPTION_SECRET: 'continuation-data-secret-00000000000000',
  QR_SIGNING_SECRET: 'continuation-qr-secret-0000000000000000',
  MULTI_TEAM_ENABLED: 'true',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let coach: User;
let token: string;
function request(method: 'GET' | 'POST', path: string, cookie = '', body?: unknown, csrf?: string) {
  return backend.app.inject({
    method,
    url: `/api/v1${path}`,
    headers: {
      origin: config.APP_URL,
      'content-type': 'application/json',
      cookie,
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}
function cookies(response: Awaited<ReturnType<typeof request>>) {
  const header = response.headers['set-cookie'];
  return (Array.isArray(header) ? header : header ? [header] : [])
    .map((value) => value.split(';')[0])
    .join('; ');
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
  coach = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Coach',
        email: 'coach-continuation@example.test',
        role: 'MANAGER',
        passwordHash: await argon2.hash('CoachPass123!'),
        isVerified: true,
        active: true,
      },
    }),
  );
});
beforeEach(async () => {
  await fixture.db.rateLimitBucket.deleteMany();
  token = `${randomUUID()}-${randomUUID()}`;
  await fixture.db.invitation.create({
    data: {
      teamId: coach.teamId!,
      createdBy: coach.id,
      kind: 'PLAYER',
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
it('resumes after refresh and registers using only an opaque reference plus the protected cookie', async () => {
  const preview = await request('GET', `/invitations/preview?token=${token}`);
  expect(preview.statusCode).toBe(200);
  expect(preview.body).not.toContain(token);
  expect(cookies(preview)).not.toContain(token);
  expect(preview.headers['set-cookie']).toContain('HttpOnly');
  expect(preview.headers['set-cookie']).toContain('Path=/api/v1');
  expect(preview.headers['set-cookie']).toContain('SameSite=Lax');
  const id = preview.json().contextId;
  const resume = await request('GET', `/invitations/resume?context=${id}`, cookies(preview));
  expect(resume.statusCode, resume.body).toBe(200);
  expect(resume.json().teamId).toBe(coach.teamId);
  expect(resume.body).not.toContain(token);
  const email = `${randomUUID()}@example.test`;
  const registered = await request('POST', '/auth/register', cookies(preview), {
    name: 'Player',
    email,
    pin: '2468',
    invitationContextId: id,
  });
  expect(registered.statusCode, registered.body).toBe(200);
  expect((await fixture.db.user.findFirstOrThrow({ where: { email } })).teamId).toBe(coach.teamId);
});
it('rejects missing, copied, expired, or tampered continuations and rechecks revoked invitations', async () => {
  const preview = await request('GET', `/invitations/preview?token=${token}`);
  const id = preview.json().contextId;
  expect((await request('GET', `/invitations/resume?context=${id}`)).json().error.code).toBe(
    'INVITATION_CONTEXT_EXPIRED',
  );
  expect(
    (await request('GET', `/invitations/resume?context=${randomUUID()}`, cookies(preview)))
      .statusCode,
  ).toBe(422);
  expect(
    (await request('GET', `/invitations/resume?context=${id}`, cookies(preview) + 'tamper'))
      .statusCode,
  ).toBe(422);
  const expired = encrypt(
    `${config.DATA_ENCRYPTION_SECRET}:invitation-continuation:v1`,
    JSON.stringify({ id, token, expiresAt: Date.now() - 1 }),
  );
  expect(
    (
      await request(
        'GET',
        `/invitations/resume?context=${id}`,
        `pp-join-${id}=${encodeURIComponent(expired)}`,
      )
    ).statusCode,
  ).toBe(422);
  expect(
    (
      await request('POST', '/auth/register', '', {
        name: 'Player',
        email: `${randomUUID()}@example.test`,
        pin: '2468',
        invitationContextId: id,
      })
    ).statusCode,
  ).toBe(422);
  await fixture.db.invitation.update({
    where: { tokenHash: digest(token) },
    data: { revokedAt: new Date() },
  });
  expect(
    (await request('GET', `/invitations/resume?context=${id}`, cookies(preview))).json().error.code,
  ).toBe('INVITATION_INVALID');
  expect(
    (
      await request('POST', '/auth/register', cookies(preview), {
        name: 'Player',
        email: `${randomUUID()}@example.test`,
        pin: '2468',
        invitationContextId: id,
      })
    ).json().error.code,
  ).toBe('INVITATION_INVALID');
});
it('preserves separate invitation contexts and permits authenticated acceptance after refresh', async () => {
  const first = await request('GET', `/invitations/preview?token=${token}`);
  const second = await request('GET', `/invitations/preview?token=${token}`, cookies(first));
  expect(first.json().contextId).not.toBe(second.json().contextId);
  const jar = `${cookies(first)}; ${cookies(second)}`;
  expect(
    (await request('GET', `/invitations/resume?context=${first.json().contextId}`, jar)).statusCode,
  ).toBe(200);
  expect(
    (await request('GET', `/invitations/resume?context=${second.json().contextId}`, jar))
      .statusCode,
  ).toBe(200);
  const other = await seedTeam(
    fixture.db,
    await fixture.db.user.create({
      data: {
        name: 'Other coach',
        email: `${randomUUID()}@example.test`,
        role: 'MANAGER',
        passwordHash: coach.passwordHash,
        active: true,
        isVerified: true,
      },
    }),
  );
  const member = await fixture.db.user.create({
    data: {
      name: 'Existing',
      email: `${randomUUID()}@example.test`,
      pinHash: await argon2.hash('2468'),
      teamId: other.teamId,
      active: true,
      isVerified: true,
    },
  });
  const session = await backend.services.auth.createSession(member);
  const accepted = await request(
    'POST',
    '/auth/invitations/accept',
    `${jar}; pitchpresence=${session.token}`,
    { invitationContextId: first.json().contextId },
    session.csrfToken,
  );
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(accepted.json().user.teamId).toBe(coach.teamId);
});
it('supports email-bound staff registration and preserves invitation kind checks', async () => {
  const email = `${randomUUID()}@example.test`;
  await fixture.db.invitation.update({
    where: { tokenHash: digest(token) },
    data: { kind: 'MANAGER', email },
  });
  const preview = await request('GET', `/invitations/preview?token=${token}`);
  const reference = { invitationContextId: preview.json().contextId };
  expect(
    (
      await request('POST', '/auth/register', cookies(preview), {
        name: 'Player',
        email,
        pin: '2468',
        ...reference,
      })
    ).statusCode,
  ).toBe(422);
  const registered = await request('POST', '/auth/staff-register', cookies(preview), {
    name: 'Staff',
    email,
    password: 'CoachPass123!',
    ...reference,
  });
  expect(registered.statusCode, registered.body).toBe(200);
  expect(
    (await fixture.db.user.findFirstOrThrow({ where: { email } })).pendingInvitationId,
  ).not.toBeNull();
});
