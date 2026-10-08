import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { schemas } from '@pitchpresence/shared';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config/index.js';
import { testDatabase } from '../fixtures/database.js';
import { seedTeam, bankProviders } from '../fixtures/team.js';
import { encrypt, decrypt } from '../../src/infrastructure/secrets.js';
import { localMonth } from '../../src/plugins/core.js';
import { JobRunner } from '../../src/infrastructure/jobs.js';
import type { Providers } from '../../src/infrastructure/providers.js';
const password = 'Coach123!';
const config = loadConfig({
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://localhost/test',
  SESSION_SECRET: 'manual-session-secret-00000000000000',
  QR_SIGNING_SECRET: 'manual-qr-secret-0000000000000000000',
  PAYMENT_MODE: 'MANUAL',
  LOG_LEVEL: 'silent',
});
const emails: { email: string; text: string }[] = [];
const providers: Providers = {
  ...bankProviders,
  sendBankNotice: async (email, _, text) => {
    emails.push({ email, text });
  },
  sendOtp: async () => {},
  initialize: async () => {
    throw new Error('Paystack must not be called');
  },
  verify: async () => {
    throw new Error('Paystack must not be called');
  },
};
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let backend: Awaited<ReturnType<typeof buildApp>>;
let staff: import('@pitchpresence/database').User;
let player: typeof staff;
let outsider: typeof staff;
let sessions: Record<string, Awaited<ReturnType<typeof backend.services.auth.createSession>>>;
let duesId: string, accountId: string, hash: string;
function request(method: 'GET' | 'POST', path: string, body: unknown = {}, actor = staff) {
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
    ...(method === 'POST' ? { payload: JSON.stringify(body) } : {}),
  });
}
function proof(suffix = 'original') {
  const content = Buffer.from(
    `%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n% ${suffix}\n%%EOF\n`,
  ).toString('base64');
  return {
    amount: 300000,
    accountId,
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    content,
  };
}
async function code(changeId: string) {
  const job = await fixture.db.backgroundJob.findUniqueOrThrow({
    where: { deduplicationKey: `bank-code:${changeId}` },
  });
  return decrypt(config.SESSION_SECRET, (job.payload as { encryptedOtp: string }).encryptedOtp);
}
async function bankChange(accountNumber = '0123456789') {
  const r = await request('POST', '/management/transfer-account/request', {
    action: 'SET',
    bankName: 'Team Bank',
    accountName: 'Team Account',
    accountNumber,
    password,
  });
  expect(r.statusCode).toBe(200);
  return r.json<{ changeId: string }>().changeId;
}
beforeAll(async () => {
  fixture = await testDatabase();
  backend = await buildApp(config, { db: fixture.db, providers });
  hash = await argon2.hash(password);
});
afterAll(async () => {
  await backend?.app.close();
  await fixture?.close();
});
beforeEach(async () => {
  emails.length = 0;
  const createStaff = () =>
    fixture.db.user.create({
      data: {
        name: 'Coach',
        email: `${randomUUID()}@test.com`,
        role: 'MANAGER',
        passwordHash: hash,
        active: true,
        isVerified: true,
        activatedAt: new Date(),
      },
    });
  staff = await seedTeam(fixture.db, await createStaff(), false);
  outsider = await seedTeam(fixture.db, await createStaff(), false);
  player = await fixture.db.user.create({
    data: {
      name: 'Player',
      email: `${randomUUID()}@test.com`,
      role: 'PLAYER',
      teamId: staff.teamId,
      pinHash: hash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
  sessions = {};
  for (const user of [staff, player, outsider])
    sessions[user.id] = await backend.services.auth.createSession(user);
  const account = await fixture.db.teamTransferAccount.create({
    data: {
      teamId: staff.teamId!,
      configuredBy: staff.id,
      bankName: 'Initial Bank',
      accountName: 'Initial Team',
      encryptedNumber: encrypt(config.SESSION_SECRET, '1111111111'),
      accountLast4: '1111',
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
it('manual production configuration requires email and HTTPS, but no Paystack key', () => {
  expect(
    loadConfig({
      ...config,
      PORT: String(config.PORT),
      DATA_ENCRYPTION_SECRET: 'production-data-secret-000000000000',
      NODE_ENV: 'production',
      APP_URL: 'https://team.example.com',
      RESEND_API_KEY: 'test-email-key',
    }).PAYSTACK_SECRET_KEY,
  ).toBe('');
  expect(() =>
    loadConfig({
      ...config,
      PORT: String(config.PORT),
      DATA_ENCRYPTION_SECRET: 'production-data-secret-000000000000',
      NODE_ENV: 'production',
      APP_URL: 'https://team.example.com',
      RESEND_API_KEY: 'test-email-key',
      PAYMENT_MODE: 'PAYSTACK',
    }),
  ).toThrow();
  expect(
    schemas.staffRegister.safeParse({ name: 'Coach', email: 'coach@test.com', password }).success,
  ).toBe(true);
  for (const weak of ['Ab1!', 'abcdefgh', 'ABCDEFGH', 'Abcdefgh', 'Abcdef12'])
    expect(
      schemas.passwordReset.safeParse({ email: 'coach@test.com', otp: '123456', password: weak })
        .success,
    ).toBe(false);
});
it('receipt submission is pending, retry-safe, private, then staff approval updates dues once', async () => {
  const upload = await request('POST', `/me/dues/${duesId}/receipt`, proof(), player);
  expect(upload.statusCode).toBe(200);
  const receipt = upload.json<{ id: string; paymentId: string; status: string }>();
  expect(receipt.status).toBe('PENDING');
  expect(upload.body).not.toContain('content');
  expect((await request('POST', `/me/dues/${duesId}/receipt`, proof(), player)).json().id).toBe(
    receipt.id,
  );
  expect(await fixture.db.paymentReceipt.count({ where: { monthlyDuesId: duesId } })).toBe(1);
  const own = await request('GET', '/me/dues', {}, player);
  expect(own.json().items[0]).toMatchObject({
    status: 'NOT_PAID',
    paymentMode: 'MANUAL',
    paymentsReady: false,
    transferAccount: { accountNumber: '1111111111' },
    payments: [{ receipt: { status: 'PENDING' } }],
  });
  expect((await request('GET', `/receipts/${receipt.id}/file`, {}, outsider)).statusCode).toBe(404);
  expect(
    (
      await request(
        'POST',
        `/management/receipts/${receipt.id}/review`,
        { decision: 'APPROVE' },
        player,
      )
    ).statusCode,
  ).toBe(403);
  const download = await request('GET', `/receipts/${receipt.id}/file`, {}, staff);
  expect(download.statusCode).toBe(200);
  expect(download.headers['content-disposition']).toContain('attachment');
  expect(download.headers['cache-control']).toBe('no-store');
  expect(download.headers['content-security-policy']).toContain('sandbox');
  expect(download.body).toContain('%PDF');
  expect(
    (await request('POST', `/dues/${duesId}/mark-paid`, { amount: 300000 })).json().error.code,
  ).toBe('RECEIPT_PENDING');
  const approved = await request('POST', `/management/receipts/${receipt.id}/review`, {
    decision: 'APPROVE',
  });
  expect(approved.statusCode).toBe(200);
  expect(approved.json().dues.status).toBe('PAID');
  expect(
    (await request('POST', `/management/receipts/${receipt.id}/review`, { decision: 'APPROVE' }))
      .statusCode,
  ).toBe(200);
  expect(
    await fixture.db.payment.count({ where: { monthlyDuesId: duesId, status: 'SUCCESS' } }),
  ).toBe(1);
  await backend.services.dues.reverse(
    duesId,
    receipt.paymentId,
    'Transfer refunded',
    staff.id,
    'test',
  );
  expect((await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } })).status).toBe(
    'NOT_PAID',
  );
  await request('POST', `/management/receipts/${receipt.id}/review`, { decision: 'APPROVE' });
  expect((await fixture.db.monthlyDues.findUniqueOrThrow({ where: { id: duesId } })).status).toBe(
    'NOT_PAID',
  );
});
it('receipt validation rejects spoofed files, wrong owners, below-minimum and duplicate proofs', async () => {
  for (const input of [
    { ...proof(), amount: 200000 },
    { ...proof(), content: Buffer.from('<html>not pdf</html>').toString('base64') },
    { ...proof(), mimeType: 'image/png', fileName: 'receipt.png' },
    { ...proof(), accountId: randomUUID() },
  ])
    expect((await request('POST', `/me/dues/${duesId}/receipt`, input, player)).statusCode).toBe(
      422,
    );
  expect((await request('POST', `/me/dues/${duesId}/receipt`, proof(), outsider)).statusCode).toBe(
    403,
  );
  expect(await fixture.db.paymentReceipt.count({ where: { monthlyDuesId: duesId } })).toBe(0);
});
it('a rejected proof leaves the month unpaid and permits a corrected receipt', async () => {
  const first = (await request('POST', `/me/dues/${duesId}/receipt`, proof(), player)).json();
  expect(
    (await request('POST', `/management/receipts/${first.id}/review`, { decision: 'REJECT' }))
      .statusCode,
  ).toBe(422);
  const rejected = await request('POST', `/management/receipts/${first.id}/review`, {
    decision: 'REJECT',
    reason: 'The destination account is incorrect.',
  });
  expect(rejected.json().dues.status).toBe('NOT_PAID');
  expect(
    (await request('POST', `/management/receipts/${first.id}/review`, { decision: 'APPROVE' }))
      .statusCode,
  ).toBe(409);
  const corrected = await request('POST', `/me/dues/${duesId}/receipt`, proof('corrected'), player);
  expect(corrected.statusCode).toBe(200);
  expect(corrected.json().id).not.toBe(first.id);
});
it('account replacement and removal need password plus an actor-bound, single-use email code', async () => {
  expect(
    (
      await request('POST', '/management/transfer-account/request', {
        action: 'REMOVE',
        password: 'wrong',
      })
    ).json().error.code,
  ).toBe('REAUTHENTICATION_FAILED');
  const id = await bankChange();
  expect((await backend.services.transfers.current(staff.teamId!))?.accountNumber).toBe(
    '1111111111',
  );
  const runner = new JobRunner(fixture.db, config, providers, backend.services.payments);
  while (await runner.tick()) {
    /* drain isolated jobs */
  }
  expect(
    emails.some((e) => e.email === staff.email && e.text.includes('account ending 6789')),
  ).toBe(true);
  expect(
    (
      await request(
        'POST',
        '/management/transfer-account/confirm',
        { changeId: id, otp: '000000' },
        outsider,
      )
    ).statusCode,
  ).toBe(404);
  // Codes are consumed from the job payload by the worker; extract the delivered message.
  const otp = emails
    .find((e) => e.email === staff.email && e.text.includes('confirmation code'))!
    .text.match(/code is (\d{6})/)![1]!;
  const wrong = otp === '000000' ? '111111' : '000000';
  expect(
    (await request('POST', '/management/transfer-account/confirm', { changeId: id, otp: wrong }))
      .statusCode,
  ).toBe(422);
  expect((await fixture.db.bankAccountChange.findUniqueOrThrow({ where: { id } })).attempts).toBe(
    1,
  );
  const confirmed = await request('POST', '/management/transfer-account/confirm', {
    changeId: id,
    otp,
  });
  expect(confirmed.statusCode).toBe(200);
  expect(confirmed.json().transferAccount.accountNumber).toBe('0123456789');
  expect(
    (await request('POST', '/management/transfer-account/confirm', { changeId: id, otp }))
      .statusCode,
  ).toBe(200);
  expect(await fixture.db.teamTransferAccount.count({ where: { teamId: staff.teamId! } })).toBe(2);
  while (await runner.tick()) {}
  expect(emails.some((e) => e.text.includes('A staff member confirmed a bank change'))).toBe(true);
  const removal = (
    await request('POST', '/management/transfer-account/request', { action: 'REMOVE', password })
  ).json();
  expect(await backend.services.transfers.current(staff.teamId!)).not.toBeNull();
  expect(
    (
      await request('POST', '/management/transfer-account/confirm', {
        changeId: removal.changeId,
        otp: await code(removal.changeId),
      })
    ).json().transferAccount,
  ).toBeNull();
  expect(await fixture.db.teamTransferAccount.count({ where: { teamId: staff.teamId! } })).toBe(2);
  const historical = (await backend.services.dues.own(player)).items[0]!;
  expect(historical.transferAccount).toBeNull();
  expect(historical.proofAvailable).toBe(true);
  expect(historical.receiptAccounts.map((a) => a.id)).toContain(accountId);
  expect(
    (await request('POST', '/me/dues/' + duesId + '/receipt', proof(), player)).statusCode,
  ).toBe(200); // Already-made transfers keep their original account snapshot.
});
it('new requests replace old codes, block repeated changes, and lock out five wrong guesses', async () => {
  const first = await bankChange('2222222222');
  const firstCode = await code(first);
  const second = await bankChange('3333333333');
  const correct = await code(second);
  expect(
    (
      await request('POST', '/management/transfer-account/confirm', {
        changeId: first,
        otp: firstCode,
      })
    ).json().error.code,
  ).toBe('BANK_CODE_EXPIRED');
  const wrong = correct === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++)
    expect(
      (
        await request('POST', '/management/transfer-account/confirm', {
          changeId: second,
          otp: wrong,
        })
      ).json().error.code,
    ).toBe('BANK_CODE_INVALID');
  expect(
    (
      await request('POST', '/management/transfer-account/confirm', {
        changeId: second,
        otp: correct,
      })
    ).json().error.code,
  ).toBe('BANK_CODE_EXPIRED');
  await bankChange('4444444444');
  expect(
    (await request('POST', '/management/transfer-account/request', { action: 'REMOVE', password }))
      .statusCode,
  ).toBe(429);
  expect((await backend.services.transfers.current(staff.teamId!))?.id).toBe(accountId);
});
it('Paystack setup and checkout are paused while direct manager confirmation still works', async () => {
  expect(
    (
      await request(
        'POST',
        '/payments/paystack/initialize',
        { month: localMonth(), amount: 300000 },
        player,
      )
    ).statusCode,
  ).toBe(422); // Missing idempotency key.
  await expect(
    backend.services.payments.initialize(
      player,
      { month: localMonth(), amount: 300000 },
      randomUUID(),
      'test',
    ),
  ).rejects.toMatchObject({ code: 'PAYSTACK_PAUSED' });
  expect((await request('GET', '/management/banks')).json().error.code).toBe('PAYSTACK_PAUSED');
  expect(
    (
      await request('POST', `/dues/${duesId}/mark-paid`, {
        amount: 300000,
        externalReference: 'bank transfer',
      })
    ).json().dues.status,
  ).toBe('PAID');
});
it('maintenance expires reviewed files without removing the payment record', async () => {
  const uploaded = (await request('POST', `/me/dues/${duesId}/receipt`, proof(), player)).json();
  // Seed review time through the regular pending → approved transition.
  await fixture.db.paymentReceipt.update({
    where: { id: uploaded.id },
    data: {
      status: 'APPROVED',
      reviewedBy: staff.id,
      reviewedAt: new Date(Date.now() - 181 * 86400_000),
    },
  });
  const runner = new JobRunner(fixture.db, config, providers, backend.services.payments);
  await runner.maintain();
  expect((await request('GET', `/receipts/${uploaded.id}/file`, {}, player)).statusCode).toBe(410);
  expect(await fixture.db.payment.count({ where: { id: uploaded.paymentId } })).toBe(1);
});
it('another coach in the same team cannot confirm the requester’s bank code', async () => {
  const colleague = await fixture.db.user.create({
    data: {
      name: 'Second coach',
      email: `${randomUUID()}@test.com`,
      role: 'MANAGER',
      teamId: staff.teamId,
      passwordHash: hash,
      isVerified: true,
      active: true,
      activatedAt: new Date(),
    },
  });
  sessions[colleague.id] = await backend.services.auth.createSession(colleague);
  const changeId = await bankChange();
  const otp = await code(changeId);
  expect(
    (await request('POST', '/management/transfer-account/confirm', { changeId, otp }, colleague))
      .statusCode,
  ).toBe(404);
  expect(
    (await request('POST', '/management/transfer-account/confirm', { changeId, otp }, staff))
      .statusCode,
  ).toBe(200);
  const runner = new JobRunner(fixture.db, config, providers, backend.services.payments);
  while (await runner.tick()) {}
  expect(
    emails.some((e) => e.email === colleague.email && e.text.includes('confirmed a bank change')),
  ).toBe(true);
});
it('allows PNG proof, prevents concurrent outstanding submissions, and limits rejected reuploads', async () => {
  const { readFile } = await import('node:fs/promises');
  const png = await readFile('apps/web/public/icons/icon-192.png');
  const first = await request(
    'POST',
    `/me/dues/${duesId}/receipt`,
    { ...proof(), fileName: 'receipt.png', mimeType: 'image/png', content: png.toString('base64') },
    player,
  );
  expect(first.statusCode).toBe(200);
  expect(
    (await request('POST', `/me/dues/${duesId}/receipt`, proof('second'), player)).json().error
      .code,
  ).toBe('RECEIPT_PENDING');
  await request('POST', `/management/receipts/${first.json().id}/review`, {
    decision: 'REJECT',
    reason: 'Please upload your actual receipt.',
  });
  for (const suffix of ['second', 'third']) {
    const next = await request('POST', `/me/dues/${duesId}/receipt`, proof(suffix), player);
    expect(next.statusCode).toBe(200);
    expect(
      (
        await request('POST', `/management/receipts/${next.json().id}/review`, {
          decision: 'REJECT',
          reason: 'No transfer has arrived.',
        })
      ).statusCode,
    ).toBe(200);
  }
  expect(
    (await request('POST', `/me/dues/${duesId}/receipt`, proof('fourth'), player)).json().error
      .code,
  ).toBe('RECEIPT_LIMIT');
  expect(
    (await request('POST', `/dues/${duesId}/mark-paid`, { amount: 300000 })).json().dues.status,
  ).toBe('PAID');
});
