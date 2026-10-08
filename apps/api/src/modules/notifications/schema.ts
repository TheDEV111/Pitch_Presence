import { z } from 'zod';
import { ECDH } from 'node:crypto';

// Push endpoints are supplied by a browser, but remain untrusted HTTP input.
// A closed provider allowlist prevents the worker from becoming an SSRF proxy.
export function allowedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      (['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith('.notify.windows.com'))
    );
  } catch {
    return false;
  }
}
const key = (bytes: number) =>
  z
    .string()
    .max(100)
    .refine((value) => {
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.length !== bytes || decoded.toString('base64url') !== value) return false;
      if (bytes === 65) {
        try {
          ECDH.convertKey(decoded, 'prime256v1');
        } catch {
          return false;
        }
      }
      return true;
    }, 'Invalid browser push key');
export const pushSubscriptionInput = z
  .object({
    endpoint: z.string().max(2048).refine(allowedPushEndpoint, 'Unsupported browser push provider'),
    keys: z.object({ p256dh: key(65), auth: key(16) }).strict(),
  })
  .strict();
export const pushSettingsResponse = z.object({
  available: z.boolean(),
  publicKey: z.string().nullable(),
  enabled: z.boolean(),
});
