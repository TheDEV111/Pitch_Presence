import { test, expect } from '@playwright/test';
const player = {
  id: 'a78128db-6ea9-4c0c-8c66-e962c2796c1f',
  teamId: '0c0649a3-b102-4c78-a84d-50d79e7e39f1',
  name: 'Tobi Adeyemi',
  email: 'tobi@example.test',
  role: 'PLAYER',
  active: true,
  isVerified: true,
  activatedAt: '2026-09-01T10:00:00.000Z',
};
const team = { id: player.teamId, name: 'Touchline FC', createdAt: '2026-10-02T07:00:00.000Z' };
const auth = { user: player, team, nextStep: 'READY', csrfToken: 'csrf-test' };
test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (r) => r.abort());
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
});
test('landing explains the product and keeps animation under user control', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      status: 401,
      json: { error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'test' } },
    }),
  );
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('MORE');
  await expect(page.getByRole('button', { name: 'Play walkthrough' })).toBeVisible();
  await page.getByRole('button', { name: 'Dues', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A month sorted.' })).toBeVisible();
  await page.getByRole('button', { name: 'Attendance', exact: true }).click();
  await page.getByRole('button', { name: 'Play walkthrough' }).click();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});
test('a QR fragment survives inline sign-in and is removed from the URL', async ({ page }) => {
  let signedIn = false;
  let receivedToken = '';
  await page.route('**/api/v1/**', async (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn
          ? auth
          : { error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'test' } },
      });
    if (path.endsWith('/auth/device-login')) {
      signedIn = true;
      return r.fulfill({ json: auth });
    }
    if (path.endsWith('/attendance/check-in')) {
      receivedToken = r.request().postDataJSON().token;
      expect(r.request().headers()['x-csrf-token']).toBe('csrf-test');
      return r.fulfill({
        json: { alreadyRecorded: false, attendance: { checkedInAt: '2026-10-02T07:38:00.000Z' } },
      });
    }
    return r.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'test' } },
    });
  });
  await page.goto('/check-in#token=sample-token-long-enough');
  await expect(page).toHaveURL(/\/check-in$/);
  await page.getByLabel('Email address').fill(player.email);
  await page.getByLabel('Four-digit PIN').fill('0123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm check-in' }).click();
  await expect(page.getByRole('heading', { name: 'You’re checked in.' })).toBeVisible();
  expect(receivedToken).toBe('sample-token-long-enough');
});
test('pending checkout is not shown as a paid month', async ({ page }) => {
  const month = '2026-10';
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me')) return r.fulfill({ json: auth });
    if (path.endsWith('/me/dues'))
      return r.fulfill({
        json: {
          items: [
            {
              id: 'due-1',
              month,
              status: 'NOT_PAID',
              minimumAmount: 500000,
              paymentAvailable: true,
              payments: [],
            },
          ],
          nextCursor: null,
        },
      });
    if (path.endsWith('/payments/paystack/initialize')) {
      expect(r.request().postDataJSON().amount).toBe(500000);
      expect(r.request().headers()['idempotency-key']).toBeTruthy();
      return r.fulfill({
        json: {
          id: 'payment-1',
          status: 'PENDING',
          amount: 500000,
          currency: 'NGN',
          checkoutUrl: null,
          providerReference: null,
          paidAt: null,
        },
      });
    }
    return r.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'test' } },
    });
  });
  await page.goto('/dues');
  await page.getByRole('button', { name: /October 2026/ }).click();
  await page.getByLabel('Amount in naira').fill('5000');
  await page.getByRole('button', { name: 'Continue to Paystack' }).click();
  await expect(page.getByRole('button', { name: 'Check payment status' })).toBeVisible();
  await expect(page.getByText('Payment pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Not paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to Paystack' })).toBeDisabled();
});
test('players cannot open the management workspace', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (r) => r.fulfill({ json: auth }));
  await page.goto('/management');
  await expect(
    page.getByRole('heading', { name: 'This page belongs to a different role.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open your dashboard' })).toHaveAttribute(
    'href',
    '/home',
  );
});

test('expired live QR is removed even when refreshing fails', async ({ page }) => {
  const id = '23546b6e-a0b7-40a0-ae9c-2d910738fbf0';
  let issued = false;
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return route.fulfill({ json: { ...auth, user: { ...player, role: 'MANAGER' } } });
    if (path.endsWith('/qr-token')) {
      if (issued)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'UNAVAILABLE', message: 'Reconnect.', requestId: 'test' } },
        });
      issued = true;
      return route.fulfill({
        json: {
          token: 'demo-test-token',
          expiresAt: new Date(Date.now() + 3000).toISOString(),
          refreshAfterSeconds: 10,
        },
      });
    }
    if (path.endsWith('/attendance'))
      return route.fulfill({
        json: { sessionId: id, status: 'OPEN', checkedInCount: 0, players: [] },
      });
    return route.fulfill({
      json: {
        id,
        name: 'Saturday training',
        status: 'OPEN',
        startedAt: '2026-10-02T07:00:00.000Z',
      },
    });
  });
  await page.goto(`/management/training/${id}`);
  await expect(page.getByRole('img', { name: 'Live training check-in QR code' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Live training check-in QR code' })).toHaveCount(0, {
    timeout: 6000,
  });
  await expect(
    page.locator('.qr-panel').getByText('Waiting for a fresh code. Reconnect if needed.'),
  ).toBeVisible();
});

test('landing fits mobile, tablet, and desktop widths', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({
      status: 401,
      json: { error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'test' } },
    }),
  );
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
  }
});

test('staff use passwords while players retain four-digit PIN access', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (r) =>
    r.fulfill({ status: 401, json: { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } } }),
  );
  await page.goto('/sign-in');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Four-digit PIN')).toHaveCount(0);
  await page.getByRole('link', { name: 'Player sign in', exact: true }).click();
  await expect(page.getByLabel('Four-digit PIN')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
});

test('staff signup verifies email then resumes team creation', async ({ page }) => {
  let verified = false,
    created = false;
  const staff = { ...player, role: 'MANAGER', teamId: null };
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({
        status: verified ? 200 : 401,
        json: verified
          ? {
              ...auth,
              user: created ? { ...staff, teamId: team.id } : staff,
              team: created ? team : null,
              nextStep: created ? 'READY' : 'CREATE_TEAM',
            }
          : { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } },
      });
    if (path.endsWith('/auth/staff-register')) {
      expect(r.request().postDataJSON().password).toBe('a memorable coach passphrase');
      return r.fulfill({ json: { message: 'Check email.' } });
    }
    if (path.endsWith('/auth/verify-email')) {
      verified = true;
      return r.fulfill({ json: { ...auth, user: staff, team: null, nextStep: 'CREATE_TEAM' } });
    }
    if (path.endsWith('/teams')) {
      expect(r.request().postDataJSON()).toEqual({ name: 'Touchline FC' });
      created = true;
      return r.fulfill({ json: team });
    }
    if (path.endsWith('/management/overview'))
      return r.fulfill({
        json: {
          team,
          paymentProfile: null,
          latestSetup: null,
          paymentsReady: false,
          currentSession: null,
          recentSessions: [],
          players: { active: 0, total: 0 },
          dues: { month: '2026-10', paid: 0, unpaid: 0, minimumAmount: null },
          setup: { hasPlayers: false, duesConfigured: false, paymentsReady: false },
        },
      });
    return r.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
    });
  });
  await page.goto('/signup');
  await page.getByLabel('Your name').fill('Tobi Adeyemi');
  await page.getByLabel('Email address').fill(player.email);
  await page.getByLabel('Choose a password').fill('a memorable coach passphrase');
  await page.getByRole('button', { name: 'Create staff account' }).click();
  await page.getByLabel('Six-digit email code').fill('012345');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  await page.reload();
  await expect(page.getByLabel('Team name')).toBeVisible();
  await page.getByLabel('Team name').fill('Touchline FC');
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page).toHaveURL(/\/management$/);
  await expect(page.getByRole('heading', { name: 'Make the team your own.' })).toBeVisible();
  await expect(page.getByText('Touchline FC', { exact: true }).first()).toBeVisible();
});

test('an existing verified coach accepts an email-bound staff invitation', async ({ page }) => {
  let joined = false;
  const staff = { ...player, role: 'MANAGER', teamId: null };
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/invitations/preview'))
      return r.fulfill({ json: { kind: 'MANAGER', email: player.email, teamName: team.name } });
    if (path.endsWith('/auth/me'))
      return r.fulfill({
        json: {
          ...auth,
          user: { ...staff, teamId: joined ? team.id : null },
          team: joined ? team : null,
          nextStep: joined ? 'READY' : 'CREATE_TEAM',
        },
      });
    if (path.endsWith('/auth/staff-invitation/accept')) {
      expect(r.request().postDataJSON().token).toBe('a-long-staff-invitation-token-123456');
      joined = true;
      return r.fulfill({ json: { ...staff, teamId: team.id } });
    }
    if (path.endsWith('/management/overview'))
      return r.fulfill({
        json: {
          team,
          paymentProfile: null,
          latestSetup: null,
          paymentsReady: false,
          currentSession: null,
          recentSessions: [],
          players: { active: 0, total: 0 },
          dues: { month: '2026-10', paid: 0, unpaid: 0, minimumAmount: null },
          setup: { hasPlayers: false, duesConfigured: false, paymentsReady: false },
        },
      });
    return r.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
    });
  });
  await page.goto('/staff/join?invite=a-long-staff-invitation-token-123456');
  await expect(page).toHaveURL(/\/staff\/join$/);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL(/\/management$/);
  expect(joined).toBe(true);
});

test('staff resolve and confirm a bank, reauthenticate, and stay signed in after a wrong password', async ({
  page,
}) => {
  let connected = false;
  let bankListRequests = 0;
  const manager = { ...player, role: 'MANAGER' };
  const profile = {
    id: '23546b6e-a0b7-40a0-ae9c-2d910738fbf0',
    status: 'READY',
    bankCode: '058',
    accountName: 'TEAM ACCOUNT',
    accountLast4: '6789',
    createdAt: '2026-10-02T07:00:00.000Z',
  };
  const settings = () => ({
    team,
    paymentsReady: connected,
    paymentProfile: connected ? profile : null,
    latestSetup: connected ? profile : null,
  });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { ...auth, user: manager } });
    if (path.endsWith('/management/team')) return route.fulfill({ json: settings() });
    if (path.endsWith('/management/staff'))
      return route.fulfill({ json: { items: [manager], nextCursor: null } });
    if (path.endsWith('/management/staff-invitations'))
      return route.fulfill({ json: { items: [], nextCursor: null } });
    if (path.endsWith('/management/banks')) {
      bankListRequests++;
      if (bankListRequests === 1)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'The bank list is temporarily unavailable.',
            },
          },
        });
      return route.fulfill({ json: [{ code: '058', name: 'Guaranty Trust Bank' }] });
    }
    if (path.endsWith('/management/bank/resolve'))
      return route.fulfill({ json: { accountName: 'TEAM ACCOUNT' } });
    if (path.endsWith('/management/bank')) {
      const body = route.request().postDataJSON();
      expect(body.accountName).toBe('TEAM ACCOUNT');
      expect(body.accountNumber).toBe('0123456789');
      expect(route.request().headers()['x-csrf-token']).toBe('csrf-test');
      if (body.password === 'wrong')
        return route.fulfill({
          status: 401,
          json: {
            error: {
              code: 'REAUTHENTICATION_FAILED',
              message: 'Check your password and try again.',
            },
          },
        });
      expect(body.password).toBe('a memorable coach passphrase');
      connected = true;
      return route.fulfill({ json: settings() });
    }
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
    });
  });
  await page.goto('/management/team');
  await expect(page.getByLabel('Bank', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Resolve account name' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry loading banks' }).click();
  await expect(page.getByLabel('Bank', { exact: true })).toBeEnabled();
  await expect(page.getByRole('option', { name: 'Guaranty Trust Bank' })).toHaveCount(1);
  await page.getByLabel('Bank', { exact: true }).selectOption('058');
  await page.getByLabel('Ten-digit account number').fill('0123456789');
  await page.getByRole('button', { name: 'Resolve account name' }).click();
  await expect(page.getByLabel('Resolved account name')).toHaveValue('TEAM ACCOUNT');
  await expect(
    page.getByRole('button', { name: 'Connect team bank account', exact: true }),
  ).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByLabel('Confirm your password').fill('wrong');
  await page.getByRole('button', { name: 'Connect team bank account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Check your password');
  await expect(page.getByLabel('Confirm your password')).toBeVisible();
  await page.getByLabel('Confirm your password').fill('a memorable coach passphrase');
  await page.getByRole('button', { name: 'Connect team bank account', exact: true }).click();
  await expect(page.getByText('Account ending 6789 · Connected')).toBeVisible();
  expect(connected).toBe(true);
});
