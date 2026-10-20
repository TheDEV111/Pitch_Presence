import { expect, test, type Page } from '@playwright/test';
const id = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const version = '00000000-0000-4000-8000-000000000003';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAD0lEQVQImWNgaGBAIOI4ANA0CAH7cWGQAAAAAElFTkSuQmCC',
  'base64',
);
async function mock(page: Page, coach = false) {
  const user = {
    id: coach ? version : id,
    name: coach ? 'Coach' : 'Tobi',
    email: 'tobi@example.test',
    role: coach ? 'MANAGER' : 'PLAYER',
    active: true,
    isVerified: true,
    teamId,
    removedAt: null,
    activatedAt: '2026-10-15T09:00:00Z',
  };
  const data = {
    membershipId: id,
    name: 'Tobi',
    teamName: 'Cool City FC',
    active: true,
    isVerified: true,
    profile: {
      preferredFoot: null as string | null,
      primaryPosition: null as string | null,
      secondaryPositions: [] as string[],
      photoVersion: null as string | null,
      shirtNumber: null as number | null,
      assignedPosition: null as string | null,
    },
    attendance: { attended: 3, missed: 1, total: 4, percentage: 75 },
  };
  const state = {
    writes: [] as { path: string; body: Record<string, unknown> }[],
    failSave: false,
  };
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        json: {
          user,
          team: { id: teamId, name: data.teamName },
          csrfToken: 'csrf-profile',
          nextStep: 'READY',
        },
      });
    if (path.endsWith(`/players/${id}/photo`))
      return route.fulfill({
        contentType: 'image/png',
        body: png,
        headers: { 'cache-control': 'private, no-store' },
      });
    if (path.endsWith('/management/players'))
      return route.fulfill({
        json: {
          items: [{ ...user, id, name: 'Tobi', role: 'PLAYER', playerProfile: data.profile }],
          nextCursor: null,
        },
      });
    if (path.endsWith('/player-profile') || path.endsWith(`/players/${id}/profile`)) {
      if (method === 'PATCH') {
        const body = route.request().postDataJSON();
        state.writes.push({ path, body });
        if (state.failSave) {
          state.failSave = false;
          return route.abort();
        }
        Object.assign(data.profile, body);
      }
      return route.fulfill({ json: data });
    }
    if (path.endsWith('/player-profile/photo')) {
      state.writes.push({ path, body: route.request().postDataJSON() });
      data.profile.photoVersion = method === 'PUT' ? version : null;
      return route.fulfill({ json: data });
    }
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  return state;
}
test('player previews football preferences and retains edits after a failed save', async ({
  page,
}) => {
  const state = await mock(page);
  state.failSave = true;
  await page.goto('/profile');
  await page.getByLabel('Preferred foot', { exact: true }).selectOption('LEFT');
  await page.getByLabel('Primary position', { exact: true }).selectOption('LW');
  await page.getByLabel('Striker', { exact: true }).check();
  await expect(
    page.getByRole('img', { name: 'Preferred playing positions: Left winger, Striker' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save football profile' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to connect' })).toBeVisible();
  await expect(page.getByLabel('Preferred foot', { exact: true })).toHaveValue('LEFT');
  await expect(page.getByLabel('Primary position', { exact: true })).toHaveValue('LW');
  await page.getByRole('button', { name: 'Save football profile' }).click();
  await expect(page.getByText('Your football profile has been saved.')).toBeVisible();
  expect(state.writes.at(-1)?.body).toEqual({
    preferredFoot: 'LEFT',
    primaryPosition: 'LW',
    secondaryPositions: ['ST'],
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
});
test('photo preview requires saving and does not discard unsaved football preferences', async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto('/profile');
  await page.getByLabel('Preferred foot', { exact: true }).selectOption('BOTH');
  await page
    .getByLabel('Choose profile photo')
    .setInputFiles({ name: 'player.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByAltText("Tobi's profile photo")).toHaveAttribute('src', /^blob:/);
  expect(state.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Save profile photo' }).click();
  await expect(page.getByText('Profile photo updated.')).toBeVisible();
  await expect(page.getByAltText("Tobi's profile photo")).toHaveAttribute(
    'src',
    new RegExp(`/api/v1/players/${id}/photo`),
  );
  await expect(page.getByLabel('Preferred foot', { exact: true })).toHaveValue('BOTH');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove profile photo' }).click();
  await expect(page.getByText('Profile photo removed.')).toBeVisible();
});
test('coach opens a roster card and edits only that team assignment', async ({ page }) => {
  const state = await mock(page, true);
  await page.goto('/management/players');
  await page.getByRole('link', { name: 'Tobi', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/management/players/${id}$`));
  await expect(page.getByRole('article', { name: 'Tobi player card' })).toContainText(
    'Cool City FC',
  );
  await expect(page.getByText('3 attended · 1 missed · 75% attendance')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Preferred foot', exact: true })).toHaveCount(0);
  await page.getByLabel('Shirt number').fill('8');
  await page.getByLabel('Assigned team position', { exact: true }).selectOption('DM');
  await page.getByRole('button', { name: 'Save team details' }).click();
  await expect(page.getByText('Team details saved.')).toBeVisible();
  expect(state.writes.at(-1)?.body).toEqual({ shirtNumber: 8, assignedPosition: 'DM' });
  await page.reload();
  await expect(page.getByLabel('Shirt number')).toHaveValue('8');
});
