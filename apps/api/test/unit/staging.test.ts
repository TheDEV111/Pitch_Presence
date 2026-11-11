import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config/index.js';
import { createProviders } from '../../src/infrastructure/providers.js';
import { assertStagingRecipient } from '../../src/infrastructure/staging-email.js';
import { stagingEnv } from '../fixtures/staging.js';

afterEach(() => vi.unstubAllGlobals());

it('defaults existing environments compatibly and accepts an isolated staging configuration', () => {
  const env = { ...stagingEnv, APP_ENV: undefined };
  expect(loadConfig(env).APP_ENV).toBe('production');
  expect(loadConfig({ ...env, NODE_ENV: 'test' }).APP_ENV).toBe('development');
  expect(loadConfig(stagingEnv).APP_ENV).toBe('staging');
  expect(
    loadConfig({
      ...stagingEnv,
      DATABASE_URL: `postgresql://postgres:password@db.${stagingEnv.STAGING_SUPABASE_PROJECT_REF}.supabase.co:5432/postgres?sslmode=verify-full`,
    }).APP_ENV,
  ).toBe('staging');
});

it.each([
  { APP_URL: 'https://pitch-presence.kairos-devs.com' },
  { APP_URL: `${stagingEnv.APP_URL}/` },
  { NODE_ENV: 'development' },
  { PAYMENT_MODE: 'PAYSTACK' },
  { PAYSTACK_SECRET_KEY: 'sk_live_test_fixture' },
  { STAGING_SUPABASE_PROJECT_REF: stagingEnv.PRODUCTION_SUPABASE_PROJECT_REF },
  { PRODUCTION_SUPABASE_PROJECT_REF: '' },
  { DATABASE_URL: stagingEnv.DATABASE_URL.replace('s'.repeat(20), 'p'.repeat(20)) },
  {
    DATABASE_URL: stagingEnv.DATABASE_URL.replace(
      'pooler.supabase.com',
      'pooler.supabase.com.attacker.test',
    ),
  },
  { DATABASE_URL: stagingEnv.DATABASE_URL.replace(':5432/', ':6543/') },
  { DATABASE_URL: stagingEnv.DATABASE_URL.replace('sslmode=require', 'sslmode=disable') },
  { DATABASE_URL: `${stagingEnv.DATABASE_URL}&host=production.test` },
  { DATABASE_URL: `${stagingEnv.DATABASE_URL}&sslmode=disable` },
  { DATABASE_URL: `${stagingEnv.DATABASE_URL}&schema=other` },
  { STAGING_EMAIL_ALLOWLIST: '' },
  { STAGING_EMAIL_ALLOWLIST: '*@example.test' },
  { STAGING_EMAIL_ALLOWLIST: 'coach@example.test,' },
  { DATA_ENCRYPTION_SECRET: stagingEnv.QR_SIGNING_SECRET },
])('refuses unsafe staging configuration without connecting: %j', (override) => {
  expect(() => loadConfig({ ...stagingEnv, ...override })).toThrow();
});

it('rejects mismatched destinations before the entrypoint can invoke Prisma migrations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pitchpresence-preflight-'));
  const log = join(directory, 'output');
  const fd = openSync(log, 'w');
  try {
    const result = spawnSync('sh', ['scripts/start-api.sh'], {
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        ...stagingEnv,
        DATABASE_URL: stagingEnv.DATABASE_URL.replace('s'.repeat(20), 'p'.repeat(20)),
      },
      timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    const output = readFileSync(log, 'utf8');
    expect(output).not.toContain('Running Prisma migrations');
    expect(output).toContain('No migration was started');
    expect(output).not.toContain('test-only-password');
  } finally {
    closeSync(fd);
    rmSync(directory, { recursive: true, force: true });
  }
});

it('checks exact addresses case-insensitively without changing production email behavior', () => {
  const config = loadConfig(stagingEnv);
  expect(() => assertStagingRecipient(config, ' COACH@EXAMPLE.TEST ')).not.toThrow();
  expect(() => assertStagingRecipient(config, 'coach+other@example.test')).toThrow();
  expect(() =>
    assertStagingRecipient({ ...config, APP_ENV: 'production' }, 'anyone@example.test'),
  ).not.toThrow();
});

it('blocks every email provider method before network access and prefixes allowed mail', async () => {
  const fetch = vi.fn().mockImplementation(async () => new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const providers = createProviders(loadConfig(stagingEnv));
  const forbidden = 'unapproved@example.test';
  for (const send of [
    () => providers.sendOtp(forbidden, '123456', 'VERIFY_EMAIL', 'otp-test'),
    () =>
      providers.sendStaffInvitation(forbidden, `${stagingEnv.APP_URL}/staff/join`, 'invite-test'),
    () => providers.sendBankNotice(forbidden, 'Account change', 'Test notice', 'bank-test'),
  ])
    await expect(send()).rejects.toMatchObject({ code: 'STAGING_EMAIL_NOT_ALLOWED', status: 403 });
  expect(fetch).not.toHaveBeenCalled();
  await providers.sendOtp('player@example.test', '123456', 'VERIFY_EMAIL', 'otp-test');
  await providers.sendStaffInvitation(
    'coach@example.test',
    `${stagingEnv.APP_URL}/staff/join`,
    'invite-test',
  );
  await providers.sendBankNotice(
    'coach@example.test',
    'Account change',
    'Test notice',
    'bank-test',
  );
  for (const [, options] of fetch.mock.calls) {
    expect(JSON.parse(options.body).subject).toMatch(/^\[STAGING\] /);
    expect(JSON.parse(options.body).to).not.toContain(forbidden);
  }
});
