import { expect, test, type Page } from '@playwright/test';

const teamA = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'ALX',
  createdAt: '2026-10-12T00:00:00.000Z',
};
const teamB = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Training FC',
  createdAt: teamA.createdAt,
};
const staff = {
  id: '00000000-0000-4000-8000-000000000003',
  email: 'henry@example.test',
  name: 'Henry',
  role: 'MANAGER',
  active: true,
  isVerified: true,
  removedAt: null,
  activatedAt: teamA.createdAt,
  teamId: teamA.id,
};
const player = {
  ...staff,
  id: '00000000-0000-4000-8000-000000000004',
  role: 'PLAYER',
  teamId: teamB.id,
};
const memberships = [
  {
    id: staff.id,
    teamId: teamA.id,
    teamName: teamA.name,
    role: 'MANAGER',
    active: true,
    removedAt: null,
  },
  {
    id: player.id,
    teamId: teamB.id,
    teamName: teamB.name,
    role: 'PLAYER',
    active: true,
    removedAt: null,
  },
];
async function mock(
  page: Page,
  options: { pin?: boolean; joining?: boolean; single?: boolean } = {},
) {
  let current = options.pin ? player : staff;
  let method = options.pin ? 'PIN' : 'PASSWORD';
  const writes: Record<string, unknown>[] = [];
  const context = () => ({
    user: current,
    team: current.role === 'MANAGER' ? teamA : teamB,
    authMethod: method,
    hasPlayerPin: !options.joining || current.role === 'PLAYER',
    memberships:
      options.single || (options.joining && current.role === 'MANAGER')
        ? [memberships[0]]
        : memberships,
    csrfToken: 'csrf-memberships',
    nextStep: 'READY',
    pendingInvitation: null,
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: context() });
    if (path.endsWith('/invitations/preview'))
      return route.fulfill({
        json: { teamId: teamB.id, teamName: teamB.name, kind: 'PLAYER', email: null },
      });
    if (path.endsWith('/auth/invitations/accept')) {
      const body = route.request().postDataJSON();
      writes.push(body);
      current = player;
      return route.fulfill({ json: context() });
    }
    if (path.endsWith('/auth/memberships/switch')) {
      const body = route.request().postDataJSON();
      writes.push(body);
      current = body.membershipId === staff.id ? staff : player;
      if (current.role === 'MANAGER') method = 'PASSWORD';
      return route.fulfill({ json: context() });
    }
    if (path.endsWith('/management/overview'))
      return route.fulfill({
        json: {
          team: teamA,
          currentSession: null,
          recentSessions: [],
          players: { active: 1, total: 1 },
          dues: { month: '2026-10', paid: 0, unpaid: 1, minimumAmount: null },
          setup: { hasPlayers: true, duesConfigured: false, paymentsReady: false },
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  return writes;
}
test('a single membership keeps the existing dashboard without a switcher', async ({ page }) => {
  await mock(page, { single: true });
  await page.goto('/management');
  await expect(page.getByRole('heading', { name: /The team comes first/ })).toBeVisible();
  await expect(page.getByText('Switch team', { exact: true })).not.toBeVisible();
});
test('an existing coach joins through a player invitation without creating another account', async ({
  page,
}) => {
  const writes = await mock(page, { joining: true });
  await page.goto('/register?invite=existing-account-player-invitation');
  await expect(page.getByText('Signed in as henry@example.test.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Your name')).not.toBeVisible();
  await page.getByLabel('Choose your player PIN').fill('2468');
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(writes).toEqual([{ token: 'existing-account-player-invitation', pin: '2468' }]);
});
test('switching from player to staff requires a password and reloads the correct workspace', async ({
  page,
}) => {
  const writes = await mock(page, { pin: true });
  await page.goto('/home');
  await page.getByText('Switch team', { exact: true }).click();
  await page.getByLabel('Team and role', { exact: true }).selectOption(staff.id);
  await expect(page.getByLabel('Account password')).toBeVisible();
  await page.getByLabel('Account password').fill('CoachPass123!');
  await page.getByRole('button', { name: 'Open team', exact: true }).click();
  await expect(page).toHaveURL(/\/management$/);
  expect(writes).toEqual([{ membershipId: staff.id, password: 'CoachPass123!' }]);
});
test('an existing team member sees their team name without another acceptance request', async ({
  page,
}) => {
  const writes = await mock(page, { pin: true });
  await page.goto('/register?invite=already-joined-team-invitation');
  await expect(page.getByRole('status')).toContainText(
    'This account is already part of Training FC.',
  );
  await expect(
    page.getByRole('button', { name: 'Accept invitation', exact: true }),
  ).not.toBeVisible();
  await page.getByRole('link', { name: 'Go to my workspace' }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(writes).toHaveLength(0);
});
test('an existing membership in another workspace guides the user to switch teams', async ({
  page,
}) => {
  const writes = await mock(page);
  await page.goto('/register?invite=already-joined-team-invitation');
  await expect(page.getByRole('status')).toContainText(
    'This account is already part of Training FC.',
  );
  await expect(
    page.getByText('Open your workspace and use Switch team to select this team.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Accept invitation', exact: true }),
  ).not.toBeVisible();
  expect(writes).toHaveLength(0);
});
test('a removed membership explains why the invitation cannot restore access', async ({ page }) => {
  const writes = await mock(page);
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      json: {
        user: staff,
        team: teamA,
        csrfToken: 'csrf-memberships',
        nextStep: 'READY',
        pendingInvitation: null,
        memberships: [
          memberships[0],
          { ...memberships[1], active: false, removedAt: teamA.createdAt },
        ],
      },
    }),
  );
  await page.goto('/register?invite=removed-team-invitation');
  await expect(page.getByRole('status')).toContainText('You were removed from Training FC.');
  await expect(
    page.getByRole('button', { name: 'Accept invitation', exact: true }),
  ).not.toBeVisible();
  expect(writes).toHaveLength(0);
});
test('a missing acceptance route explains the deployment problem without claiming a duplicate account', async ({
  page,
}) => {
  await mock(page, { joining: true });
  await page.route('**/api/v1/auth/invitations/accept', (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Route not found.' } },
    }),
  );
  await page.goto('/register?invite=existing-account-player-invitation');
  await page.getByLabel('Choose your player PIN').fill('2468');
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Team invitation acceptance is unavailable on the server.' }),
  ).toBeVisible();
  await expect(page.getByText('Signed in as henry@example.test.', { exact: false })).toBeVisible();
});
test('a stale tab shows a reload screen instead of silently using another team', async ({
  page,
}) => {
  await mock(page);
  await page.route('**/api/v1/management/overview', (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: 'WORKSPACE_CHANGED', message: 'Your selected team changed.' } },
    }),
  );
  await page.goto('/management');
  await expect(page.getByRole('heading', { name: 'Your selected team changed.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload workspace' })).toBeVisible();
});
