import type { DeviceSession, PrismaClient, User } from '@pitchpresence/database';
import type { Config } from '../../config/index.js';
import { decrypt, encrypt } from '../../infrastructure/secrets.js';
import { digest, lock, rateLimit, requireRule } from '../../plugins/core.js';
import { pushSubscriptionInput } from './schema.js';
import type { z } from 'zod';

export class NotificationService {
  constructor(
    private db: PrismaClient,
    private config: Config,
  ) {}
  async settings(session: DeviceSession) {
    const available = !!this.config.VAPID_PUBLIC_KEY;
    const subscription = await this.db.pushSubscription.findUnique({
      where: { sessionId: session.id },
    });
    return {
      available,
      publicKey: available ? this.config.VAPID_PUBLIC_KEY : null,
      enabled: available && subscription?.vapidPublicKey === this.config.VAPID_PUBLIC_KEY,
    };
  }
  async subscribe(
    user: User,
    session: DeviceSession,
    input: z.infer<typeof pushSubscriptionInput>,
  ) {
    requireRule(
      this.config.VAPID_PUBLIC_KEY,
      503,
      'PUSH_UNAVAILABLE',
      'Device notifications are not configured yet.',
    );
    await rateLimit(this.db, `push-subscribe:${user.id}`, 20, 3600);
    const endpointHash = digest(input.endpoint);
    await this.db.$transaction(async (tx) => {
      // Session revocation and registration serialize on the same row.
      await tx.$queryRaw`SELECT id FROM "DeviceSession" WHERE id=${session.id}::uuid FOR UPDATE`;
      const current = await tx.deviceSession.findUniqueOrThrow({ where: { id: session.id } });
      requireRule(
        !current.revokedAt && current.expiresAt > new Date(),
        401,
        'AUTHENTICATION_REQUIRED',
        'Please sign in.',
      );
      await lock(tx, 'User', user.id);
      const actor = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      requireRule(
        actor.active &&
          actor.isVerified &&
          actor.role === 'MANAGER' &&
          actor.teamId === user.teamId,
        403,
        'FORBIDDEN',
        'Only verified team staff can receive receipt notifications.',
      );
      const previous = await tx.pushSubscription.findUnique({ where: { endpointHash } });
      if (previous) {
        const saved = pushSubscriptionInput.parse(
          JSON.parse(decrypt(this.config.DATA_ENCRYPTION_SECRET, previous.encryptedSubscription)),
        );
        requireRule(
          saved.keys.auth === input.keys.auth && saved.keys.p256dh === input.keys.p256dh,
          409,
          'PUSH_SUBSCRIPTION_CONFLICT',
          'Reset notification permission in your browser and try again.',
        );
        if (
          previous.sessionId === session.id &&
          previous.vapidPublicKey === this.config.VAPID_PUBLIC_KEY
        )
          return;
      }
      // New consent may transfer a shared browser from an old signed-in account.
      // New IDs ensure old queued jobs cannot notify the new owner.
      await tx.pushSubscription.deleteMany({
        where: { OR: [{ endpointHash }, { sessionId: session.id }] },
      });
      await tx.pushSubscription.create({
        data: {
          teamId: user.teamId!,
          userId: user.id,
          sessionId: session.id,
          endpointHash,
          encryptedSubscription: encrypt(this.config.DATA_ENCRYPTION_SECRET, JSON.stringify(input)),
          vapidPublicKey: this.config.VAPID_PUBLIC_KEY,
        },
      });
    });
    return { enabled: true };
  }
  async unsubscribe(session: DeviceSession) {
    await this.db.pushSubscription.deleteMany({ where: { sessionId: session.id } });
    return { enabled: false };
  }
}
