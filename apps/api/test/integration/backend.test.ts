import { seedTeam, bankProviders } from '../fixtures/team.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import argon2 from 'argon2';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { localMonth, randomToken } from '../../src/plugins/core.js';
import type { Providers, VerifiedCharge } from '../../src/infrastructure/providers.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import { testDatabase } from '../fixtures/database.js';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/pitchpresence',
  SESSION_SECRET: 'test-session-secret-000000000000000000',
  QR_SIGNING_SECRET: 'test-qr-secret-00000000000000000000000',
  PAYMENT_MODE: 'PAYSTACK',
  PAYSTACK_SECRET_KEY: 'sk_test_placeholder',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let manager: import('@pitchpresence/database').User,
  player: import('@pitchpresence/database').User,
  other: import('@pitchpresence/database').User;
let managerSession: Awaited<ReturnType<typeof backend.services.auth.createSession>>,
  playerSession: typeof managerSession;
const charges = new Map<string, VerifiedCharge>();
const emails: { email: string; otp: string }[] = [];
const providers: Providers = {
  ...bankProviders,
  sendOtp: async (email, otp) => {
    emails.push({ email, otp });
  },
  initialize: async (input) => {
    charges.set(input.reference, { ...input, currency: 'NGN', status: 'pending', paidAt: null });
    return `https://checkout.paystack.com/${input.reference}`;
  },
  verify: async (reference) => {
    const charge = charges.get(reference);
    if (!charge) throw new Error('Unknown reference');
    return charge;
  },
};
function request(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  session = managerSession,
  headers: Record<string, string> = {},
) {
  return backend.app.inject({
    method,
    url,
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    headers: {
      'content-type': 'application/json',
      origin: config.APP_URL,
      ...(session
        ? { cookie: `pitchpresence=${session.token}`, 'x-csrf-token': session.csrfToken }
        : {}),
      ...headers,
    },
  });
}
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  await backend.app.ready();
  const pinHash = await argon2.hash('1234');
  manager = await fixture.db.user.create({
    data: {
      email: `manager-${randomUUID()}@example.com`,
      name: 'Manager',
      role: 'MANAGER',
      passwordHash: pinHash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
  manager = await seedTeam(fixture.db, manager);
  player = await fixture.db.user.create({
    data: {
      email: `player-${randomUUID()}@example.com`,
      teamId: manager.teamId!,
      name: 'Player',
      pinHash,
      isVerified: true,
      active: true,
      activatedAt: new Date('2026-01-15T10:00:00Z'),
    },
  });
  other = await fixture.db.user.create({
    data: {
      email: `other-${randomUUID()}@example.com`,
      teamId: manager.teamId!,
      name: 'Other',
      pinHash,
      isVerified: true,
      active: true,
      activatedAt: new Date('2026-01-15T10:00:00Z'),
    },
  });
  managerSession = await backend.services.auth.createSession(manager);
  playerSession = await backend.services.auth.createSession(player);
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
describe('HTTP security and identity', () => {
  it('exposes health and generated API documentation', async () => {
    expect((await request('GET', '/api/v1/health/ready')).statusCode).toBe(200);
    expect((await request('GET', '/api/v1/openapi.json')).json().openapi).toBe('3.0.3');
  });
  it('rejects manager actions by a player', async () => {
    expect(
      (await request('POST', '/api/v1/management/invitations', {}, playerSession)).statusCode,
    ).toBe(403);
  });
  it('rejects foreign origins and missing CSRF', async () => {
    expect(
      (
        await request('POST', '/api/v1/management/invitations', {}, managerSession, {
          origin: 'https://evil.example',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await request('POST', '/api/v1/management/invitations', {}, managerSession, {
          'x-csrf-token': '',
        })
      ).statusCode,
    ).toBe(403);
  });
  it('registers through a reusable invite, verifies OTP, and creates a device session', async () => {
    const invited = await request('POST', '/api/v1/management/invitations', {});
    expect(invited.statusCode).toBe(200);
    const token = new URL(invited.json().registrationUrl).searchParams.get('invite');
    const email = `new-${randomUUID()}@example.com`;
    const response = await backend.app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: config.APP_URL },
      payload: { name: 'New Player', email, pin: '4567', invitationToken: token },
    });
    expect(response.statusCode).toBe(200);
    const runner = new JobRunner(fixture.db, config, providers, backend.services.payments);
    await runner.tick();
    const sent = emails.find((e) => e.email === email);
    expect(sent).toBeDefined();
    const verified = await backend.app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      headers: { origin: config.APP_URL },
      payload: { email, otp: sent!.otp },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.headers['set-cookie']).toContain('HttpOnly');
    expect(verified.json().user.active).toBe(true);
    expect(verified.json()).not.toHaveProperty('token');
  });
  it('never allows a requested role in registration', async () => {
    const response = await request('POST', '/api/v1/auth/register', {
      name: 'Wrong',
      email: 'wrong@example.com',
      pin: '1234',
      invitationToken: randomToken(),
      role: 'MANAGER',
    });
    expect(response.statusCode).toBe(422);
  });
  it('persists failed OTP attempts rather than rolling them back', async () => {
    await backend.services.auth.issueOtp(other.email, 'PIN_RESET');
    for (let i = 0; i < 5; i++)
      await expect(
        backend.services.auth.consumeOtp(other.email, 'not-a-real-code', 'PIN_RESET', '9999'),
      ).rejects.toThrow();
    const token = await fixture.db.verificationToken.findFirst({
      where: { userId: other.id, purpose: 'PIN_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(token!.attempts).toBe(5);
  });
  it('deactivation revokes remembered devices', async () => {
    const session = await backend.services.auth.createSession(other);
    expect(
      (await request('PATCH', `/api/v1/management/players/${other.id}`, { active: false }))
        .statusCode,
    ).toBe(200);
    expect(await backend.services.auth.resolve(session.token)).toBeNull();
    await request('PATCH', `/api/v1/management/players/${other.id}`, { active: true });
  });
});
describe('attendance lifecycle', () => {
  let sessionId: string, token: string;
  it('requires fresh accurate location', async () => {
    const r = await request('POST', '/api/v1/training-sessions', {
      name: 'Training',
      latitude: 6.5,
      longitude: 3.4,
      locationAccuracy: 500,
      locationCapturedAt: new Date().toISOString(),
    });
    expect(r.statusCode).toBe(422);
    const stale = await request('POST', '/api/v1/training-sessions', {
      name: 'Training',
      latitude: 6.5,
      longitude: 3.4,
      locationAccuracy: 20,
      locationCapturedAt: new Date(Date.now() - 180000).toISOString(),
    });
    expect(stale.statusCode).toBe(422);
  });
  it('opens a session and snapshots the active roster', async () => {
    const response = await request('POST', '/api/v1/training-sessions', {
      name: 'Morning training',
      latitude: 6.5,
      longitude: 3.4,
      locationAccuracy: 20,
      locationCapturedAt: new Date().toISOString(),
    });
    expect(response.statusCode).toBe(200);
    sessionId = response.json().id;
    const result = await request('POST', `/api/v1/training-sessions/${sessionId}/qr-token`, {});
    expect(result.statusCode).toBe(200);
    token = result.json().token;
    const claims = decodeJwt(token);
    expect(claims.exp! - claims.iat!).toBe(30);
    expect(result.json().expiresAt).toBe(new Date(claims.exp! * 1000).toISOString());
    expect(result.json().refreshAfterSeconds).toBe(10);
  });
  it('accepts a check-in delayed by 25 seconds and is idempotent', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 25;
    const delayedToken = await new SignJWT(decodeJwt(token))
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 30)
      .sign(new TextEncoder().encode(config.QR_SIGNING_SECRET));
    const first = await request(
      'POST',
      '/api/v1/attendance/check-in',
      { token: delayedToken },
      playerSession,
    );
    expect(first.statusCode).toBe(200);
    expect(first.json().attendance.method).toBe('QR');
    const second = await request('POST', '/api/v1/attendance/check-in', { token }, playerSession);
    expect(second.json().alreadyRecorded).toBe(true);
    expect(second.json().attendance.id).toBe(first.json().attendance.id);
  });
  it('rejects tampered tokens', async () => {
    expect(
      (
        await request(
          'POST',
          '/api/v1/attendance/check-in',
          { token: token.slice(0, -10) + 'tampering0' },
          playerSession,
        )
      ).statusCode,
    ).toBe(422);
  });
  it('records manual exceptions with the manager identity', async () => {
    const response = await request(
      'POST',
      `/api/v1/training-sessions/${sessionId}/attendance/manual`,
      { playerId: other.id },
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().attendance.recordedBy).toBe(manager.id);
    expect(response.json().attendance.method).toBe('MANUAL');
  });
  it('closure blocks a cryptographically valid token and repeated close is safe', async () => {
    const fresh = await request('POST', `/api/v1/training-sessions/${sessionId}/qr-token`, {});
    await request('POST', `/api/v1/training-sessions/${sessionId}/close`, {});
    expect(
      (
        await request(
          'POST',
          '/api/v1/attendance/check-in',
          { token: fresh.json().token },
          playerSession,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await request('POST', `/api/v1/training-sessions/${sessionId}/close`, {})).statusCode,
    ).toBe(200);
  });
  it('derives absence from the snapshot after closure', async () => {
    const response = await request('GET', `/api/v1/training-sessions/${sessionId}/attendance`);
    expect(response.json().players.some((p: { result: string }) => p.result === 'ABSENT')).toBe(
      true,
    );
    expect(response.json().checkedInCount).toBe(2);
  });
});
describe('dues and verified payments', () => {
  let duesId: string, externalPaymentId: string, paymentId: string, reference: string;
  const month = localMonth();
  it('shows unconfigured unpaid records with payment unavailable', async () => {
    const response = await request('GET', '/api/v1/me/dues', undefined, playerSession);
    expect(response.statusCode).toBe(200);
    const current = response.json().items.find((d: { month: string }) => d.month === month);
    duesId = current.id;
    expect(current.status).toBe('NOT_PAID');
    expect(current.paymentAvailable).toBe(false);
  });
  it('configures the monthly minimum and rejects smaller payments', async () => {
    expect(
      (await request('PUT', `/api/v1/management/dues-periods/${month}`, { minimumAmount: 10000 }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await request(
          'POST',
          '/api/v1/payments/paystack/initialize',
          { month, amount: 9999 },
          playerSession,
          { 'idempotency-key': 'below-minimum' },
        )
      ).statusCode,
    ).toBe(422);
  });
  it('confirms external payment and freezes the configured minimum', async () => {
    const response = await request('POST', `/api/v1/dues/${duesId}/mark-paid`, { amount: 10000 });
    expect(response.statusCode).toBe(200);
    externalPaymentId = response.json().payment.id;
    expect(response.json().dues.status).toBe('PAID');
    expect(
      (await request('PUT', `/api/v1/management/dues-periods/${month}`, { minimumAmount: 20000 }))
        .statusCode,
    ).toBe(409);
  });
  it('reverses the manual confirmation with a permanent audit trail', async () => {
    const response = await request('POST', `/api/v1/dues/${duesId}/reverse-manual-payment`, {
      paymentId: externalPaymentId,
      reason: 'Confirmed the wrong player',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('NOT_PAID');
    expect(
      (await fixture.db.payment.findUniqueOrThrow({ where: { id: externalPaymentId } })).reversedBy,
    ).toBe(manager.id);
  });
  it('initializes a checkout once and reuses it on idempotent replay', async () => {
    const first = await request(
      'POST',
      '/api/v1/payments/paystack/initialize',
      { month, amount: 15000 },
      playerSession,
      { 'idempotency-key': 'payment-once' },
    );
    expect(first.statusCode).toBe(200);
    paymentId = first.json().id;
    reference = first.json().providerReference;
    const replay = await request(
      'POST',
      '/api/v1/payments/paystack/initialize',
      { month, amount: 15000 },
      playerSession,
      { 'idempotency-key': 'payment-once' },
    );
    expect(replay.json().id).toBe(paymentId);
    expect((await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } })).status).toBe(
      'NOT_PAID',
    );
  });
  it('rejects reuse of a key with different input and cross-player payment reads', async () => {
    expect(
      (
        await request(
          'POST',
          '/api/v1/payments/paystack/initialize',
          { month, amount: 16000 },
          playerSession,
          { 'idempotency-key': 'payment-once' },
        )
      ).statusCode,
    ).toBe(409);
    const otherSession = await backend.services.auth.createSession(other);
    expect(
      (await request('GET', `/api/v1/payments/${paymentId}`, undefined, otherSession)).statusCode,
    ).toBe(404);
  });
  it('rejects forged webhooks and accepts duplicate signed events durably', async () => {
    const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
    const bad = await backend.app.inject({
      method: 'POST',
      url: '/api/v1/payments/paystack/webhook',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': 'bad' },
      payload: raw,
    });
    expect(bad.statusCode).toBe(401);
    const sig = createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
    for (let i = 0; i < 2; i++)
      expect(
        (
          await backend.app.inject({
            method: 'POST',
            url: '/api/v1/payments/paystack/webhook',
            headers: { 'content-type': 'application/json', 'x-paystack-signature': sig },
            payload: raw,
          })
        ).statusCode,
      ).toBe(200);
    expect(
      await fixture.db.backgroundJob.count({ where: { deduplicationKey: `webhook:${paymentId}` } }),
    ).toBe(1);
  });
  it('refuses provider detail mismatches', async () => {
    const charge = charges.get(reference)!;
    charges.set(reference, { ...charge, status: 'success', amount: charge.amount + 1 });
    await expect(backend.services.payments.verify(paymentId)).rejects.toThrow('review');
    expect((await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } })).status).toBe(
      'NOT_PAID',
    );
    charges.set(reference, { ...charge, status: 'success' });
  });
  it('retains a manual confirmation made while checkout is pending', async () => {
    const result = await request('POST', `/api/v1/dues/${duesId}/mark-paid`, { amount: 15000 });
    expect(result.statusCode).toBe(200);
    externalPaymentId = result.json().payment.id;
  });
  it('settles only after verification and does not duplicate successful payment', async () => {
    const response = await request(
      'POST',
      `/api/v1/payments/${paymentId}/verify`,
      {},
      playerSession,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('SUCCESS');
    await backend.services.payments.verify(paymentId);
    const dues = await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } });
    expect(dues.status).toBe('PAID');
    expect(dues.qualifyingPaymentId).toBe(externalPaymentId);
    expect(
      (await fixture.db.payment.findUniqueOrThrow({ where: { id: paymentId } })).needsReview,
    ).toBe(true);
    expect(await fixture.db.payment.count({ where: { providerReference: reference } })).toBe(1);
  });
  it('keeps the month paid when the manual confirmation is reversed after Paystack success', async () => {
    const response = await request('POST', `/api/v1/dues/${duesId}/reverse-manual-payment`, {
      paymentId: externalPaymentId,
      reason: 'External confirmation was duplicated',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('PAID');
    expect(response.json().qualifyingPaymentId).toBe(paymentId);
  });
  it('preserves previous months as current dues are settled', async () => {
    const old = await fixture.db.monthlyDues.findUniqueOrThrow({
      where: { playerId_month: { playerId: player.id, month: '2026-01' } },
    });
    expect(old.status).toBe('NOT_PAID');
  });
});
