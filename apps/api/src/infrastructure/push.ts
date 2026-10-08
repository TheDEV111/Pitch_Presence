import webpush from 'web-push';
import type { Config } from '../config/index.js';
import { digest } from '../plugins/core.js';
import { pushSubscriptionInput } from '../modules/notifications/schema.js';
import type { z } from 'zod';

export type PushSender = (
  subscription: z.infer<typeof pushSubscriptionInput>,
  payload: { receiptId: string; url: string },
) => Promise<'sent' | 'gone'>;

export function createPushSender(config: Config): PushSender {
  return async (subscription, payload) => {
    pushSubscriptionInput.parse(subscription);
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), {
        vapidDetails: {
          subject: config.VAPID_SUBJECT,
          publicKey: config.VAPID_PUBLIC_KEY,
          privateKey: config.VAPID_PRIVATE_KEY,
        },
        contentEncoding: 'aes128gcm',
        TTL: 3600,
        timeout: 10000,
        topic: digest(payload.receiptId).slice(0, 32),
      });
      return 'sent';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      // Provider exceptions include endpoints and response headers: never log or persist them.
      throw new Error('Push provider unavailable');
    }
  };
}
