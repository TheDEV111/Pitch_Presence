import { test, expect } from '@playwright/test';

const staging = process.env.E2E_EXPECT_STAGING === 'true';

test('environment identification and search indexing match the deployed frontend', async ({
  page,
}) => {
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Please sign in.' } },
    }),
  );
  // The landing page is indexable in production; auth pages are deliberately noindex.
  const pages = [
    { path: '/', indexableInProduction: true },
    { path: '/sign-in', indexableInProduction: false },
  ];
  for (const { path, indexableInProduction } of pages) {
    const response = await page.goto(path);
    const banner = page.getByRole('complementary', { name: 'Staging environment' });
    if (staging) {
      await expect(banner).toHaveText('STAGING — test data only');
      await expect(banner).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(banner).toBeInViewport();
      expect(response!.headers()['x-robots-tag']).toContain('noindex');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    } else {
      await expect(banner).toHaveCount(0);
      expect(response!.headers()['x-robots-tag']).toBeUndefined();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        indexableInProduction ? /^index, follow$/ : /^noindex, nofollow$/,
      );
    }
  }
});
