import { expect, test, type Page } from '@playwright/test';

const stamp = '2026-10-15T09:00:00.000Z';
async function mockDevices(page: Page, role: 'PLAYER' | 'MANAGER' = 'PLAYER') {
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Henry',
    email: 'henry@example.test',
    role,
    active: true,
    isVerified: true,
    removedAt: null,
    activatedAt: stamp,
    teamId: '00000000-0000-4000-8000-000000000002',
  };
  let devices = [
    {
      id: 'current',
      deviceLabel: 'Chrome on Android',
      isCurrent: true,
      createdAt: stamp,
      lastUsedAt: stamp,
      expiresAt: stamp,
    },
    {
      id: 'other',
      deviceLabel: 'Safari on iOS',
      isCurrent: false,
      createdAt: stamp,
      lastUsedAt: stamp,
      expiresAt: stamp,
    },
    {
      id: 'legacy',
      deviceLabel: null,
      isCurrent: false,
      createdAt: stamp,
      lastUsedAt: stamp,
      expiresAt: stamp,
    },
  ];
  const writes: unknown[] = [];
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          user,
          team: { id: user.teamId, name: 'FC', createdAt: stamp },
          nextStep: 'READY',
          csrfToken: 'csrf-device',
        },
      });
    if (path.endsWith('/auth/sessions'))
      return route.fulfill({ json: { items: devices, nextCursor: null } });
    if (path.endsWith('/auth/sessions/revoke-others')) {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (body.credential !== (role === 'MANAGER' ? 'CoachPass123!' : '2468'))
        return route.fulfill({
          status: 403,
          json: {
            error: {
              code: 'REAUTHENTICATION_FAILED',
              message: 'The credential is incorrect. No devices were signed out.',
            },
          },
        });
      const revoked = devices.length - 1;
      devices = devices.filter((device) => device.isCurrent);
      return route.fulfill({ json: { revoked } });
    }
    if (path.endsWith('/auth/sessions/other') && route.request().method() === 'DELETE') {
      writes.push({ removed: 'other' });
      devices = devices.filter((device) => device.id !== 'other');
      return route.fulfill({ json: { revoked: true } });
    }
    if (path.endsWith('/management/operations'))
      return route.fulfill({
        json: { pendingPayments: 0, paymentsRequiringReview: 0, failedJobs: 0 },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  return writes;
}
test('device list identifies the current browser and legacy sessions and confirms a selected sign-out', async ({
  page,
}) => {
  const writes = await mockDevices(page);
  await page.goto('/account');
  await expect(page.getByText('Chrome on Android · This device', { exact: true })).toBeVisible();
  await expect(page.getByText('Unknown browser', { exact: true })).toBeVisible();
  const row = page.locator('.record-row').filter({ hasText: 'Safari on iOS' });
  await row.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Safari on iOS');
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Sign out device', exact: true }).click();
  await expect(page.getByText('Safari on iOS has been signed out.', { exact: true })).toBeVisible();
  await expect(row).not.toBeVisible();
  await expect(page.getByText('Chrome on Android · This device', { exact: true })).toBeVisible();
});
for (const role of ['PLAYER', 'MANAGER'] as const) {
  test(`${role} confirms their credential before signing out other devices`, async ({ page }) => {
    const writes = await mockDevices(page, role);
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out all other devices', exact: true }).click();
    const field = page.getByLabel(role === 'PLAYER' ? 'Confirm your PIN' : 'Confirm your password');
    await field.fill(role === 'PLAYER' ? '0000' : 'Incorrect1!');
    await page.getByRole('button', { name: 'Confirm sign out other devices' }).click();
    await expect(page.getByRole('dialog')).toContainText('No devices were signed out.');
    await expect(page.getByText('Safari on iOS', { exact: true })).toBeVisible();
    await field.fill(role === 'PLAYER' ? '2468' : 'CoachPass123!');
    await page.getByRole('button', { name: 'Confirm sign out other devices' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(
      page.getByText('Signed out 2 other browser sessions. This device stays signed in.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText('Chrome on Android · This device', { exact: true })).toBeVisible();
    expect(writes).toHaveLength(2);
  });
}
