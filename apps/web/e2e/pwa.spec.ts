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

test('hero film autoplays silently, restarts on scroll and retains manual pause', async ({
  page,
}) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  await page.goto('/');
  const visual = page.locator('.hero-media .film-visual');
  const video = page.getByLabel('PitchPresence training-day film');
  await visual.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => ({
        paused: element.paused,
        errorCode: element.error?.code ?? null,
      })),
    )
    .toEqual({ paused: false, errorCode: null });
  await expect(video).toHaveJSProperty('muted', true);
  const mobile = await page.evaluate(() => matchMedia('(max-width: 767px)').matches);
  await expect(video).toHaveAttribute('src', mobile ? film.mobile : film.desktop);
  await expect(page.getByRole('button', { name: 'Play film', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replay film', exact: true })).toHaveCount(0);
  const control = page
    .locator('.hero-media')
    .getByRole('button', { name: 'Pause film', exact: true });
  await expect(control).toBeVisible();
  const controls = await control.boundingBox();
  const description = await page.locator('.film-description').boundingBox();
  expect(description!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThan(1);
  await page.locator('.closing').scrollIntoViewIfNeeded();
  await expect(video).toHaveJSProperty('paused', true);
  const stoppedAt = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await visual.scrollIntoViewIfNeeded();
  await expect(video).toHaveJSProperty('paused', false);
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeLessThan(stoppedAt);
  await control.click();
  await expect(video).toHaveJSProperty('paused', true);
  await page.locator('.closing').scrollIntoViewIfNeeded();
  await visual.scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(video).toHaveJSProperty('paused', true);
  await page
    .locator('.hero-media')
    .getByRole('button', { name: 'Resume film', exact: true })
    .click();
  await expect(video).toHaveJSProperty('paused', false);
});

test('reduced motion keeps the hero poster without requesting the video', async ({ page }) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/hero-(desktop|mobile)\.mp4/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/');
  await page.locator('.hero-media .film-visual').scrollIntoViewIfNeeded();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByLabel('PitchPresence training-day film')).not.toHaveAttribute('src');
  expect(requests).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Pause film', exact: true })).toHaveCount(0);
});

test('blocked autoplay retains the poster and allows an explicit resume', async ({ page }) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let blocked = false;
    HTMLMediaElement.prototype.play = function () {
      if (!blocked) {
        blocked = true;
        return Promise.reject(
          new DOMException('Browser policy blocked autoplay.', 'NotAllowedError'),
        );
      }
      return original.call(this);
    };
  });
  await page.goto('/');
  await page.locator('.hero-media .film-visual').scrollIntoViewIfNeeded();
  const resume = page
    .locator('.hero-media')
    .getByRole('button', { name: 'Resume film', exact: true });
  await expect(resume).toBeVisible();
  await expect(page.getByText('The film could not play.')).not.toBeVisible();
  await resume.click();
  await expect(page.getByRole('button', { name: 'Pause film', exact: true })).toBeVisible();
});

test('desktop and tablet split screens play the training film with usable pause controls', async ({
  page,
}) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  let session: object | null = null;
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: session ? 200 : 401,
      json: session ?? signedOut,
    }),
  );
  for (const width of [1440, 834]) {
    session = null;
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      '/sign-in',
      '/player/sign-in',
      '/signup',
      '/forgot-password',
      '/reset-pin',
    ]) {
      await page.goto(path);
      const panel = page.locator('.auth-side');
      const video = panel.getByLabel('Football training film');
      await expect(panel).toBeVisible();
      await expect(video).toHaveJSProperty('paused', false);
      await expect(video).toHaveJSProperty('muted', true);
      await expect(video).toHaveAttribute('src', film.mobile);
      await panel.getByRole('button', { name: 'Pause film', exact: true }).click();
      await expect(video).toHaveJSProperty('paused', true);
      await panel.getByRole('button', { name: 'Resume film', exact: true }).click();
      await expect(video).toHaveJSProperty('paused', false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    for (const [nextStep, path] of [
      ['CREATE_TEAM', '/onboarding/team'],
      ['ACCEPT_INVITATION', '/onboarding/staff-invitation'],
    ]) {
      session = {
        ...auth,
        user: { ...user, role: 'MANAGER', teamId: null },
        team: null,
        nextStep,
        pendingInvitation:
          nextStep === 'ACCEPT_INVITATION'
            ? {
                teamName: team.name,
                email: user.email,
                available: true,
                expiresAt: '2099-01-01T00:00:00.000Z',
              }
            : null,
      };
      await page.goto(path);
      await expect(
        page.locator('.auth-side').getByLabel('Football training film'),
      ).toHaveJSProperty('paused', false);
    }
    session = null;
    await page.goto('/');
    const panel = page.locator('.management-photo');
    await panel.scrollIntoViewIfNeeded();
    const video = panel.getByLabel('Football training film');
    await expect(video).toHaveJSProperty('paused', false);
    await expect(video).toHaveAttribute('src', film.mobile);
    await expect(video).toHaveJSProperty('error', null);
    const descriptionIds = await page
      .locator('video')
      .evaluateAll((videos) => videos.map((video) => video.getAttribute('aria-describedby')));
    expect(new Set(descriptionIds).size).toBe(descriptionIds.length);
  }
});

test('phone layouts and reduced motion do not download split-screen video', async ({ page }) => {
  test.skip(!film.ready, 'Actual video exports are required.');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, json: signedOut }));
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/hero-(desktop|mobile)\.mp4/.test(request.url())) requests.push(request.url());
  });
  for (const [width, reducedMotion] of [
    [390, 'no-preference'],
    [834, 'reduce'],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion });
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const panel = page.locator('.auth-side');
    if (width < 768) await expect(panel).not.toBeVisible();
    else await expect(panel).toBeVisible();
    await expect(panel.getByLabel('Football training film')).not.toHaveAttribute('src');
    expect(requests).toHaveLength(0);
  }
});
