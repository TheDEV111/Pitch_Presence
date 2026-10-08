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
  const config = schema.parse(env);
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
