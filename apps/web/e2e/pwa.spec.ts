import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const film = JSON.parse(
  readFileSync(new URL('../public/media/film.json', import.meta.url), 'utf8'),
);

const user = {
  id: 'a78128db-6ea9-4c0c-8c66-e962c2796c1f',
  teamId: '0c0649a3-b102-4c78-a84d-50d79e7e39f1',
  name: 'Tobi Adeyemi',
  email: 'tobi@example.test',
  role: 'PLAYER',
  active: true,
  isVerified: true,
  activatedAt: '2026-09-01T10:00:00.000Z',
};
const team = { id: user.teamId, name: 'Touchline FC', createdAt: '2026-10-02T07:00:00.000Z' };
const auth = { user, team, nextStep: 'READY', csrfToken: 'pwa-test' };
const signedOut = {
  error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'pwa' },
};

test('installed launch offers both roles and resumes the server-selected workspace', async ({
  page,
}) => {
  let session: object | null = null;
  await page.route('**/api/v1/**', (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/auth/me'))
      return route.fulfill({
        status: session ? 200 : 401,
        json: session ?? {
          error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'pwa' },
        },
      });
    if (new URL(route.request().url()).pathname.endsWith('/management/overview'))
      return route.fulfill({
        json: {
          currentSession: null,
          recentSessions: [],
          players: { active: 0, inactive: 0 },
          dues: { month: '2026-10', paid: 0, unpaid: 0 },
          setup: { hasPlayers: false, duesConfigured: false, paymentsReady: false },
        },
      });
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/launch');
  await expect(page.getByRole('link', { name: 'Coach / manager sign in' })).toHaveAttribute(
    'href',
    '/sign-in',
  );
  await expect(page.getByRole('link', { name: 'Player sign in' })).toHaveAttribute(
    'href',
    '/player/sign-in',
  );
  for (const [role, nextStep, target] of [
    ['PLAYER', 'READY', '/home'],
    ['MANAGER', 'READY', '/management'],
    ['MANAGER', 'CREATE_TEAM', '/onboarding/team'],
  ]) {
    session = {
      ...auth,
      user: { ...user, role, teamId: nextStep === 'READY' ? user.teamId : null },
      team: nextStep === 'READY' ? team : null,
      nextStep,
    };
    await page.goto('/launch');
    await expect(page).toHaveURL(new RegExp(`${target}$`));
  }
});

test('installs a public-only worker and opens a generic screen offline', async ({
  page,
  context,
}) => {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'AUTH_REQUIRED', message: 'Sign in.', requestId: 'pwa' } },
    }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  const cachedPaths = await page.evaluate(async () => {
    const paths = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('pitchpresence-static-')) continue;
      for (const request of await (await caches.open(name)).keys())
        paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cachedPaths).toContain('/offline.html');
  expect(cachedPaths.some((path) => /api|management|check-in|dues|media/.test(path))).toBe(false);
  await context.setOffline(true);
  await page.goto('/management/team');
  await expect(page.getByRole('heading', { name: 'Let’s reconnect.' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('status')).toContainText('Still offline');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('heading', { name: 'Let’s reconnect.' })).not.toBeVisible();
});

test('the worker preserves HTTP failures and manifest install icons are available', async ({
  page,
  request,
}) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/launch');
  expect(manifest.scope).toBe('/');
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(
    true,
  );
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const missing = await page.goto('/this-route-does-not-exist');
  expect(missing?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Let’s reconnect.' })).not.toBeVisible();
});

test('installation help supports iPhone and hides in standalone mode', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'iPhone Safari' });
  });
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/auth/me')
        ? auth
        : { items: [], nextCursor: null },
    }),
  );
  await page.goto('/account');
  await page.getByRole('button', { name: 'Install PitchPresence' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Add to Home Screen' })).toBeVisible();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Install PitchPresence' })).not.toBeVisible();
});

test('finished hero film loads only after play and pauses for user control', async ({ page }) => {
  test.skip(
    !film.ready,
    'Actual video exports are required; run the media workflow before release.',
  );
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  const videoRequests: string[] = [];
  page.on('request', (request) => {
    if (/hero-(desktop|mobile)\.mp4/.test(request.url())) videoRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Play film', exact: true })).toBeVisible();
  const video = page.getByLabel('PitchPresence training-day film');
  await expect(video).not.toHaveAttribute('src');
  const controls = await page.locator('.film-controls').boundingBox();
  const description = await page.locator('.film-description').boundingBox();
  expect(controls).not.toBeNull();
  expect(description).not.toBeNull();
  expect(description!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
  expect(videoRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Play film', exact: true }).click();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        errorCode: element.error?.code ?? null,
      })),
    )
    .toEqual({ paused: false, errorCode: null });
  await expect(page.getByRole('button', { name: 'Pause film', exact: true })).toBeVisible();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(0);
  await expect(video).toHaveJSProperty('paused', false);
  expect(videoRequests.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pause film', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play film', exact: true })).toBeVisible();
  await expect(video).toHaveJSProperty('paused', true);
  await page.getByRole('button', { name: 'Replay film', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause film', exact: true })).toBeVisible();
});

test('an interrupted film play remains retryable without the failure fallback', async ({
  page,
}) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let interrupted = false;
    HTMLMediaElement.prototype.play = function () {
      if (!interrupted) {
        interrupted = true;
        return Promise.reject(new DOMException('Playback interrupted by a pause.', 'AbortError'));
      }
      return original.call(this);
    };
  });
  await page.goto('/');
  const play = page.getByRole('button', { name: 'Play film', exact: true });
  await play.click();
  await expect(play).toBeEnabled();
  await expect(page.getByText('The film could not play.')).not.toBeVisible();
  await play.click();
  await expect(page.getByRole('button', { name: 'Pause film', exact: true })).toBeVisible();
});
