import { test, expect } from '@playwright/test';
const team = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Touchline FC',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const staff = {
  id: '10000000-0000-4000-8000-000000000002',
  teamId: team.id,
  name: 'Coach Tobi',
  email: 'coach@example.test',
  role: 'MANAGER',
  active: true,
  isVerified: true,
  activatedAt: team.createdAt,
};
const player = {
  ...staff,
  id: '10000000-0000-4000-8000-000000000003',
  role: 'PLAYER',
  name: 'Player Tobi',
};
const account = {
  id: '10000000-0000-4000-8000-000000000004',
  bankName: 'Team Bank',
  accountName: 'Touchline FC',
  accountNumber: '0123456789',
  createdAt: team.createdAt,
};
const receipt = {
  id: '10000000-0000-4000-8000-000000000005',
  paymentId: '10000000-0000-4000-8000-000000000006',
  accountId: account.id,
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  size: 48,
  status: 'PENDING',
  reason: null,
  createdAt: team.createdAt,
  reviewedAt: null,
  reviewedBy: null,
  fileAvailable: true,
};
const dues = {
  id: '10000000-0000-4000-8000-000000000007',
  playerId: player.id,
  month: '2026-10',
  status: 'NOT_PAID',
  minimumAmount: 300000,
  paymentMode: 'MANUAL',
  transferAccount: account,
  proofAvailable: true,
  paymentsReady: false,
  paymentAvailable: false,
  paidAt: null,
  qualifyingPaymentId: null,
  createdAt: team.createdAt,
  payments: [] as unknown[],
};
test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (r) => r.abort());
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
});
test('a player uploads proof and sees pending confirmation without a paid badge or checkout', async ({
  page,
}) => {
  const row = { ...dues, payments: [] as unknown[] };
  let uploaded = false;
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({ json: { user: player, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (path.endsWith('/me/dues')) return r.fulfill({ json: { items: [row], nextCursor: null } });
    if (path.endsWith(`/me/dues/${dues.id}/receipt`)) {
      const body = r.request().postDataJSON();
      expect(body.amount).toBe(300000);
      expect(body.accountId).toBe(account.id);
      expect(body.mimeType).toBe('application/pdf');
      expect(Buffer.from(body.content, 'base64').toString()).toContain('%PDF');
      uploaded = true;
      row.payments = [
        {
          id: receipt.paymentId,
          amount: 300000,
          provider: 'EXTERNAL',
          status: 'PENDING',
          reversedAt: null,
          paidAt: null,
          receipt,
        },
      ];
      return r.fulfill({ json: receipt });
    }
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/dues');
  await page.locator('.dues-select').click();
  await expect(page.getByText(account.accountNumber, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Paystack' })).toHaveCount(0);
  await page.getByLabel('Payment receipt (PDF or PNG)').setInputFiles({
    name: 'bank-receipt.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n'),
  });
  await page.getByLabel('I have already transferred this amount to the team.').check();
  await page.getByRole('button', { name: 'Submit payment proof', exact: true }).click();
  await expect(
    page.getByText('Proof submitted · awaiting staff confirmation.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.dues-select .status')).toHaveText('Proof submitted');
  await expect(page.getByRole('link', { name: 'Download receipt' })).toBeVisible();
  expect(uploaded).toBe(true);
});
test('staff account changes resume after refresh and require email confirmation before activation or removal', async ({
  page,
}) => {
  let active: typeof account | null = account;
  let pending: {
    id: string;
    action: string;
    requestedBy: string;
    accountName: string | null;
    bankName: string | null;
    accountLast4: string | null;
    expiresAt: string;
  } | null = null;
  let bankRequests = 0;
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({ json: { user: staff, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (path.endsWith('/management/team'))
      return r.fulfill({
        json: {
          team,
          paymentMode: 'MANUAL',
          transferAccount: active,
          pendingBankChange: pending,
          paymentsReady: false,
          paymentProfile: null,
          latestSetup: null,
        },
      });
    if (path.endsWith('/management/banks')) {
      bankRequests++;
      return r.fulfill({ json: [] });
    }
    if (path.endsWith('/transfer-account/request')) {
      const body = r.request().postDataJSON();
      expect(body.password).toBe('Coach123!');
      pending = {
        id: 'change-1',
        action: body.action,
        requestedBy: staff.id,
        bankName: body.bankName ?? null,
        accountName: body.accountName ?? null,
        accountLast4: body.accountNumber?.slice(-4) ?? null,
        expiresAt: '2040-10-08T12:00:00.000Z',
      };
      return r.fulfill({
        json: {
          changeId: pending.id,
          expiresAt: pending.expiresAt,
          message: 'A confirmation code has been queued for your staff email.',
        },
      });
    }
    if (path.endsWith('/transfer-account/confirm')) {
      expect(r.request().postDataJSON().otp).toBe('123456');
      active =
        pending?.action === 'REMOVE'
          ? null
          : {
              ...account,
              accountNumber: '1111111111',
              bankName: 'New Bank',
              accountName: 'New Team',
            };
      pending = null;
      return r.fulfill({ json: { confirmed: true, transferAccount: active } });
    }
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/management/team');
  await page.getByLabel('Bank name', { exact: true }).fill('New Bank');
  await page.getByLabel('Account holder name').fill('New Team');
  await page.getByLabel('Ten-digit account number').fill('1111111111');
  await page
    .getByLabel('I checked these details and this account is authorised to receive team dues.')
    .check();
  await page.getByLabel('Confirm your password').fill('Coach123!');
  await page.getByRole('button', { name: 'Email replacement code' }).click();
  await expect(page.getByLabel('Bank change email code')).toBeVisible();
  await expect(page.getByText('Team Bank · 0123456789', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Bank change email code').fill('123456');
  await page.getByRole('button', { name: 'Confirm bank change', exact: true }).click();
  await expect(page.getByText('New Bank · 1111111111', { exact: true })).toBeVisible();
  await page.getByLabel('Remove the active account').check();
  await page.getByLabel('I confirm the team should stop using this account.').check();
  await page.getByLabel('Confirm your password').fill('Coach123!');
  await page.getByRole('button', { name: 'Email removal code' }).click();
  await page.getByLabel('Bank change email code').fill('123456');
  await page.getByRole('button', { name: 'Confirm bank change', exact: true }).click();
  await expect(page.getByText('No transfer account is active.', { exact: false })).toBeVisible();
  expect(bankRequests).toBe(0);
});
test('staff review the proof and acknowledge receipt of funds before marking the month paid', async ({
  page,
}) => {
  let approved = false;
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({ json: { user: staff, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (path.endsWith('/management/dues-periods'))
      return r.fulfill({
        json: {
          items: [{ month: dues.month, minimumAmount: 300000, frozenAt: team.createdAt }],
          nextCursor: null,
        },
      });
    if (path.endsWith('/management/dues'))
      return r.fulfill({
        json: {
          items: [
            {
              ...dues,
              player,
              status: approved ? 'PAID' : 'NOT_PAID',
              payments: [
                {
                  id: receipt.paymentId,
                  amount: 300000,
                  provider: 'EXTERNAL',
                  status: approved ? 'SUCCESS' : 'PENDING',
                  reversedAt: null,
                  receipt: { ...receipt, status: approved ? 'APPROVED' : 'PENDING' },
                },
              ],
            },
          ],
          nextCursor: null,
        },
      });
    if (path.endsWith(`/management/receipts/${receipt.id}/review`)) {
      expect(r.request().postDataJSON().decision).toBe('APPROVE');
      approved = true;
      return r.fulfill({ json: {} });
    }
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/management/dues');
  await page.getByRole('button', { name: 'Review receipt' }).click();
  await expect(page.getByRole('button', { name: 'Approve receipt and mark paid' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I confirmed/ }).check();
  await page.getByRole('button', { name: 'Approve receipt and mark paid' }).click();
  await expect(page.locator('.management-dues-row > .between .status')).toHaveText('Paid');
  expect(approved).toBe(true);
});
test('a player who already transferred can submit proof after the account is removed', async ({
  page,
}) => {
  let submitted = false;
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({ json: { user: player, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (path.endsWith('/me/dues'))
      return r.fulfill({
        json: {
          items: [
            {
              ...dues,
              transferAccount: null,
              receiptAccounts: [
                {
                  id: account.id,
                  bankName: account.bankName,
                  accountName: account.accountName,
                  accountLast4: '6789',
                },
              ],
              payments: submitted
                ? [
                    {
                      id: receipt.paymentId,
                      provider: 'EXTERNAL',
                      amount: 300000,
                      status: 'PENDING',
                      receipt,
                    },
                  ]
                : [],
            },
          ],
          nextCursor: null,
        },
      });
    if (path.endsWith(`/me/dues/${dues.id}/receipt`)) {
      expect(r.request().postDataJSON().accountId).toBe(account.id);
      submitted = true;
      return r.fulfill({ json: receipt });
    }
    return r.fulfill({ json: {} });
  });
  await page.goto('/dues');
  await page.locator('.dues-select').click();
  await expect(
    page.getByText('There is no active transfer account.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Account used for this transfer')).toHaveValue(account.id);
  await page.getByLabel('Payment receipt (PDF or PNG)').setInputFiles({
    name: 'old-transfer.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\n% transfer\n%%EOF\n'),
  });
  await page.getByLabel('I have already transferred this amount to the team.').check();
  await page.getByRole('button', { name: 'Submit payment proof', exact: true }).click();
  await expect(page.locator('.dues-select .status')).toHaveText('Proof submitted');
  expect(submitted).toBe(true);
});
