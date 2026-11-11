import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('refuses a staging frontend build targeting a production or missing API', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
  for (const api of ['', 'https://pitch-presence-api.futuredevs.com']) {
    vi.stubEnv('API_URL', api);
    vi.resetModules();
    await expect(import('../next.config')).rejects.toThrow(
      'Staging frontend requires its staging API_URL',
    );
  }
});

it('uses the staging API and applies noindex headers to all staging paths', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'staging');
  vi.stubEnv('API_URL', 'https://staging-api.kairos-devs.com');
  const { default: config } = await import('../next.config');
  expect(await config.rewrites!()).toEqual([
    { source: '/api/:path*', destination: 'https://staging-api.kairos-devs.com/api/:path*' },
  ]);
  const headers = await config.headers!();
  expect(headers.find((entry) => entry.source === '/:path*')?.headers).toContainEqual({
    key: 'X-Robots-Tag',
    value: 'noindex, nofollow, noarchive',
  });
});

it('keeps the existing production frontend destination and indexing headers unchanged', async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'production');
  vi.stubEnv('API_URL', 'https://pitch-presence-api.futuredevs.com');
  const { default: config } = await import('../next.config');
  expect(await config.rewrites!()).toEqual([
    { source: '/api/:path*', destination: 'https://pitch-presence-api.futuredevs.com/api/:path*' },
  ]);
  expect(
    (await config.headers!())
      .flatMap((entry) => entry.headers)
      .some((header) => header.key === 'X-Robots-Tag'),
  ).toBe(false);
});
