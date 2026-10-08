import { encrypt } from '../../src/infrastructure/secrets.js';
import { schemas } from '@pitchpresence/shared';
import { seedTeam, bankProviders } from '../fixtures/team.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { testDatabase } from '../fixtures/database.js';
import { buildApp } from '../../src/app.js';
import { PaymentService } from '../../src/modules/payments/service.js';
import { localMonth } from '../../src/plugins/core.js';
import { loadConfig } from '../../src/config/index.js';
// These tests deliberately require multiple real PostgreSQL connections.
// Embedded PGlite serializes operations and cannot prove row-lock behavior.
describe.skipIf(!process.env.TEST_DATABASE_URL)('multi-connection PostgreSQL concurrency', () => {
  let fixture: Awaited<ReturnType<typeof testDatabase>>,
    backend: Awaited<ReturnType<typeof buildApp>>;
  let manager: import('@pitchpresence/database').User,
    player: import('@pitchpresence/database').User;
  beforeAll(async () => {
    fixture = await testDatabase();
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      SESSION_SECRET: 'concurrency-session-secret-0000000000000',
      QR_SIGNING_SECRET: 'concurrency-qr-secret-0000000000000000000',
      PAYMENT_MODE: 'PAYSTACK',
      LOG_LEVEL: 'silent',
    });
    backend = await buildApp(config, { db: fixture.db });
    const hash = await argon2.hash('1234');
    manager = await fixture.db.user.create({
      data: {
        name: 'Manager',
        email: `manager-${randomUUID()}@test.com`,
        passwordHash: hash,
        role: 'MANAGER',
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    });
    manager = await seedTeam(fixture.db, manager);
    player = await fixture.db.user.create({
      data: {
        teamId: manager.teamId!,
        name: 'Player',
        email: `player-${randomUUID()}@test.com`,
        pinHash: hash,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    });
  });
  afterAll(async () => {
    if (backend) await backend.app.close();
    if (fixture) await fixture.close();
  });
  const input = () => ({
    name: 'Concurrent session',
    latitude: 6,
    longitude: 3,
    locationAccuracy: 25,
    locationCapturedAt: new Date().toISOString(),
  });
  it('allows only one concurrent session start', async () => {
    const results = await Promise.allSettled([
      backend.services.training.start(input(), manager.id, 'a'),
      backend.services.training.start(input(), manager.id, 'b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const open = await fixture.db.trainingSession.findFirstOrThrow({ where: { status: 'OPEN' } });
    await backend.services.training.close(open.id, manager.id, 'close');
  });
  it('allows simultaneous starts in distinct teams without sharing roster or open-session state', async () => {
    let other = await fixture.db.user.create({
      data: {
        name: 'Other coach',
        email: `${randomUUID()}@test.com`,
        role: 'MANAGER',
        passwordHash: manager.passwordHash,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    });
    other = await seedTeam(fixture.db, other);
    const [one, two] = await Promise.all([
      backend.services.training.start(input(), manager.id, 'team-a'),
      backend.services.training.start(input(), other.id, 'team-b'),
    ]);
    expect(one.teamId).not.toBe(two.teamId);
    expect((await backend.services.attendance.roster(two.id, other.teamId!)).players).toHaveLength(
      0,
    );
    await Promise.all([
      backend.services.training.close(one.id, manager.id, 'close-a'),
      backend.services.training.close(two.id, other.id, 'close-b'),
    ]);
  });
  it('serializes QR, manual attendance, and close against the same session row', async () => {
    const session = await backend.services.training.start(input(), manager.id, 'open');
    const { token } = await backend.services.training.qr(session.id, manager.teamId!);
    await Promise.allSettled([
      backend.services.attendance.checkIn(token, player.id, 'qr'),
      backend.services.attendance.record(session.id, player.id, manager.id, 'manual'),
      backend.services.training.close(session.id, manager.id, 'close'),
    ]);
    expect(
      await fixture.db.attendance.count({ where: { sessionId: session.id, playerId: player.id } }),
    ).toBeLessThanOrEqual(1);
    await expect(
      backend.services.attendance.checkIn(token, player.id, 'after-close'),
    ).rejects.toThrow('closed');
    const row = await fixture.db.attendance.findFirst({
      where: { sessionId: session.id, playerId: player.id },
    });
    const closed = await fixture.db.trainingSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    if (row) expect(row.checkedInAt.getTime()).toBeLessThanOrEqual(closed.closedAt!.getTime());
  });
  it('settles once when browser and webhook verification race', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      SESSION_SECRET: 'concurrency-payment-session-000000000000',
      QR_SIGNING_SECRET: 'concurrency-payment-qr-00000000000000000',
      PAYMENT_MODE: 'PAYSTACK',
      LOG_LEVEL: 'silent',
    });
    let reference = '';
    const payments = new PaymentService(fixture.db, config, {
      ...bankProviders,
      sendOtp: async () => {},
      initialize: async (input) => {
        reference = input.reference;
        return 'https://checkout.paystack.com/test';
      },
      verify: async () => ({
        reference,
        subaccountCode: `ACCT_${manager.teamId}`,
        status: 'success',
        amount: 15000,
        currency: 'NGN',
        email: player.email,
        paidAt: new Date().toISOString(),
      }),
    });
    await backend.services.dues.configure(localMonth(), 10000, manager.id, 'configure');
    const payment = await payments.initialize(
      player,
      { month: localMonth(), amount: 15000 },
      randomUUID(),
      'init',
    );
    const results = await Promise.all([
      payments.verify(payment.id, 'browser'),
      payments.verify(payment.id, 'webhook'),
    ]);
    expect(results.every((r) => r.status === 'SUCCESS')).toBe(true);
    expect(
      await fixture.db.auditEvent.count({
        where: { entityId: payment.id, action: 'PAYMENT_VERIFIED' },
      }),
    ).toBe(1);
    const dues = await fixture.db.monthlyDues.findUniqueOrThrow({
      where: { playerId_month: { playerId: player.id, month: localMonth() } },
    });
    expect(dues.status).toBe('PAID');
    expect(dues.qualifyingPaymentId).toBe(payment.id);
  });
  it('serializes different receipt uploads and concurrent staff confirmations without duplicate settlement', async () => {
    const fresh = await fixture.db.user.create({
      data: {
        teamId: manager.teamId!,
        name: 'Fresh player',
        email: `${randomUUID()}@test.com`,
        pinHash: player.pinHash,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
      },
    });
    const account = await fixture.db.teamTransferAccount.create({
      data: {
        teamId: manager.teamId!,
        configuredBy: manager.id,
        bankName: 'Team Bank',
        accountName: 'Team',
        encryptedNumber: encrypt('concurrency-session-secret-0000000000000', '1111111111'),
        accountLast4: '1111',
      },
    });
    await fixture.db.team.update({
      where: { id: manager.teamId! },
      data: { transferAccountId: account.id },
    });
    const dues = (await backend.services.dues.own(fresh)).items[0]!;
    const upload = (suffix: string) =>
      schemas.receiptUpload.parse({
        amount: 15000,
        accountId: account.id,
        fileName: 'receipt.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from(`%PDF-1.7\n% ${suffix}\n%%EOF\n`).toString('base64'),
      });
    const submissions = await Promise.allSettled([
      backend.services.receipts.upload(fresh, dues.id, upload('first'), 'a'),
      backend.services.receipts.upload(fresh, dues.id, upload('second'), 'b'),
    ]);
    expect(submissions.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const receipt = await fixture.db.paymentReceipt.findFirstOrThrow({
      where: { monthlyDuesId: dues.id },
    });
    const results = await Promise.allSettled([
      backend.services.receipts.review(manager, receipt.id, { decision: 'APPROVE' }, 'review-a'),
      backend.services.receipts.review(manager, receipt.id, { decision: 'APPROVE' }, 'review-b'),
      backend.services.dues.markPaid(dues.id, 15000, manager.id, 'direct-confirmation'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(
      await fixture.db.payment.count({ where: { monthlyDuesId: dues.id, status: 'SUCCESS' } }),
    ).toBe(1);
    expect(
      await fixture.db.auditEvent.count({
        where: { entityId: receipt.id, action: 'PAYMENT_PROOF_APPROVED' },
      }),
    ).toBe(1);
    expect(
      (await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: dues.id } })).status,
    ).toBe('PAID');
  });
});
