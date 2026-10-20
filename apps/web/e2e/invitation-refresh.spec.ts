import { expect, test, type Page } from '@playwright/test';
const contextId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const otherTeam = '00000000-0000-4000-8000-000000000003';
const token = 'original-invitation-token-kept-out-of-browser-storage';
async function mock(page: Page, kind: 'PLAYER' | 'MANAGER' = 'PLAYER', existing = false) {
  const state = {
    resumeRequests: 0,
    expired: false,
    joined: false,
    registrations: [] as Record<string, unknown>[],
    accepts: [] as Record<string, unknown>[],
  };
  const preview = {
    kind,
    teamId,
    teamName: 'Refresh FC',
    email: kind === 'MANAGER' ? 'coach@example.test' : null,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  const session = () => ({
    user: {
      id: state.joined ? teamId : contextId,
      name: 'Coach',
      email: 'coach@example.test',
      role: state.joined ? 'PLAYER' : 'MANAGER',
      active: true,
      isVerified: true,
      removedAt: null,
      teamId: state.joined ? teamId : otherTeam,
    },
    team: { id: state.joined ? teamId : otherTeam, name: state.joined ? 'Refresh FC' : 'Other FC' },
    nextStep: 'READY',
    csrfToken: 'csrf-refresh',
    hasPlayerPin: true,
    authMethod: 'PASSWORD',
    memberships: [],
  });
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me'))
      return route.fulfill({
        status: existing ? 200 : 401,
        json: existing
          ? session()
          : { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in.' } },
      });
    if (url.pathname.endsWith('/invitations/preview'))
      return route.fulfill({
        json: {
          ...preview,
          contextId,
          contextExpiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
      });
    if (url.pathname.endsWith('/invitations/resume')) {
      state.resumeRequests++;
      expect(url.searchParams.get('context')).toBe(contextId);
      expect(url.searchParams.get('token')).toBeNull();
      return state.expired
        ? route.fulfill({
            status: 422,
            json: {
              error: {
                code: 'INVITATION_CONTEXT_EXPIRED',
                message:
                  'Your saved invitation is unavailable. Reopen the original invitation link shared by your team.',
              },
            },
          })
        : route.fulfill({ json: preview });
    }
    if (url.pathname.endsWith('/auth/register') || url.pathname.endsWith('/auth/staff-register')) {
      state.registrations.push(route.request().postDataJSON());
      return route.fulfill({ json: { message: 'Check your email.', resendAfterSeconds: 60 } });
    }
    if (url.pathname.endsWith('/auth/invitations/accept')) {
      state.accepts.push(route.request().postDataJSON());
      state.joined = true;
      return route.fulfill({ json: session() });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  return state;
}
test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (route) => route.abort());
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});
for (const kind of ['PLAYER', 'MANAGER'] as const) {
  test(`${kind} invitation restores the correct team after refresh without retaining raw tokens or credentials`, async ({
    page,
  }) => {
    const state = await mock(page, kind);
    const route = kind === 'PLAYER' ? '/register' : '/staff/join';
    await page.goto(`${route}?invite=${token}`);
    await expect(page.getByLabel('Your name')).toBeVisible();
    await page.getByLabel('Your name').fill('Unsaved name');
    const credentialLabel = kind === 'PLAYER' ? 'Choose a four-digit PIN' : 'Choose a password';
    await page.getByLabel(credentialLabel).fill(kind === 'PLAYER' ? '2468' : 'CoachPass123!');
    const saved = await page.evaluate(
      (role) => JSON.parse(sessionStorage.getItem(`pitchpresence:join:${role}`)!),
      kind,
    );
    expect(saved.id).toBe(contextId);
    expect(Object.keys(saved).sort()).toEqual(['expiresAt', 'id']);
    await expect(page).toHaveURL(new RegExp(`${route}$`));
    await page.reload();
    await expect(page.getByLabel('Your name')).toHaveValue('');
    await expect(page.getByLabel(credentialLabel)).toHaveValue('');
    await expect(page.locator('.auth-form > .eyebrow')).toContainText('Refresh FC');
    expect(state.resumeRequests).toBe(1);
    await page.getByLabel('Your name').fill('New member');
    if (kind === 'PLAYER') await page.getByLabel('Email address').fill('player@example.test');
    await page.getByLabel(credentialLabel).fill(kind === 'PLAYER' ? '2468' : 'CoachPass123!');
    await page
      .getByRole('button', {
        name: kind === 'PLAYER' ? 'Create player account' : 'Create staff account',
        exact: true,
      })
      .click();
    await expect(page.getByLabel('Six-digit email code')).toBeVisible();
    expect(state.registrations[0]).toHaveProperty('invitationContextId', contextId);
    expect(state.registrations[0]).not.toHaveProperty('invitationToken');
    expect(
      await page.evaluate((role) => sessionStorage.getItem(`pitchpresence:join:${role}`), kind),
    ).toBeNull();
  });
}
test('an existing account remains on the intended invitation after refresh and accepts explicitly', async ({
  page,
}) => {
  const state = await mock(page, 'PLAYER', true);
  await page.goto(`/register?invite=${token}`);
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Accept invitation', exact: true })).toBeEnabled();
  await expect(page.getByText('Signed in as coach@example.test.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(state.accepts).toEqual([{ invitationContextId: contextId }]);
});
test('an expired continuation offers the original link instead of claiming the invitation was revoked', async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto(`/register?invite=${token}`);
  await expect(page.getByLabel('Your name')).toBeVisible();
  state.expired = true;
  await page.reload();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Reopen the original invitation link' }),
  ).toBeVisible();
  await expect(
    page.getByText('Ask your coach or manager for a new invitation link.', { exact: true }),
  ).not.toBeVisible();
  state.expired = false;
  await page.goto(`/register?invite=${token}`);
  await expect(page.getByLabel('Your name')).toBeVisible();
});
