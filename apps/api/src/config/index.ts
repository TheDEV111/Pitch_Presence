import { isIP } from 'node:net';
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
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  QR_SIGNING_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().min(1).default('PitchPresence <onboarding@example.com>'),
  PAYSTACK_SECRET_KEY: z.string().default(''),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = schema.parse(env);
  if (config.SESSION_SECRET === config.QR_SIGNING_SECRET)
    throw new Error('Use separate authentication and QR secrets');
  if (
    config.NODE_ENV === 'production' &&
    (!config.APP_URL.startsWith('https://') ||
      !config.PAYSTACK_SECRET_KEY ||
      !config.RESEND_API_KEY)
  )
    throw new Error('Production requires HTTPS and provider credentials');
  return config;
}
