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
test.beforeEach(async ({ page }) => {
  await page.route('https://images.pexels.com/**', (route) => route.abort());
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
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
