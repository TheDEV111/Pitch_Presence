import { expect, test } from 'vitest';
import { checkProductionEnv } from './check-production-env.mjs';

const env = {
  NODE_ENV: 'production',
  APP_URL: 'https://pitch.test',
  DATABASE_URL:
    'postgresql://owner:private-password@database.test:5432/postgres?sslmode=verify-full',
  SESSION_SECRET: 's'.repeat(64),
  DATA_ENCRYPTION_SECRET: 'd'.repeat(64),
  QR_SIGNING_SECRET: 'q'.repeat(64),
  RESEND_API_KEY: 're_local_fixture',
  EMAIL_FROM: 'PitchPresence <app@pitch.test>',
  PAYMENT_MODE: 'MANUAL',
};

test('production preflight validates without a database or provider connection', () => {
  expect(checkProductionEnv(env)).toEqual({ pushEnabled: false });
});

test.each([
  ['APP_URL', 'https://pitch.test/management'],
  ['APP_URL', 'https://pitch.test/?token=private'],
  ['APP_URL', 'https://localhost'],
  ['DATABASE_URL', 'postgresql://owner:private-password@database.test/postgres'],
  ['DATABASE_URL', 'malformed-private-connection'],
  ['RESEND_API_KEY', 'replace-with-resend-key'],
  ['EMAIL_FROM', 'PitchPresence <onboarding@example.com>'],
  ['QR_SIGNING_SECRET', env.DATA_ENCRYPTION_SECRET],
  ['VAPID_PRIVATE_KEY', 'private-incomplete-key'],
])('production preflight refuses unsafe %s without exposing its value', (key, value) => {
  let message = '';
  try {
    checkProductionEnv({ ...env, [key]: value });
  } catch (error) {
    message = error.message;
  }
  expect(message).not.toBe('');
  expect(message).not.toContain(value);
  expect(message).not.toContain('private-password');
  expect(message).not.toContain(env.SESSION_SECRET);
});
