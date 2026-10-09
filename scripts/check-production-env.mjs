import { pathToFileURL } from 'node:url';
import { loadConfig } from '../apps/api/dist/config/index.js';

const placeholder = /replace-with|example\.com|POOLER_HOST|postgres\.PROJECT|onboarding@example/i;

export function checkProductionEnv(env) {
  const issues = [];
  let config;
  try {
    config = loadConfig(env);
  } catch {
    // Config validation may contain supplied values. Never print its raw exception.
    throw new Error('Backend configuration is invalid; check the environment reference.');
  }
  if (config.NODE_ENV !== 'production') issues.push('NODE_ENV must be production');
  if (config.PAYMENT_MODE !== 'MANUAL') issues.push('This handoff uses PAYMENT_MODE=MANUAL');
  for (const key of [
    'APP_URL',
    'DATABASE_URL',
    'SESSION_SECRET',
    'DATA_ENCRYPTION_SECRET',
    'QR_SIGNING_SECRET',
    'RESEND_API_KEY',
    'EMAIL_FROM',
  ]) {
    if (placeholder.test(config[key])) issues.push(`${key} still contains a template value`);
  }
  const origin = new URL(config.APP_URL);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  )
    issues.push('APP_URL must be the public HTTPS frontend origin without a path');
  try {
    const database = new URL(config.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.password)
      issues.push('DATABASE_URL must be a PostgreSQL URI with credentials');
    if (!['require', 'verify-ca', 'verify-full'].includes(database.searchParams.get('sslmode')))
      issues.push('DATABASE_URL must enable TLS for Supabase');
  } catch {
    issues.push('DATABASE_URL must be a valid PostgreSQL URI');
  }
  if (
    new Set([config.SESSION_SECRET, config.DATA_ENCRYPTION_SECRET, config.QR_SIGNING_SECRET])
      .size !== 3
  )
    issues.push('Authentication, data encryption and QR secrets must be independent');
  if (issues.length) throw new Error(issues.join('\n'));
  return { pushEnabled: Boolean(config.VAPID_PUBLIC_KEY) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = checkProductionEnv(process.env);
    console.log(
      `Production environment validation passed. Device push: ${result.pushEnabled ? 'configured' : 'disabled'}. No network connectivity or delivery was tested.`,
    );
  } catch (error) {
    console.error(`Production environment validation failed:\n${error.message}`);
    process.exitCode = 1;
  }
}
