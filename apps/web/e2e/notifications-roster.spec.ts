import { test, expect } from '@playwright/test';
import { createECDH } from 'node:crypto';
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
  name: 'Tobi Ade',
  removedAt: null as string | null,
};
const vapid = createECDH('prime256v1');
vapid.generateKeys();
const publicKey = vapid.getPublicKey().toString('base64url');
test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (r) => r.abort());
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
});
test('dues search sends the player name to the server and keeps the selected status', async ({
  page,
}) => {
  const searches: string[] = [];
  await page.route('**/api/v1/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/auth/me'))
      return r.fulfill({ json: { user: staff, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (url.pathname.endsWith('/management/dues')) {
      searches.push(url.search);
      return r.fulfill({
        json: {
          items:
            url.searchParams.get('search') === 'Tobi'
              ? [
                  {
                    id: '10000000-0000-4000-8000-000000000004',
                    month: url.searchParams.get('month'),
                    status: 'NOT_PAID',
                    player,
                    payments: [],
                  },
                ]
              : [],
          nextCursor: null,
        },
      });
    }
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/management/dues');
  await page.getByLabel('Search player name').fill('Tobi');
  await expect(page.getByText('Tobi Ade', { exact: true })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('NOT_PAID');
  await expect
    .poll(() => searches.some((s) => s.includes('search=Tobi') && s.includes('status=NOT_PAID')))
    .toBe(true);
  await page.getByLabel('Search player name').fill('Missing');
  await expect(
    page.getByText('No players match this name for the selected month and status.'),
  ).toBeVisible();
});
test('staff remove a player with confirmation and can view the retained removed record', async ({
  page,
}) => {
  let removed = false;
  await page.route('**/api/v1/**', (r) => {
    const url = new URL(r.request().url());
    if (url.pathname.endsWith('/auth/me'))
      return r.fulfill({ json: { user: staff, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (url.pathname.endsWith(`/players/${player.id}/remove`)) {
      removed = true;
      return r.fulfill({
        json: { ...player, active: false, removedAt: '2026-10-08T00:00:00.000Z' },
      });
    }
    if (url.pathname.endsWith('/management/players'))
      return r.fulfill({
        json: {
          items: !removed
            ? [player]
            : url.searchParams.get('includeRemoved') === 'true'
              ? [{ ...player, active: false, removedAt: '2026-10-08T00:00:00.000Z' }]
              : [],
          nextCursor: null,
        },
      });
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/management/players');
  await page.getByRole('button', { name: 'Remove from team', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('payment and attendance history');
  await page.getByRole('button', { name: 'Remove player', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'has been removed from the team' }),
  ).toBeVisible();
  await page.getByLabel('Include removed players').check();
  await expect(page.getByText('Tobi Ade', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Activate', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove from team', exact: true })).toHaveCount(0);
});
test('a removed player sees the specific access message instead of their workspace', async ({
  page,
}) => {
  await page.route('**/api/v1/**', (r) =>
    r.fulfill({
      status: 403,
      json: {
        error: {
          code: 'PLAYER_REMOVED',
          message: 'You have been removed from your team. Contact your coach or manager for help.',
          requestId: 'test',
        },
      },
    }),
  );
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Your team access has ended.' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'removed from your team' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Team navigation' })).toHaveCount(0);
});

test('an old removed-player cookie does not block the PIN sign-in form', async ({ page }) => {
  await page.route('**/api/v1/**', (r) =>
    r.fulfill({
      status: 403,
      json: {
        error: {
          code: 'PLAYER_REMOVED',
          message: 'You have been removed from your team. Contact your coach or manager for help.',
          requestId: 'test',
        },
      },
    }),
  );
  await page.goto('/player/sign-in');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: 'removed from your team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry connection', exact: true })).toHaveCount(0);
});

test('a notification month survives the sign-in handoff', async ({ page }) => {
  await page.route('**/api/v1/**', (r) =>
    r.fulfill({
      status: 401,
      json: {
        error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in.', requestId: 'test' },
      },
    }),
  );
  await page.goto('/management/dues?month=2026-09');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/sign-in?returnTo=%2Fmanagement%2Fdues%3Fmonth%3D2026-09',
  );
});
test('staff explicitly enable and disable device notifications without sending the private VAPID key', async ({
  page,
}) => {
  let enabled = false;
  let consentRequests = 0;
  await page.addInitScript(
    ({ publicKey }) => {
      let permission = 'default';
      let subscription: object | null = null;
      const decode = (s: string) =>
        Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      Object.defineProperty(window, 'PushManager', { configurable: true, value: class {} });
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        value: class {
          static get permission() {
            return permission;
          }
          static async requestPermission() {
            (window as unknown as { notificationRequests: number }).notificationRequests = 1;
            permission = 'granted';
            return permission;
          }
        },
      });
      const registration = {
        active: {
          postMessage: (_message: unknown, ports: MessagePort[]) =>
            ports[0].postMessage({ receipts: true }),
        },
        addEventListener: () => {},
        getNotifications: async () => [],
        pushManager: {
          getSubscription: async () => subscription,
          subscribe: async () => {
            subscription = {
              options: { applicationServerKey: decode(publicKey).buffer },
              toJSON: () => ({
                endpoint: 'https://fcm.googleapis.com/test-device',
                keys: { p256dh: 'test-browser-public-key', auth: 'test-browser-auth' },
              }),
              unsubscribe: async () => {
                subscription = null;
                return true;
              },
            };
            return subscription;
          },
        },
      };
      Object.defineProperty(navigator, 'serviceWorker', {
        configurable: true,
        value: {
          controller: null,
          register: async () => registration,
          ready: Promise.resolve(registration),
          getRegistration: async () => registration,
        },
      });
    },
    { publicKey },
  );
  await page.route('**/api/v1/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return r.fulfill({ json: { user: staff, team, nextStep: 'READY', csrfToken: 'test-csrf' } });
    if (path.endsWith('/management/notifications/push')) {
      if (r.request().method() === 'GET')
        return r.fulfill({ json: { available: true, publicKey, enabled } });
      if (r.request().method() === 'POST') {
        const body = r.request().postDataJSON();
        expect(Object.keys(body).sort()).toEqual(['endpoint', 'keys']);
        enabled = true;
      } else enabled = false;
      return r.fulfill({ json: { enabled } });
    }
    if (path.endsWith('/management/operations'))
      return r.fulfill({ json: { pendingPayments: 0, paymentsRequiringReview: 0, failedJobs: 0 } });
    return r.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/account');
  consentRequests = await page.evaluate(
    () => (window as unknown as { notificationRequests?: number }).notificationRequests ?? 0,
  );
  expect(consentRequests).toBe(0);
  await page.getByRole('button', { name: 'Enable receipt notifications', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Disable receipt notifications', exact: true }),
  ).toBeVisible();
  expect(enabled).toBe(true);
  await page.getByRole('button', { name: 'Disable receipt notifications', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enable receipt notifications', exact: true }),
  ).toBeVisible();
  expect(enabled).toBe(false);
});
