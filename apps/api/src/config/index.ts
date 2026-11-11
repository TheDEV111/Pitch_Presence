import { isIP } from 'node:net';
import { createECDH } from 'node:crypto';
import { z } from 'zod';
const schema = z.object({
  TRUST_PROXY: z
    .string()
    .default('')
    .refine(
      (value) =>
        !value ||
        value.split(',').every((entry) => {
          const [ip, mask] = entry.trim().split('/');
          const version = isIP(ip ?? '');
          return (
            version !== 0 &&
            (mask === undefined ||
              (Number.isInteger(Number(mask)) &&
                Number(mask) > 0 &&
                Number(mask) <= (version === 4 ? 32 : 128)))
          );
        }),
      'Use explicit IP addresses or nonzero CIDR ranges',
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  STAGING_SUPABASE_PROJECT_REF: z.string().default(''),
  PRODUCTION_SUPABASE_PROJECT_REF: z.string().default(''),
  STAGING_EMAIL_ALLOWLIST: z.string().default(''),
  MULTI_TEAM_ENABLED: z.enum(['true', 'false']).default('false'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  DATA_ENCRYPTION_SECRET: z
    .string()
    .default('')
    .refine(
      (value) => !value || value.length >= 32,
      'Use at least 32 characters for data encryption',
    ),
  QR_SIGNING_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().min(1).default('PitchPresence <onboarding@example.com>'),
  VAPID_PUBLIC_KEY: z.string().default(''),
  VAPID_PRIVATE_KEY: z.string().default(''),
  VAPID_SUBJECT: z.string().default(''),
  PAYMENT_MODE: z.enum(['MANUAL', 'PAYSTACK']).default('MANUAL'),
  PAYSTACK_SECRET_KEY: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse({
    ...env,
    APP_ENV: env.APP_ENV ?? (env.NODE_ENV === 'production' ? 'production' : 'development'),
  });
  if (config.APP_ENV === 'staging') {
    if (
      config.NODE_ENV !== 'production' ||
      config.APP_URL !== 'https://staging.pitch-presence.kairos-devs.com' ||
      config.PAYMENT_MODE !== 'MANUAL' ||
      config.PAYSTACK_SECRET_KEY ||
      new Set([config.SESSION_SECRET, config.DATA_ENCRYPTION_SECRET, config.QR_SIGNING_SECRET])
        .size !== 3
    )
      throw new Error(
        'Staging requires its HTTPS origin, production runtime, independent secrets and manual payments',
      );
    const project = config.STAGING_SUPABASE_PROJECT_REF;
    const production = config.PRODUCTION_SUPABASE_PROJECT_REF;
    if (!/^[a-z]{20}$/.test(project) || !/^[a-z]{20}$/.test(production) || project === production)
      throw new Error(
        'Staging requires distinct staging and production Supabase project references',
      );
    let database: URL;
    try {
      database = new URL(config.DATABASE_URL);
    } catch {
      throw new Error('Staging database connection is invalid');
    }
    const roles = ['postgres', 'pitchpresence_app'];
    const direct =
      database.hostname === `db.${project}.supabase.co` && roles.includes(database.username);
    const pooled =
      /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(database.hostname) &&
      roles.some((role) => database.username === `${role}.${project}`);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.password ||
      (!direct && !pooled) ||
      (database.port && database.port !== '5432') ||
      database.pathname !== '/postgres' ||
      !['require', 'verify-ca', 'verify-full'].includes(
        database.searchParams.get('sslmode') ?? '',
      ) ||
      new Set(database.searchParams.keys()).size !== [...database.searchParams.keys()].length ||
      [...database.searchParams.keys()].some(
        (key) =>
          !['sslmode', 'connection_limit', 'pool_timeout', 'schema', 'connect_timeout'].includes(
            key,
          ),
      ) ||
      (database.searchParams.has('schema') && database.searchParams.get('schema') !== 'public')
    )
      throw new Error(
        'Staging database must match its approved Supabase project over TLS on port 5432',
      );
    const recipients = config.STAGING_EMAIL_ALLOWLIST.split(',').map((email) => email.trim());
    if (
      !recipients.length ||
      recipients.some((email) => !z.string().email().safeParse(email).success)
    )
      throw new Error('Staging requires a nonempty list of exact approved email addresses');
  }
  if (config.VAPID_PUBLIC_KEY || config.VAPID_PRIVATE_KEY || config.VAPID_SUBJECT) {
    try {
      const publicKey = Buffer.from(config.VAPID_PUBLIC_KEY, 'base64url');
      const privateKey = Buffer.from(config.VAPID_PRIVATE_KEY, 'base64url');
      const ecdh = createECDH('prime256v1');
      ecdh.setPrivateKey(privateKey);
      if (
        privateKey.length !== 32 ||
        publicKey.length !== 65 ||
        privateKey.toString('base64url') !== config.VAPID_PRIVATE_KEY ||
        publicKey.toString('base64url') !== config.VAPID_PUBLIC_KEY ||
        !ecdh.getPublicKey().equals(publicKey) ||
        !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(config.VAPID_SUBJECT)
      )
        throw new Error('Invalid push configuration');
    } catch {
      throw new Error(
        'Push notifications require a matching VAPID key pair and a mailto: or HTTPS contact',
      );
    }
  }
  if (config.SESSION_SECRET === config.QR_SIGNING_SECRET)
    throw new Error('Use separate authentication and QR secrets');
  if (
    config.NODE_ENV === 'production' &&
    (!config.APP_URL.startsWith('https://') ||
      (config.PAYMENT_MODE === 'PAYSTACK' && !config.PAYSTACK_SECRET_KEY) ||
      !config.RESEND_API_KEY ||
      !config.DATA_ENCRYPTION_SECRET ||
      config.DATA_ENCRYPTION_SECRET === config.SESSION_SECRET)
  )
    throw new Error(
      'Production requires HTTPS, email credentials, a separate data encryption secret and Paystack credentials when enabled',
    );
  config.DATA_ENCRYPTION_SECRET ||= config.SESSION_SECRET;
  return config;
}
