import { seedTeam, bankProviders } from '../fixtures/team.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import argon2 from 'argon2';
import { testDatabase } from '../fixtures/database.js';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { localMonth, monthRange, rateLimit } from '../../src/plugins/core.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import { decrypt, encrypt } from '../../src/infrastructure/secrets.js';
import type { Providers } from '../../src/infrastructure/providers.js';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'invariants-session-secret-000000000000000',
  QR_SIGNING_SECRET: 'invariants-qr-secret-00000000000000000000',
  LOG_LEVEL: 'silent',
});
let fixture: Awaited<ReturnType<typeof testDatabase>>,
  backend: Awaited<ReturnType<typeof buildApp>>;
let manager: import('@pitchpresence/database').User, player: import('@pitchpresence/database').User;
const providers: Providers = {
  ...bankProviders,
  sendOtp: async () => {},
  initialize: async () => {
    throw new Error('Provider timeout');
  },
  verify: async () => {
    throw new Error('Provider timeout');
  },
};
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  const pinHash = await argon2.hash('2468');
  manager = await fixture.db.user.create({
    data: {
      name: 'Manager',
      email: `manager-${randomUUID()}@test.com`,
      role: 'MANAGER',
      passwordHash: pinHash,
      active: true,
      isVerified: true,
      activatedAt: new Date(),
    },
  });
  manager = await seedTeam(fixture.db, manager);
  player = await fixture.db.user.create({
    data: {
      teamId: manager.teamId!,
      name: 'Eligible',
      email: `player-${randomUUID()}@test.com`,
      pinHash,
      active: true,
      isVerified: true,
      activatedAt: new Date(),
    },
  });
});
afterAll(async () => {
  if (backend) await backend.app.close();
  if (fixture) await fixture.close();
});
describe('time and token boundaries', () => {
  it('uses Lagos midnight and preserves month history', () => {
    expect(localMonth(new Date('2026-10-31T22:59:59Z'))).toBe('2026-10');
    expect(localMonth(new Date('2026-10-31T23:00:00Z'))).toBe('2026-11');
    expect(monthRange('2025-12', '2026-02')).toEqual(['2025-12', '2026-01', '2026-02']);
  });
  it('rejects expired QR and tokens with the wrong audience or lifetime', async () => {
    const key = new TextEncoder().encode(config.QR_SIGNING_SECRET);
    const now = Math.floor(Date.now() / 1000);
    for (const [audience, start, end] of [
      ['attendance', now - 31, now - 1],
      ['other', now, now + 30],
      ['attendance', now, now + 100],
    ] as const) {
      const token = await new SignJWT({ sessionId: randomUUID(), teamId: manager.teamId! })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('pitchpresence')
        .setAudience(audience)
        .setIssuedAt(start)
        .setExpirationTime(end)
        .setJti(randomUUID())
        .sign(key);
      await expect(
        backend.services.training.validate(token, manager.teamId!),
      ).rejects.toMatchObject({
        code: end < now ? 'QR_EXPIRED' : 'QR_INVALID',
      });
    }
  });
  it('encrypts OTP job contents with authenticated encryption', () => {
    const blob = encrypt(config.SESSION_SECRET, '123456');
    expect(blob).not.toContain('123456');
    expect(decrypt(config.SESSION_SECRET, blob)).toBe('123456');
    expect(() => decrypt(config.SESSION_SECRET + 'wrong', blob)).toThrow();
  });
});
describe('database invariants and historical roster', () => {
  let sessionId: string;
  it('enforces a single OPEN session at the database level', async () => {
    const s = await backend.services.training.start(
      {
        name: 'Snapshot',
        latitude: 6,
        longitude: 3,
        locationAccuracy: 50,
        locationCapturedAt: new Date().toISOString(),
      },
      manager.id,
      'test',
    );
    sessionId = s.id;
    await expect(
      fixture.db.trainingSession.create({
        data: {
          teamId: manager.teamId!,
          name: 'Duplicate',
          date: '2026-10-02',
          latitude: 6,
          longitude: 3,
          locationAccuracy: 50,
          locationCapturedAt: new Date(),
          startedBy: manager.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      backend.services.training.start(
        {
          name: 'Duplicate',
          latitude: 6,
          longitude: 3,
          locationAccuracy: 50,
          locationCapturedAt: new Date().toISOString(),
        },
        manager.id,
        'test',
      ),
    ).rejects.toThrow('already open');
  });
  it('preserves a name snapshot and excludes players joining after opening', async () => {
    await fixture.db.user.update({ where: { id: player.id }, data: { name: 'Renamed' } });
    const late = await fixture.db.user.create({
      data: {
        teamId: manager.teamId!,
        name: 'Late join',
        email: `late-${randomUUID()}@test.com`,
        pinHash: player.pinHash,
        active: true,
        isVerified: true,
        activatedAt: new Date(),
      },
    });
    const { token } = await backend.services.training.qr(sessionId, manager.teamId!);
    await expect(backend.services.attendance.checkIn(token, late.id, 'test')).rejects.toThrow(
      'not on this session roster',
    );
    const snapshot = await backend.services.attendance.roster(sessionId, manager.teamId!);
    expect(snapshot.players.find((p) => p.playerId === player.id)!.name).toBe('Eligible');
  });
  it('prevents changing append-only audit records', async () => {
    const row = await fixture.db.auditEvent.findFirstOrThrow({
      where: { action: 'SESSION_OPENED', entityId: sessionId },
    });
    await expect(
      fixture.db.auditEvent.update({ where: { id: row.id }, data: { action: 'ALTERED' } }),
    ).rejects.toThrow();
    await expect(fixture.db.auditEvent.delete({ where: { id: row.id } })).rejects.toThrow();
  });
  it('uses a server timestamp and preserves one record under duplicate requests', async () => {
    const { token } = await backend.services.training.qr(sessionId, manager.teamId!);
    const rows = await Promise.all([
      backend.services.attendance.checkIn(token, player.id, 'test-a'),
      backend.services.attendance.checkIn(token, player.id, 'test-b'),
    ]);
    expect(rows[0].attendance.id).toBe(rows[1].attendance.id);
    expect(Math.abs(rows[0].attendance.checkedInAt.getTime() - Date.now())).toBeLessThan(5000);
    await backend.services.training.close(sessionId, manager.id, 'test');
  });
  it('prevents absence history from changing after deactivation', async () => {
    await fixture.db.user.update({ where: { id: player.id }, data: { active: false } });
    const roster = await backend.services.attendance.roster(sessionId, manager.teamId!);
    expect(roster.players.find((p) => p.playerId === player.id)!.result).toBe('PRESENT');
    await fixture.db.user.update({ where: { id: player.id }, data: { active: true } });
  });
});
describe('worker and unknown payment outcomes', () => {
  it('recovers an expired job lease', async () => {
    const job = await fixture.db.backgroundJob.create({
      data: {
        kind: 'EMAIL_OTP',
        deduplicationKey: randomUUID(),
        payload: {
          userId: player.id,
          challengeId: randomUUID(),
          email: player.email,
          purpose: 'VERIFY_EMAIL',
          encryptedOtp: encrypt(config.SESSION_SECRET, '123456'),
        },
        leaseToken: 'abandoned-worker',
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    const runner = new JobRunner(fixture.db, config, providers, backend.services.payments);
    expect(await runner.tick()).toBe(true);
    const recovered = await fixture.db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(recovered.completedAt).not.toBeNull();
    expect(recovered.payload).toEqual({});
    expect(recovered.leaseToken).toBeNull();
  });
  it('retains pending payment after initialization timeout and escalates old unresolved payments', async () => {
    const month = localMonth();
    const existing = await fixture.db.duesPeriod.findUnique({
      where: { teamId_month: { teamId: manager.teamId!, month } },
    });
    if (!existing) await backend.services.dues.configure(month, 5000, manager.id, 'test');
    await expect(
      backend.services.payments.initialize(player, { month, amount: 15000 }, randomUUID(), 'test'),
    ).rejects.toThrow('unresolved');
    const payment = await fixture.db.payment.findFirstOrThrow({
      where: { playerId: player.id, provider: 'PAYSTACK', status: 'PENDING' },
    });
    expect(payment.checkoutUrl).toBeNull();
    const dues = await fixture.db.monthlyDues.findUniqueOrThrow({
      where: { id: payment.monthlyDuesId },
    });
    expect(dues.status).toBe('NOT_PAID');
    await fixture.db.payment.update({
      where: { id: payment.id },
      data: { createdAt: new Date(Date.now() - 86401_000) },
    });
    await new JobRunner(fixture.db, config, providers, backend.services.payments).maintain();
    expect(
      (await fixture.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).needsReview,
    ).toBe(true);
  });
  it('shares rate-limit state in PostgreSQL', async () => {
    const key = randomUUID();
    await rateLimit(fixture.db, key, 2, 60);
    await rateLimit(fixture.db, key, 2, 60);
    await expect(rateLimit(fixture.db, key, 2, 60)).rejects.toThrow('Too many attempts');
  });
});
