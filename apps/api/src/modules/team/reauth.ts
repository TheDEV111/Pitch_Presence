import argon2 from 'argon2';
import type { PrismaClient, User } from '@pitchpresence/database';
import { rateLimit, requireRule } from '../../plugins/core.js';
export async function verifyStaffPassword(db: PrismaClient, user: User, password: string) {
  await rateLimit(db, `bank-reauth:${user.id}`, 5, 900);
  const current = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  requireRule(
    current.role === 'MANAGER' &&
      current.active &&
      current.isVerified &&
      current.passwordHash &&
      (await argon2.verify(current.passwordHash, password)),
    401,
    'REAUTHENTICATION_FAILED',
    'Check your password and try again.',
  );
}
