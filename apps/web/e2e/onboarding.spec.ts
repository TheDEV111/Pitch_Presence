import { expect, test, type Page } from '@playwright/test';

const team = {
  id: '0c0649a3-b102-4c78-a84d-50d79e7e39f1',
  name: 'Recovery FC',
  createdAt: '2026-10-06T07:00:00.000Z',
};
const coach = {
  id: 'a78128db-6ea9-4c0c-8c66-e962c2796c1f',
  name: 'Coach',
  email: 'coach@example.test',
  role: 'MANAGER',
  active: true,
  isVerified: true,
  activatedAt: '2026-10-06T07:00:00.000Z',
  teamId: null,
};
async function mockOnboarding(
  page: Page,
  options: {
    verified?: boolean;
    invited?: boolean;
    lostSignup?: boolean;
    lostTeam?: boolean;
    duplicate?: boolean;
    lostAuth?: boolean;
  } = {},
) {
  const state = {
    verified: options.verified ?? false,
    created: false,
    signupRequests: 0,
    teamWrites: 0,
    authRequests: 0,
  };
  const context = () => ({
    user: { ...coach, teamId: state.created ? team.id : null },
    team: state.created ? team : null,
    nextStep: state.created ? 'READY' : options.invited ? 'ACCEPT_INVITATION' : 'CREATE_TEAM',
    pendingInvitation: options.invited
      ? {
          teamName: team.name,
          email: coach.email,
          available: true,
          expiresAt: '2099-01-01T00:00:00.000Z',
        }
      : null,
    csrfToken: 'csrf-test',
  });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      state.authRequests++;
      if (options.lostAuth && state.authRequests === 1) return route.abort();
      return route.fulfill({
        status: state.verified ? 200 : 401,
        json: state.verified
          ? context()
          : { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in.' } },
      });
    }
    if (path.endsWith('/invitations/preview'))
      return route.fulfill({ json: { teamName: team.name, email: coach.email, kind: 'MANAGER' } });
    if (path.endsWith('/auth/staff-register')) {
      state.signupRequests++;
      if (options.lostSignup && state.signupRequests === 1) return route.abort();
      if (options.duplicate)
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'ACCOUNT_EXISTS',
              message:
                'An account already uses this email. Sign in or continue email verification.',
            },
          },
        });
      return route.fulfill({
        json: { message: 'Continue with your latest email code.', resendAfterSeconds: 60 },
      });
    }
    if (path.endsWith('/auth/staff-login'))
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: 'EMAIL_VERIFICATION_REQUIRED',
            message: 'Verify your email before signing in.',
          },
        },
      });
    if (path.endsWith('/auth/verify-email')) {
      expect(route.request().postDataJSON().email).toBe(coach.email);
      state.verified = true;
      return route.fulfill({ json: context() });
    }
    if (path.endsWith('/auth/resend-otp'))
      return route.fulfill({ json: { message: 'If eligible, a code will be sent.' } });
    if (path.endsWith('/auth/staff-invitation/accept')) {
      state.created = true;
      return route.fulfill({ json: context().user });
    }
    if (path.endsWith('/teams')) {
      if (!state.created) {
        state.created = true;
        state.teamWrites++;
        if (options.lostTeam) return route.abort();
      }
      return route.fulfill({ json: team });
    }
    if (path.endsWith('/management/overview'))
      return route.fulfill({
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
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found.' } },
    });
  });
  return state;
}
async function signup(page: Page, invited = false) {
  await page.getByLabel('Your name').fill('Coach');
  if (invited) await expect(page.getByLabel('Email address')).toHaveValue(coach.email);
  else await page.getByLabel('Email address').fill(coach.email);
  await page.getByLabel('Choose a password').fill('CoachPass123!');
  await page.getByRole('button', { name: 'Create staff account' }).click();
}
const clockStart = new Date('2026-10-13T12:00:00Z');
const clockPause = new Date('2026-10-13T13:00:00Z');

for (const failure of ['consumed-code', 'lost-response', 'invalid-code', 'different-account']) {
  test(`verification recovery handles ${failure} using the server session`, async ({ page }) => {
    const state = await mockOnboarding(page);
    await page.route('**/api/v1/auth/verify-email', async (route) => {
      state.verified = failure !== 'invalid-code';
      if (failure === 'different-account') {
        await page.route('**/api/v1/auth/me', (me) =>
          me.fulfill({
            json: {
              user: { ...coach, email: 'someone-else@example.test' },
              csrfToken: 'csrf-other',
              team: null,
              nextStep: 'CREATE_TEAM',
            },
          }),
        );
      }
      if (failure === 'lost-response') return route.abort();
      return route.fulfill({
        status: 422,
        json: { error: { code: 'OTP_INVALID', message: 'The code is invalid or expired.' } },
      });
    });
    await page.goto('/signup');
    await signup(page);
    await page.getByLabel('Six-digit email code').fill('012345');
    await page.getByRole('button', { name: 'Verify email', exact: true }).click();
    if (failure === 'consumed-code' || failure === 'lost-response') {
      await expect(page).toHaveURL(/\/onboarding\/team$/);
    } else {
      await expect(
        page.getByRole('alert').filter({ hasText: 'The code is invalid or expired.' }),
      ).toBeVisible();
      await expect(page.getByLabel('Six-digit email code')).toBeVisible();
    }
  });
}

test('player verification resumes after refresh, submits once and opens the registered team without accepting again', async ({
  page,
}) => {
  let verified = false;
  let verificationRequests = 0;
  let acceptanceRequests = 0;
  let releaseVerification!: () => void;
  const pending = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  const context = {
    user: { ...coach, role: 'PLAYER', teamId: team.id },
    team,
    csrfToken: 'csrf-player',
    nextStep: 'READY',
  };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me'))
      return route.fulfill({
        status: verified ? 200 : 401,
        json: verified ? context : { error: { code: 'AUTH_REQUIRED', message: 'Sign in.' } },
      });
    if (path.endsWith('/invitations/preview'))
      return route.fulfill({
        json: { teamId: team.id, teamName: team.name, kind: 'PLAYER', email: null },
      });
    if (path.endsWith('/auth/register'))
      return route.fulfill({ json: { message: 'Check your email.', resendAfterSeconds: 60 } });
    if (path.endsWith('/auth/verify-email')) {
      verificationRequests++;
      await pending;
      verified = true;
      return route.fulfill({ json: context });
    }
    if (path.endsWith('/auth/invitations/accept')) acceptanceRequests++;
    return route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto('/register?invite=player-registration-invitation');
  await page.getByLabel('Your name').fill('Player');
  await page.getByLabel('Email address').fill(coach.email);
  await page.getByLabel('Choose a four-digit PIN').fill('2468');
  await page.getByRole('button', { name: 'Create player account', exact: true }).click();
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
  await page.getByLabel('Six-digit email code').fill('999999');
  await page.reload();
  await expect(page.getByLabel('Email address')).toHaveValue(coach.email);
  await expect(page.getByLabel('Six-digit email code')).toHaveValue('');
  await expect(page.getByLabel('Choose a four-digit PIN')).not.toBeVisible();
  const recovery = await page.evaluate(() =>
    sessionStorage.getItem('pitchpresence:verification:PLAYER'),
  );
  expect(recovery).not.toBeNull();
  expect(Object.keys(JSON.parse(recovery!)).sort()).toEqual([
    'email',
    'expiresAt',
    'resendAt',
    'role',
  ]);
  expect(recovery).not.toContain('player-registration-invitation');
  await page.getByLabel('Six-digit email code').fill('012345');
  await page.getByLabel('Six-digit email code').evaluate((input) => {
    const form = (input as HTMLInputElement).form!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect.poll(() => verificationRequests).toBe(1);
  releaseVerification();
  await expect(page).toHaveURL(/\/home$/);
  expect(verificationRequests).toBe(1);
  expect(acceptanceRequests).toBe(0);
});

test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (route) => route.abort());
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});
test('verification and sign-in actions occupy separate rows at phone, tablet and desktop widths', async ({
  page,
}) => {
  await mockOnboarding(page);
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    const options = page.getByRole('navigation', { name: 'Account access options' });
    const verify = options.getByRole('button', { name: 'Verify your email', exact: true });
    const back = options.getByRole('link', { name: 'Back to sign in' });
    await expect(verify).toBeEnabled();
    await expect(back).toBeVisible();
    const top = await verify.boundingBox();
    const bottom = await back.boundingBox();
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    expect(bottom!.y).toBeGreaterThanOrEqual(top!.y + top!.height + 8);
    expect(top!.height).toBeGreaterThanOrEqual(44);
    expect(bottom!.height).toBeGreaterThanOrEqual(44);
    expect(top!.x).toBeGreaterThanOrEqual(0);
    expect(bottom!.x + bottom!.width).toBeLessThanOrEqual(width);
    await verify.click();
    await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeVisible();
    const submit = await page
      .getByRole('button', { name: 'Verify email', exact: true })
      .boundingBox();
    const below = await back.boundingBox();
    expect(below!.y).toBeGreaterThanOrEqual(submit!.y + submit!.height + 8);
  }
});
test('verification resumes after refresh and navigation without saving the code or password', async ({
  page,
}) => {
  await mockOnboarding(page);
  await page.goto('/signup');
  await signup(page);
  await page.getByLabel('Six-digit email code').fill('012345');
  await page.reload();
  await expect(page.getByLabel('Email address')).toHaveValue(coach.email);
  await expect(page.getByLabel('Six-digit email code')).toHaveValue('');
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
  const stored = await page.evaluate(() =>
    sessionStorage.getItem('pitchpresence:verification:MANAGER'),
  );
  expect(stored).not.toContain('012345');
  expect(stored).not.toContain('CoachPass123!');
  expect(stored).not.toContain('invite');
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Continue email verification' }).click();
  await expect(page.getByLabel('Email address')).toHaveValue(coach.email);
  await expect(page.getByRole('button', { name: /Resend code in/ })).toBeDisabled();
});
test('an unverified coach signing in resumes verification and then team creation', async ({
  page,
}) => {
  await mockOnboarding(page);
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(coach.email);
  await page.getByLabel('Password', { exact: true }).fill('CoachPass123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
  await expect(page.getByLabel('Email address')).toHaveValue(coach.email);
  await page.getByLabel('Six-digit email code').fill('012345');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem('pitchpresence:verification:MANAGER')),
  ).toBeNull();
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/onboarding\/team$/);
});
test('signup retries a lost response and offers verification for an existing account', async ({
  page,
}) => {
  const state = await mockOnboarding(page, { lostSignup: true });
  await page.goto('/signup');
  await signup(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to connect' })).toContainText(
    'Unable to connect',
  );
  await page.getByRole('button', { name: 'Create staff account' }).click();
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
  expect(state.signupRequests).toBe(2);
  await page.evaluate(() => sessionStorage.clear());
  await page.unroute('**/api/v1/**');
  await mockOnboarding(page, { duplicate: true });
  await page.goto('/signup');
  await signup(page);
  await expect(
    page.getByRole('alert').filter({ hasText: 'An account already uses this email' }),
  ).toContainText('An account already uses this email');
  await page.getByRole('button', { name: 'Verify your email', exact: true }).click();
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
});
test('an invited coach refreshes verification and resumes the saved invitation without its raw link', async ({
  page,
}) => {
  await mockOnboarding(page, { invited: true });
  await page.goto('/staff/join?invite=a-long-staff-invitation-token-123456');
  await expect(page).toHaveURL(/\/staff\/join$/);
  await signup(page, true);
  // Clicking submits the request; wait for its response and saved recovery state before refreshing.
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
  const savedVerification = await page.evaluate(() =>
    sessionStorage.getItem('pitchpresence:verification:MANAGER'),
  );
  expect(savedVerification).toContain(coach.email);
  expect(savedVerification).not.toContain('a-long-staff-invitation-token-123456');
  await page.reload();
  await page.getByLabel('Six-digit email code').fill('012345');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding\/staff-invitation$/);
  await expect(page.getByRole('heading', { name: 'JOIN THE COACHING TEAM.' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
  await expect(page).toHaveURL(/\/management$/);
});
test('an unavailable session check offers a retry before enabling signup', async ({ page }) => {
  await mockOnboarding(page, { lostAuth: true });
  await page.goto('/signup');
  await expect(page.getByRole('button', { name: 'Create staff account' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('button', { name: 'Create staff account' })).toBeEnabled();
});
test('a lost team creation response can be retried without another team', async ({ page }) => {
  const state = await mockOnboarding(page, { verified: true, lostTeam: true });
  await page.goto('/signup');
  await expect(page).toHaveURL(/\/onboarding\/team$/);
  await page.getByLabel('Team name').fill(team.name);
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to connect' })).toContainText(
    'Unable to connect',
  );
  await page.getByRole('button', { name: 'Create team', exact: true }).click();
  await expect(page).toHaveURL(/\/management$/);
  expect(state.teamWrites).toBe(1);
});

test('registration throttling preserves input and enables an explicit retry without resubmitting', async ({
  page,
}) => {
  await mockOnboarding(page);
  let attempts = 0;
  await page.route('**/api/v1/auth/staff-register', (route) => {
    attempts++;
    return route.fulfill({
      status: 429,
      json: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts; try again later.',
          retryAfterSeconds: 3,
        },
      },
    });
  });
  await page.clock.install({ time: clockStart });
  await page.goto('/signup');
  await page.clock.pauseAt(clockPause);
  await signup(page);
  const button = page.getByRole('button', { name: 'Create staff account' });
  await expect(page.getByText('Too many attempts. Try again in 3s.')).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByLabel('Choose a password')).toHaveValue('CoachPass123!');
  await page.clock.fastForward(2000);
  await expect(page.getByText('Too many attempts. Try again in 1s.')).toBeVisible();
  await expect(button).toBeDisabled();
  await page.clock.fastForward(2000);
  await expect(button).toBeEnabled();
  expect(attempts).toBe(1);
  await button.click();
  await expect.poll(() => attempts).toBe(2);
});

test('resend throttling uses the header fallback and does not block entering a verification code', async ({
  page,
}) => {
  await mockOnboarding(page);
  await page.route('**/api/v1/auth/resend-otp', (route) =>
    route.fulfill({
      status: 429,
      headers: { 'Retry-After': '3' },
      json: { error: { code: 'RATE_LIMITED', message: 'Too many attempts; try again later.' } },
    }),
  );
  await page.clock.install({ time: clockStart });
  await page.goto('/signup');
  await page.clock.pauseAt(clockPause);
  await signup(page);
  await expect(page.getByLabel('Six-digit email code')).toBeVisible();
  await page.clock.fastForward(61000);
  await page.getByRole('button', { name: 'Resend email code' }).click();
  await expect(page.getByRole('button', { name: 'Resend code in 3s' })).toBeDisabled();
  await page.getByLabel('Six-digit email code').fill('012345');
  await expect(page.getByRole('button', { name: 'Verify email', exact: true })).toBeEnabled();
  await page.clock.fastForward(4000);
  await expect(page.getByRole('button', { name: 'Resend email code' })).toBeEnabled();
});

test('a throttled player invitation remains in memory and can be checked again explicitly', async ({
  page,
}) => {
  await mockOnboarding(page);
  let previews = 0;
  await page.route('**/api/v1/invitations/preview?*', async (route) => {
    previews++;
    expect(new URL(route.request().url()).searchParams.get('token')).toBe('invitation-in-memory');
    // Preview starts during navigation: pause before delivering the countdown response.
    if (previews === 1) await page.clock.pauseAt(clockPause);
    return previews === 1
      ? route.fulfill({
          status: 429,
          json: {
            error: {
              code: 'RATE_LIMITED',
              message: 'Too many attempts; try again later.',
              retryAfterSeconds: 3,
            },
          },
        })
      : route.fulfill({ json: { teamName: team.name, email: null, kind: 'PLAYER' } });
  });
  await page.clock.install({ time: clockStart });
  await page.goto('/register?invite=invitation-in-memory');
  await expect(page.getByRole('button', { name: 'Retry invitation check in 3s' })).toBeDisabled();
  await expect(page).toHaveURL(/\/register$/);
  await expect(
    page.getByText('Ask your coach or manager for a new invitation link.'),
  ).not.toBeVisible();
  await page.clock.fastForward(4000);
  expect(previews).toBe(1);
  await page.getByRole('button', { name: 'Retry invitation check', exact: true }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  expect(previews).toBe(2);
});

test('legacy throttling responses retain the server message without an invented countdown', async ({
  page,
}) => {
  await mockOnboarding(page);
  await page.route('**/api/v1/auth/staff-register', (route) =>
    route.fulfill({
      status: 429,
      json: { error: { code: 'RATE_LIMITED', message: 'Too many attempts; try again later.' } },
    }),
  );
  await page.goto('/signup');
  await signup(page);
  await expect(
    page.getByText('Too many attempts; try again later.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create staff account' })).toBeEnabled();
});

test('login throttling keeps credentials and requires a manual retry after the wait', async ({
  page,
}) => {
  await mockOnboarding(page);
  let attempts = 0;
  await page.route('**/api/v1/auth/staff-login', (route) => {
    attempts++;
    return route.fulfill({
      status: 429,
      json: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many attempts; try again later.',
          retryAfterSeconds: 3,
        },
      },
    });
  });
  await page.clock.install({ time: clockStart });
  await page.goto('/sign-in');
  await page.clock.pauseAt(clockPause);
  await page.getByLabel('Email address').fill(coach.email);
  await page.getByLabel('Password', { exact: true }).fill('CoachPass123!');
  const button = page.getByRole('button', { name: 'Sign in', exact: true });
  await button.click();
  // Disabled also means the request is pending; wait for the actual server countdown.
  await expect(page.getByText('Too many attempts. Try again in 3s.')).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('CoachPass123!');
  await page.clock.runFor(2000);
  await expect(page.getByText('Too many attempts. Try again in 1s.')).toBeVisible();
  await expect(button).toBeDisabled();
  await page.clock.runFor(2000);
  await expect(button).toBeEnabled();
  expect(attempts).toBe(1);
  await button.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.getByText('Too many attempts. Try again in 3s.')).toBeVisible();
});
