import { beforeAll, beforeEach, afterAll, it, expect, describe } from 'vitest';
import argon2 from 'argon2';
import { randomUUID, createHmac } from 'node:crypto';
import type { User } from '@pitchpresence/database';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { localMonth, digest } from '../../src/plugins/core.js';
import { decrypt } from '../../src/infrastructure/secrets.js';
import type { Providers, Subaccount, VerifiedCharge } from '../../src/infrastructure/providers.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import { seedTeam, bankProviders } from '../fixtures/team.js';
import { testDatabase } from '../fixtures/database.js';
const password = 'a memorable staff passphrase';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'tenant-session-secret-0000000000000000000',
  QR_SIGNING_SECRET: 'tenant-qr-secret-000000000000000000000000',
  PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>,
  backend: Awaited<ReturnType<typeof buildApp>>;
let a: User, b: User, pa: User, pb: User;
type Session = Awaited<ReturnType<typeof backend.services.auth.createSession>>;
let sa: Session, sb: Session, spa: Session, spb: Session;
let hash: string;
const charges = new Map<string, VerifiedCharge>();
const subaccounts = new Map<string, Subaccount>();
let createCalls = 0,
  bankTimeout = false,
  bankInactive = false;
const providers: Providers = {
  ...bankProviders,
  sendOtp: async () => {},
  createSubaccount: async (input) => {
    createCalls++;
    const result = {
      code: `ACCT_${input.profileId}`,
      active: !bankInactive,
      profileId: input.profileId,
      accountName: 'TEST TEAM',
      accountLast4: input.accountNumber.slice(-4),
      bankCode: input.bankCode,
    };
    subaccounts.set(input.profileId, result);
    if (bankTimeout) throw new Error('Unknown outcome');
    return result;
  },
  findSubaccount: async (id) => subaccounts.get(id) ?? null,
  initialize: async (input) => {
    charges.set(input.reference, { ...input, status: 'pending', currency: 'NGN', paidAt: null });
    return `https://checkout.paystack.com/${input.reference}`;
  },
  verify: async (reference) => charges.get(reference)!,
};
function request(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  session?: Session,
) {
  return backend.app.inject({
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
}
async function createStaff(email = `${randomUUID()}@test.com`) {
  return fixture.db.user.create({
    data: {
      name: 'Coach',
      email,
      role: 'MANAGER',
      passwordHash: hash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
}
async function otp(email: string, purpose = 'VERIFY_EMAIL') {
  const user = await fixture.db.user.findUniqueOrThrow({ where: { email } });
  const job = await fixture.db.backgroundJob.findFirstOrThrow({
    where: { kind: 'EMAIL_OTP', deduplicationKey: { startsWith: 'otp:' } },
    orderBy: { createdAt: 'desc' },
  });
  const payload = job.payload as { userId: string; purpose: string; encryptedOtp: string };
  expect(payload.userId).toBe(user.id);
  expect(payload.purpose).toBe(purpose);
  return decrypt(config.SESSION_SECRET, payload.encryptedOtp);
}
const trainingInput = () => ({
  name: 'Team training',
  latitude: 6,
  longitude: 3,
  locationAccuracy: 20,
  locationCapturedAt: new Date().toISOString(),
});
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  await backend.app.ready();
  hash = await argon2.hash(password);
  a = await seedTeam(fixture.db, await createStaff(), false);
  b = await seedTeam(fixture.db, await createStaff(), false);
  const pinHash = await argon2.hash('1234');
  pa = await fixture.db.user.create({
    data: {
      teamId: a.teamId,
      email: `${randomUUID()}@test.com`,
      name: 'A Player',
      pinHash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
  pb = await fixture.db.user.create({
    data: {
      teamId: b.teamId,
      email: `${randomUUID()}@test.com`,
      name: 'B Player',
      pinHash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
  sa = await backend.services.auth.createSession(a);
  sb = await backend.services.auth.createSession(b);
  spa = await backend.services.auth.createSession(pa);
  spb = await backend.services.auth.createSession(pb);
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
describe('staff onboarding and recovery', () => {
  let email: string, user: User, session: Session;
  it('rejects short passwords and user-supplied roles or team IDs', async () => {
    expect(
      (
        await request('POST', '/auth/staff-register', {
          name: 'Coach',
          email: 'short@test.com',
          password: '1234',
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await request('POST', '/auth/staff-register', {
          name: 'Coach',
          email: 'role@test.com',
          password,
          role: 'PLAYER',
          teamId: a.teamId,
        })
      ).statusCode,
    ).toBe(422);
  });
  it('creates staff without a PIN or team and blocks access until email verification', async () => {
    email = `${randomUUID()}@test.com`;
    expect(
      (await request('POST', '/auth/staff-register', { name: 'New coach', email, password }))
        .statusCode,
    ).toBe(200);
    user = await fixture.db.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe('MANAGER');
    expect(user.teamId).toBeNull();
    expect(user.pinHash).toBeNull();
    expect(user.isVerified).toBe(false);
    const login = await request('POST', '/auth/staff-login', { email, password });
    expect(login.statusCode).toBe(403);
    expect(login.json().error.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(
      (await request('POST', '/auth/staff-login', { email, password: 'wrong' })).statusCode,
    ).toBe(401);
    const response = await request('POST', '/auth/verify-email', { email, otp: await otp(email) });
    expect(response.statusCode).toBe(200);
    expect(response.json().nextStep).toBe('CREATE_TEAM');
    expect(response.json().team).toBeNull();
    user = await fixture.db.user.findUniqueOrThrow({ where: { email } });
    session = await backend.services.auth.createSession(user);
  });
  it('resumes team onboarding on another device and gates operational routes', async () => {
    expect((await request('POST', '/auth/staff-login', { email, password })).json().nextStep).toBe(
      'CREATE_TEAM',
    );
    expect((await request('GET', '/management/overview', undefined, session)).statusCode).toBe(403);
    expect((await request('POST', '/teams', { name: 'Resumable FC' }, session)).statusCode).toBe(
      200,
    );
    const me = (await request('GET', '/auth/me', undefined, session)).json();
    expect(me.nextStep).toBe('READY');
    expect(me.team.name).toBe('Resumable FC');
    expect((await request('POST', '/teams', { name: 'Second team' }, session)).json().id).toBe(
      me.team.id,
    );
    const overview = (await request('GET', '/management/overview', undefined, session)).json();
    expect(overview.setup).toEqual({
      hasPlayers: false,
      duesConfigured: false,
      paymentsReady: false,
    });
  });
  it('allows each credential type only at its intended sign-in', async () => {
    expect(
      (await request('POST', '/auth/device-login', { email: a.email, pin: '1234' })).statusCode,
    ).toBe(401);
    expect(
      (await request('POST', '/auth/staff-login', { email: pa.email, password: '1234' }))
        .statusCode,
    ).toBe(401);
    expect(
      (await request('POST', '/auth/staff-login', { email: a.email, password })).statusCode,
    ).toBe(200);
    expect(
      (await request('POST', '/auth/device-login', { email: pa.email, pin: '1234' })).statusCode,
    ).toBe(200);
  });
  it('resets staff password with a purpose-bound OTP and revokes all devices', async () => {
    await fixture.db.rateLimitBucket.deleteMany({
      where: { key: { startsWith: 'otp-cooldown:' } },
    });
    await request('POST', '/auth/password-reset/request', { email });
    const code = await otp(email, 'PASSWORD_RESET');
    expect(
      (await request('POST', '/auth/pin-reset/confirm', { email, otp: code, pin: '9876' }))
        .statusCode,
    ).toBe(422);
    const response = await request('POST', '/auth/password-reset/confirm', {
      email,
      otp: code,
      password: 'a different memorable passphrase',
    });
    expect(response.statusCode).toBe(200);
    expect((await request('GET', '/auth/me', undefined, session)).statusCode).toBe(401);
    expect(
      (
        await request('POST', '/auth/staff-login', {
          email,
          password: 'a different memorable passphrase',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await request('POST', '/auth/password-reset/confirm', { email, otp: code, password }))
        .statusCode,
    ).toBe(422);
  });
});
describe('interrupted staff signup', () => {
  beforeEach(async () => {
    await fixture.db.rateLimitBucket.deleteMany({ where: { key: 'register:127.0.0.1' } });
  });
  it('retries a lost signup response without replacing the password, name, invitation or code', async () => {
    const email = `${randomUUID()}@test.com`;
    const invite = (await request('POST', '/management/staff-invitations', { email }, sa)).json();
    const input = {
      name: 'Original coach',
      email,
      password,
      invitationToken: new URL(invite.registrationUrl).searchParams.get('invite')!,
    };
    expect((await request('POST', '/auth/staff-register', input)).statusCode).toBe(200);
    const before = await fixture.db.user.findUniqueOrThrow({ where: { email } });
    const code = await otp(email);
    const response = await request('POST', '/auth/staff-register', {
      name: 'Changed name',
      email,
      password,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().resendAfterSeconds).toBeGreaterThan(0);
    expect(await fixture.db.user.findUniqueOrThrow({ where: { email } })).toEqual(before);
    expect(await fixture.db.verificationToken.count({ where: { userId: before.id } })).toBe(1);
    expect(
      await fixture.db.backgroundJob.count({
        where: { payload: { path: ['userId'], equals: before.id } },
      }),
    ).toBe(1);
    expect(
      (await request('POST', '/auth/verify-email', { email, otp: code })).json().nextStep,
    ).toBe('ACCEPT_INVITATION');
  });
  it('rejects changed passwords, verified accounts and player credentials without modifying them', async () => {
    const email = `${randomUUID()}@test.com`;
    await request('POST', '/auth/staff-register', { name: 'Coach', email, password });
    const before = await fixture.db.user.findUniqueOrThrow({ where: { email } });
    for (const input of [
      { email, password: 'a different secret passphrase' },
      { email: a.email, password },
      { email: pa.email, password },
    ]) {
      const response = await request('POST', '/auth/staff-register', {
        name: 'Replacement',
        ...input,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('ACCOUNT_EXISTS');
    }
    expect(await fixture.db.user.findUniqueOrThrow({ where: { email } })).toEqual(before);
  });
  it('replaces an expired code on signup retry and rejects the old challenge', async () => {
    const email = `${randomUUID()}@test.com`;
    const input = { name: 'Returning coach', email, password };
    await request('POST', '/auth/staff-register', input);
    const user = await fixture.db.user.findUniqueOrThrow({ where: { email } });
    const challenge = await fixture.db.verificationToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    await fixture.db.verificationToken.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await fixture.db.rateLimitBucket.deleteMany({ where: { key: { contains: 'otp-cooldown:' } } });
    expect((await request('POST', '/auth/staff-register', input)).statusCode).toBe(200);
    expect(
      (await fixture.db.verificationToken.findUniqueOrThrow({ where: { id: challenge.id } }))
        .consumedAt,
    ).not.toBeNull();
    expect(await fixture.db.user.count({ where: { email } })).toBe(1);
    expect(
      (await request('POST', '/auth/verify-email', { email, otp: await otp(email) })).statusCode,
    ).toBe(200);
  });
  it('recovers a legacy account whose registration never queued its verification email', async () => {
    const user = await fixture.db.user.create({
      data: {
        name: 'Legacy coach',
        email: `${randomUUID()}@test.com`,
        role: 'MANAGER',
        passwordHash: hash,
      },
    });
    expect(
      (
        await request('POST', '/auth/staff-register', {
          name: 'Replacement',
          email: user.email,
          password,
        })
      ).statusCode,
    ).toBe(200);
    expect((await fixture.db.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(
      'Legacy coach',
    );
    expect(
      (
        await request('POST', '/auth/verify-email', {
          email: user.email,
          otp: await otp(user.email),
        })
      ).statusCode,
    ).toBe(200);
  });
  it('rolls back the account and code if the durable email job cannot be saved', async () => {
    const email = `${randomUUID()}@test.com`;
    await fixture.db.$executeRawUnsafe(
      `CREATE FUNCTION test_reject_email_job() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated queue failure'; END; $$ LANGUAGE plpgsql`,
    );
    await fixture.db.$executeRawUnsafe(
      `CREATE TRIGGER test_reject_email_job BEFORE INSERT ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION test_reject_email_job()`,
    );
    try {
      const response = await request('POST', '/auth/staff-register', {
        name: 'Coach',
        email,
        password,
      });
      expect(response.statusCode).toBe(500);
      expect(await fixture.db.user.findUnique({ where: { email } })).toBeNull();
      expect(
        await fixture.db.backgroundJob.count({
          where: { payload: { path: ['email'], equals: email } },
        }),
      ).toBe(0);
    } finally {
      await fixture.db.$executeRawUnsafe(`DROP TRIGGER test_reject_email_job ON "BackgroundJob"`);
      await fixture.db.$executeRawUnsafe(`DROP FUNCTION test_reject_email_job()`);
    }
    expect(
      (await request('POST', '/auth/staff-register', { name: 'Coach', email, password }))
        .statusCode,
    ).toBe(200);
  });
});
describe('email-bound staff invitations', () => {
  let invite: { id: string; registrationUrl: string },
    token: string,
    email: string,
    invitedSession: Session;
  it('queues an invitation without storing the raw link and identifies its team', async () => {
    email = `${randomUUID()}@test.com`;
    invite = (await request('POST', '/management/staff-invitations', { email }, sa)).json();
    token = new URL(invite.registrationUrl).searchParams.get('invite')!;
    const row = await fixture.db.invitation.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).toBe(digest(token));
    expect(row.kind).toBe('MANAGER');
    expect((await request('GET', `/invitations/preview?token=${token}`)).json().teamName).toBe(
      'Test Team',
    );
    const job = await fixture.db.backgroundJob.findUniqueOrThrow({
      where: { deduplicationKey: `invitation:${invite.id}` },
    });
    expect(JSON.stringify(job.payload)).not.toContain(token);
    expect(job.teamId).toBe(a.teamId);
  });
  it('rejects mismatched email, players, and an account already assigned elsewhere', async () => {
    expect(
      (
        await request('POST', '/auth/staff-register', {
          name: 'Wrong coach',
          email: `${randomUUID()}@test.com`,
          password,
          invitationToken: token,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await request('POST', '/auth/register', {
          name: 'Player',
          email,
          pin: '1234',
          invitationToken: token,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (await request('POST', '/management/staff-invitations', { email: b.email }, sa)).statusCode,
    ).toBe(409);
    expect((await request('POST', '/auth/staff-invitation/accept', { token }, sb)).statusCode).toBe(
      422,
    );
  });
  it('verifies a new staff member, resumes acceptance, and grants shared management access', async () => {
    expect(
      (
        await request('POST', '/auth/staff-register', {
          name: 'Invited coach',
          email,
          password,
          invitationToken: token,
        })
      ).statusCode,
    ).toBe(200);
    const result = await request('POST', '/auth/verify-email', { email, otp: await otp(email) });
    expect(result.json().nextStep).toBe('ACCEPT_INVITATION');
    invitedSession = await backend.services.auth.createSession(
      await fixture.db.user.findUniqueOrThrow({ where: { email } }),
    );
    expect(
      (await request('POST', '/teams', { name: 'Bypass invite' }, invitedSession)).statusCode,
    ).toBe(409);
    expect(
      (await request('POST', '/auth/staff-invitation/accept', {}, invitedSession)).statusCode,
    ).toBe(200);
    expect(
      (await request('GET', '/management/overview', undefined, invitedSession)).json().team.id,
    ).toBe(a.teamId);
    expect(
      (await request('POST', '/auth/staff-invitation/accept', { token }, invitedSession))
        .statusCode,
    ).toBe(200);
    expect((await request('GET', `/invitations/preview?token=${token}`)).statusCode).toBe(422);
  });
  it('supports existing unassigned staff and rejects expired or revoked invitations', async () => {
    const existing = await createStaff();
    const session = await backend.services.auth.createSession(existing);
    for (const expired of [true, false]) {
      const result = (
        await request('POST', '/management/staff-invitations', { email: existing.email }, sa)
      ).json();
      const t = new URL(result.registrationUrl).searchParams.get('invite')!;
      if (expired)
        await fixture.db.invitation.update({
          where: { id: result.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      else await request('DELETE', `/management/invitations/${result.id}`, {}, sa);
      expect(
        (await request('POST', '/auth/staff-invitation/accept', { token: t }, session)).statusCode,
      ).toBe(422);
    }
    const result = (
      await request('POST', '/management/staff-invitations', { email: existing.email }, sa)
    ).json();
    const t = new URL(result.registrationUrl).searchParams.get('invite')!;
    expect(
      (await request('POST', '/auth/staff-invitation/accept', { token: t }, session)).statusCode,
    ).toBe(200);
    expect(
      (await request('GET', '/management/staff', undefined, sa))
        .json()
        .items.some((member: { id: string }) => member.id === existing.id),
    ).toBe(true);
  });
  it('keeps player invitation reusable and tied to the issuing team', async () => {
    const invitation = (await request('POST', '/management/invitations', {}, sb)).json();
    const t = new URL(invitation.registrationUrl).searchParams.get('invite')!;
    for (let i = 0; i < 2; i++) {
      const playerEmail = `${randomUUID()}@test.com`;
      expect(
        (
          await request('POST', '/auth/register', {
            name: 'New player',
            email: playerEmail,
            pin: '1234',
            invitationToken: t,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (await fixture.db.user.findUniqueOrThrow({ where: { email: playerEmail } })).teamId,
      ).toBe(b.teamId);
    }
    expect(
      (await request('DELETE', `/management/invitations/${invitation.id}`, {}, sa)).statusCode,
    ).toBe(404);
  });
});
describe('team isolation and dashboard counts', () => {
  let asession: string, duesId: string;
  it('allows two teams to open training independently and snapshots only their players', async () => {
    const [ar, br] = await Promise.all([
      request('POST', '/training-sessions', trainingInput(), sa),
      request('POST', '/training-sessions', trainingInput(), sb),
    ]);
    expect(ar.statusCode).toBe(200);
    expect(br.statusCode).toBe(200);
    asession = ar.json().id;
    expect(
      (await request('GET', `/training-sessions/${asession}/attendance`, undefined, sa))
        .json()
        .players.map((p: { playerId: string }) => p.playerId),
    ).toEqual([pa.id]);
    expect((await request('POST', '/training-sessions', trainingInput(), sa)).statusCode).toBe(409);
  });
  it('rejects foreign session identifiers, roster changes, and QR tokens', async () => {
    for (const suffix of ['', '/attendance'])
      expect(
        (await request('GET', `/training-sessions/${asession}${suffix}`, undefined, sb)).statusCode,
      ).toBe(404);
    for (const suffix of ['/qr-token', '/close'])
      expect(
        (await request('POST', `/training-sessions/${asession}${suffix}`, {}, sb)).statusCode,
      ).toBe(404);
    const qr = (await request('POST', `/training-sessions/${asession}/qr-token`, {}, sa)).json();
    expect(
      (await request('POST', '/attendance/check-in', { token: qr.token }, spb)).statusCode,
    ).toBe(422);
    expect(
      (
        await request(
          'POST',
          `/training-sessions/${asession}/attendance/manual`,
          { playerId: pb.id },
          sa,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await request('PATCH', `/management/players/${pb.id}`, { name: 'Overwrite' }, sa))
        .statusCode,
    ).toBe(404);
    expect(
      (await request('GET', `/training-sessions?cursor=${asession}`, undefined, sb)).statusCode,
    ).toBe(404);
  });
  it('configures the same month separately and isolates dues mutations', async () => {
    expect(
      (
        await request(
          'PUT',
          `/management/dues-periods/${localMonth()}`,
          { minimumAmount: 10000 },
          sa,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          'PUT',
          `/management/dues-periods/${localMonth()}`,
          { minimumAmount: 20000 },
          sb,
        )
      ).statusCode,
    ).toBe(200);
    duesId = (await request('GET', '/me/dues', undefined, spb)).json().items[0].id;
    expect(
      (await request('POST', `/dues/${duesId}/mark-paid`, { amount: 20000 }, sa)).statusCode,
    ).toBe(404);
    expect(
      (await request('POST', `/dues/${duesId}/mark-paid`, { amount: 20000 }, sb)).statusCode,
    ).toBe(200);
    expect((await request('GET', '/management/overview', undefined, sa)).json().dues).toMatchObject(
      { paid: 0, unpaid: 1, minimumAmount: 10000 },
    );
    expect((await request('GET', '/management/overview', undefined, sb)).json().dues).toMatchObject(
      { paid: 1, unpaid: 0, minimumAmount: 20000 },
    );
  });
  it('filters all management lists, audit, and operation counts by team', async () => {
    expect(
      (await request('GET', '/training-sessions', undefined, sa))
        .json()
        .items.map((s: { id: string }) => s.id),
    ).toEqual([asession]);
    expect(
      (await request('GET', '/management/players', undefined, sa))
        .json()
        .items.map((p: { id: string }) => p.id),
    ).toEqual([pa.id]);
    const audit = (await request('GET', '/management/audit-events', undefined, sa)).json().items;
    expect(audit.every((row: { teamId: string }) => row.teamId === a.teamId)).toBe(true);
    const operations = (await request('GET', '/management/operations', undefined, sa)).json();
    expect(operations.http).toBeUndefined();
    expect(operations.pendingPayments).toBe(0);
  });
  it('rejects foreign collection cursors rather than using them to position a team list', async () => {
    const invitation = (await request('POST', '/management/invitations', {}, sb)).json();
    const event = await fixture.db.auditEvent.findFirstOrThrow({ where: { teamId: b.teamId } });
    for (const path of [
      `/management/players?cursor=${pb.id}`,
      `/management/staff?cursor=${b.id}`,
      `/management/invitations?cursor=${invitation.id}`,
      `/management/staff-invitations?cursor=${invitation.id}`,
      `/management/audit-events?cursor=${event.id}`,
      `/management/dues?cursor=${duesId}`,
    ]) {
      expect((await request('GET', path, undefined, sa)).statusCode).toBe(404);
    }
  });
  it('enforces cross-team links and immutable membership in PostgreSQL', async () => {
    await expect(
      fixture.db.sessionParticipant.create({
        data: { teamId: a.teamId!, sessionId: asession, playerId: pb.id, playerName: 'Foreign' },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.db.monthlyDues.create({
        data: { teamId: a.teamId!, playerId: pb.id, month: '2026-01' },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.db.user.update({ where: { id: pa.id }, data: { teamId: b.teamId } }),
    ).rejects.toThrow();
  });
});
describe('team payment destination and reconciliation', () => {
  let paymentId: string, originalDestination: string;
  const bank = () => ({
    bankCode: '058',
    accountNumber: '0123456789',
    accountName: 'TEST TEAM',
    password,
  });
  it('blocks online dues without a bank while external payments remain available', async () => {
    expect((await backend.services.dues.own(pa)).items[0]!.paymentAvailable).toBe(false);
    await expect(
      backend.services.payments.initialize(
        pa,
        { month: localMonth(), amount: 10000 },
        randomUUID(),
        'test',
      ),
    ).rejects.toThrow('connect its bank');
    expect(
      await fixture.db.payment.count({ where: { teamId: a.teamId!, provider: 'PAYSTACK' } }),
    ).toBe(0);
  });
  it('requires password reauthentication and explicit matching account name', async () => {
    const before = createCalls;
    expect(
      (await request('POST', '/management/bank', { ...bank(), password: 'wrong' }, sa)).statusCode,
    ).toBe(401);
    expect((await request('GET', '/auth/me', undefined, sa)).statusCode).toBe(200);
    expect(
      (await request('POST', '/management/bank', { ...bank(), accountName: 'Someone Else' }, sa))
        .statusCode,
    ).toBe(409);
    expect(createCalls).toBe(before);
    expect(
      (
        await request(
          'POST',
          '/management/bank/resolve',
          { bankCode: '058', accountNumber: '0123456789' },
          spa,
        )
      ).statusCode,
    ).toBe(403);
  });
  it('connects a bank, enables dues, and snapshots the destination at checkout', async () => {
    const result = await request('POST', '/management/bank', bank(), sa);
    expect(result.statusCode).toBe(200);
    expect(result.json().paymentsReady).toBe(true);
    expect(JSON.stringify(result.json())).not.toContain('0123456789');
    expect(JSON.stringify(result.json())).not.toContain('ACCT_');
    expect((await backend.services.dues.own(pa)).items[0]!.paymentAvailable).toBe(true);
    const payment = await backend.services.payments.initialize(
      pa,
      { month: localMonth(), amount: 15000 },
      randomUUID(),
      'test',
    );
    paymentId = payment.id;
    const row = await fixture.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    originalDestination = row.subaccountCode!;
    expect(row.teamId).toBe(a.teamId);
    expect(charges.get(row.providerReference!)!.subaccountCode).toBe(originalDestination);
    expect((await request('GET', `/payments/${paymentId}`, undefined, spb)).statusCode).toBe(404);
  });
  it('replaces the bank without changing existing checkout or immutable profile', async () => {
    const result = await request(
      'POST',
      '/management/bank',
      { ...bank(), accountNumber: '0123459876' },
      sa,
    );
    expect(result.json().paymentsReady).toBe(true);
    const active = await fixture.db.teamPaymentProfile.findUniqueOrThrow({
      where: { id: result.json().paymentProfile.id },
    });
    expect(active.subaccountCode).not.toBe(originalDestination);
    const existing = await fixture.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(existing.subaccountCode).toBe(originalDestination);
    await expect(
      fixture.db.payment.update({
        where: { id: paymentId },
        data: { subaccountCode: active.subaccountCode },
      }),
    ).rejects.toThrow();
    await expect(
      fixture.db.teamPaymentProfile.update({
        where: { id: existing.paymentProfileId! },
        data: { accountLast4: '0000' },
      }),
    ).rejects.toThrow();
  });
  it('rejects settlement to the wrong destination and accepts the original after replacement', async () => {
    const payment = await fixture.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const charge = charges.get(payment.providerReference!)!;
    charges.set(charge.reference, { ...charge, status: 'success', subaccountCode: 'ACCT_wrong' });
    await expect(backend.services.payments.verify(paymentId)).rejects.toThrow('review');
    charges.set(charge.reference, { ...charge, status: 'success' });
    expect((await backend.services.payments.verify(paymentId)).status).toBe('SUCCESS');
    expect((await request('GET', '/management/overview', undefined, sa)).json().dues.paid).toBe(1);
    expect(
      (
        await fixture.db.auditEvent.findFirstOrThrow({
          where: { entityId: paymentId, action: 'PAYMENT_VERIFIED' },
        })
      ).teamId,
    ).toBe(a.teamId);
  });
  it('keeps uncertain bank creation under review and reconciles without another POST', async () => {
    bankTimeout = true;
    const before = createCalls;
    const result = await request('POST', '/management/bank', bank(), sb);
    expect(result.json().latestSetup.status).toBe('REVIEW');
    expect(result.json().paymentsReady).toBe(false);
    expect((await request('POST', '/management/bank', bank(), sb)).statusCode).toBe(409);
    expect(createCalls).toBe(before + 1);
    bankTimeout = false;
    const reconciled = await request('POST', '/management/bank/reconcile', {}, sb);
    expect(reconciled.json().paymentsReady).toBe(true);
    expect(createCalls).toBe(before + 1);
  });
  it('does not enable a provider-inactive replacement', async () => {
    bankInactive = true;
    const result = await request(
      'POST',
      '/management/bank',
      { ...bank(), accountNumber: '9999994321' },
      sb,
    );
    expect(result.json().latestSetup.status).toBe('REVIEW');
    expect(result.json().paymentProfile.accountLast4).toBe('6789');
    bankInactive = false;
  });
  it('rejects a payment job with a foreign team even if its payment ID is valid', async () => {
    await fixture.db.backgroundJob.updateMany({
      where: { completedAt: null },
      data: { availableAt: new Date(Date.now() + 86400000) },
    });
    const job = await fixture.db.backgroundJob.create({
      data: {
        teamId: b.teamId,
        kind: 'VERIFY_PAYMENT',
        deduplicationKey: randomUUID(),
        payload: { paymentId },
        availableAt: new Date(),
      },
    });
    await new JobRunner(fixture.db, config, providers, backend.services.payments).tick();
    const result = await fixture.db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(result.completedAt).toBeNull();
    expect(result.lastError).not.toBeNull();
  });
  it('persists webhook jobs with the original payment team', async () => {
    const payment = await fixture.db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const raw = Buffer.from(
      JSON.stringify({ event: 'charge.success', data: { reference: payment.providerReference } }),
    );
    await backend.services.payments.webhook(
      raw,
      createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(raw).digest('hex'),
    );
    expect(
      (
        await fixture.db.backgroundJob.findUniqueOrThrow({
          where: { deduplicationKey: `webhook:${paymentId}` },
        })
      ).teamId,
    ).toBe(a.teamId);
  });
});
