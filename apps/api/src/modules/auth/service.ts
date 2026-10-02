import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import type { OtpPurpose, PrismaClient, User } from '@pitchpresence/database';
import type { RegisterInput } from '@pitchpresence/shared';
import type { Config } from '../../config/index.js';
import {
  AppError,
  audit,
  digest,
  keyedDigest,
  lock,
  randomToken,
  rateLimit,
  requireRule,
  safeEqual,
} from '../../plugins/core.js';
import { encrypt } from '../../infrastructure/secrets.js';
export const publicUser = (u: User) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  isVerified: u.isVerified,
  active: u.active,
  activatedAt: u.activatedAt,
  teamId: u.teamId,
});
export class AuthService {
  private dummyHash = argon2.hash(randomToken(), { type: argon2.argon2id });
  constructor(
    private db: PrismaClient,
    private config: Config,
  ) {}
  async register(input: RegisterInput, ip: string) {
    await rateLimit(this.db, `register:${ip}`, 10, 3600);
    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    const user = await this.db.$transaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: digest(input.invitationToken) },
      });
      requireRule(invitation, 422, 'INVITATION_INVALID', 'The invitation is unavailable.');
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${invitation.id}::uuid FOR UPDATE`;
      const current = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      requireRule(
        !current.revokedAt && current.kind === 'PLAYER' && current.expiresAt > new Date(),
        422,
        'INVITATION_INVALID',
        'The invitation has expired or was revoked.',
      );
      return tx.user.create({
        data: { name: input.name, email: input.email, pinHash, teamId: current.teamId },
      });
    });
    await this.issueOtp(user.email, 'VERIFY_EMAIL');
    return { message: 'Check your email for a verification code.' };
  }
  async staffRegister(
    input: { name: string; email: string; password: string; invitationToken?: string },
    ip: string,
  ) {
    await rateLimit(this.db, `register:${ip}`, 10, 3600);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await this.db.$transaction(async (tx) => {
      let invitationId: string | undefined;
      if (input.invitationToken) {
        const invitation = await tx.invitation.findUnique({
          where: { tokenHash: digest(input.invitationToken) },
        });
        requireRule(
          invitation &&
            invitation.kind === 'MANAGER' &&
            invitation.email === input.email &&
            !invitation.revokedAt &&
            !invitation.acceptedAt &&
            invitation.expiresAt > new Date(),
          422,
          'INVITATION_INVALID',
          'Ask your team for a new staff invitation.',
        );
        invitationId = invitation.id;
      }
      return tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: 'MANAGER',
          passwordHash,
          pendingInvitationId: invitationId,
        },
      });
    });
    await this.issueOtp(user.email, 'VERIFY_EMAIL');
    return { message: 'Check your email for a verification code.' };
  }
  async context(user: User) {
    const team = user.teamId
      ? await this.db.team.findUnique({
          where: { id: user.teamId },
          select: { id: true, name: true, createdAt: true },
        })
      : null;
    const invitation = user.pendingInvitationId
      ? await this.db.invitation.findUnique({ where: { id: user.pendingInvitationId } })
      : null;
    const invitedTeam = invitation
      ? await this.db.team.findUnique({ where: { id: invitation.teamId }, select: { name: true } })
      : null;
    const pendingInvitation =
      invitation && invitedTeam
        ? {
            teamName: invitedTeam.name,
            email: invitation.email!,
            expiresAt: invitation.expiresAt,
            available:
              !invitation.revokedAt && !invitation.acceptedAt && invitation.expiresAt > new Date(),
          }
        : null;
    return {
      user: publicUser(user),
      team,
      pendingInvitation,
      nextStep: user.teamId
        ? ('READY' as const)
        : user.pendingInvitationId
          ? ('ACCEPT_INVITATION' as const)
          : ('CREATE_TEAM' as const),
    };
  }
  async acceptInvitation(userId: string, token?: string) {
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'User', userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      requireRule(
        user.role === 'MANAGER' && user.isVerified && user.active,
        403,
        'FORBIDDEN',
        'A verified staff account is required.',
      );
      const invitation = token
        ? await tx.invitation.findUnique({ where: { tokenHash: digest(token) } })
        : user.pendingInvitationId
          ? await tx.invitation.findUnique({ where: { id: user.pendingInvitationId } })
          : null;
      requireRule(
        invitation && invitation.kind === 'MANAGER' && invitation.email === user.email,
        422,
        'INVITATION_INVALID',
        'This invitation does not match your staff account.',
      );
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${invitation.id}::uuid FOR UPDATE`;
      const current = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      if (current.acceptedBy === userId && user.teamId === current.teamId) return publicUser(user);
      requireRule(
        !user.teamId,
        409,
        'TEAM_ALREADY_ASSIGNED',
        'This account already belongs to a team.',
      );
      requireRule(
        !current.revokedAt && !current.acceptedAt && current.expiresAt > new Date(),
        422,
        'INVITATION_INVALID',
        'Ask your team for a new staff invitation.',
      );
      const updated = await tx.user.update({
        where: { id: userId },
        data: { teamId: current.teamId, pendingInvitationId: null },
      });
      await tx.invitation.update({
        where: { id: current.id },
        data: { acceptedAt: new Date(), acceptedBy: userId },
      });
      await audit(tx, userId, 'STAFF_JOINED', current.teamId);
      return publicUser(updated);
    });
  }
  async issueOtp(email: string, purpose: OtpPurpose) {
    // Rate limits apply to nonexistent accounts too, avoiding enumeration through timing/state.
    const key = keyedDigest(this.config.SESSION_SECRET, email);
    await rateLimit(this.db, `otp-cooldown:${key}`, 1, 60);
    await rateLimit(this.db, `otp-hour:${key}`, 5, 3600);
    const user = await this.db.user.findUnique({ where: { email } });
    if (
      !user ||
      (purpose === 'VERIFY_EMAIL' && user.isVerified) ||
      (purpose === 'PIN_RESET' && user.role !== 'PLAYER') ||
      (purpose === 'PASSWORD_RESET' && user.role !== 'MANAGER')
    )
      return { message: 'If eligible, a code will be sent.' };
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      await tx.verificationToken.updateMany({
        where: { userId: user.id, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const challenge = await tx.verificationToken.create({
        data: {
          userId: user.id,
          purpose,
          otpHash: keyedDigest(this.config.SESSION_SECRET, `${user.id}:${purpose}:${otp}`),
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.backgroundJob.create({
        data: {
          kind: 'EMAIL_OTP',
          teamId: user.teamId,
          deduplicationKey: `otp:${challenge.id}`,
          payload: {
            userId: user.id,
            challengeId: challenge.id,
            email: user.email,
            purpose,
            encryptedOtp: encrypt(this.config.SESSION_SECRET, otp),
          },
        },
      });
    });
    return { message: 'If eligible, a code will be sent.' };
  }
  async consumeOtp(email: string, otp: string, purpose: OtpPurpose, pin?: string) {
    const user = await this.db.user.findUnique({ where: { email } });
    requireRule(user, 422, 'OTP_INVALID', 'The code is invalid or expired.');
    const changing = purpose === 'PIN_RESET' || purpose === 'PASSWORD_RESET';
    requireRule(
      !changing || (purpose === 'PIN_RESET' ? user.role === 'PLAYER' : user.role === 'MANAGER'),
      422,
      'OTP_INVALID',
      'The code is invalid or expired.',
    );
    const credentialHash = pin ? await argon2.hash(pin, { type: argon2.argon2id }) : undefined;
    const result = await this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      const token = await tx.verificationToken.findFirst({
        where: { userId: user.id, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!token || token.expiresAt <= new Date() || token.attempts >= 5) return null;
      const valid = safeEqual(
        token.otpHash,
        keyedDigest(this.config.SESSION_SECRET, `${user.id}:${purpose}:${otp}`),
      );
      await tx.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 }, ...(valid ? { consumedAt: new Date() } : {}) },
      });
      if (!valid) return null;
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (changing && current.isVerified && !current.active) return null;
      if (credentialHash)
        await tx.deviceSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      const verified = await tx.user.update({
        where: { id: user.id },
        data: {
          ...(credentialHash
            ? purpose === 'PASSWORD_RESET'
              ? { passwordHash: credentialHash }
              : { pinHash: credentialHash }
            : {}),
          ...(!current.isVerified
            ? { isVerified: true, active: true, activatedAt: new Date() }
            : {}),
        },
      });
      await audit(tx, user.id, changing ? purpose : 'EMAIL_VERIFIED', user.id);
      return verified;
    });
    requireRule(result, 422, 'OTP_INVALID', 'The code is invalid or expired.');
    if (changing) return { user: publicUser(result) };
    return this.createSession(result);
  }
  async login(email: string, pin: string, ip: string, role: 'PLAYER' | 'MANAGER' = 'PLAYER') {
    await rateLimit(this.db, `login-ip:${ip}`, 30, 900);
    const key = `login-account:${keyedDigest(this.config.SESSION_SECRET, email)}`;
    const blocked = await this.db.rateLimitBucket.findUnique({ where: { key } });
    requireRule(
      !blocked || blocked.expiresAt <= new Date() || blocked.count < 5,
      429,
      'RATE_LIMITED',
      'Too many attempts; try again later.',
    );
    const user = await this.db.user.findUnique({ where: { email } });
    // A fixed dummy hash maintains the expensive verification path for unknown email addresses.
    const hash =
      (role === 'MANAGER' ? user?.passwordHash : user?.pinHash) ?? (await this.dummyHash);
    const valid = await argon2.verify(hash, pin);
    if (!user || user.role !== role || !valid || !user.isVerified || !user.active) {
      await rateLimit(this.db, key, 5, 900);
      throw new AppError(
        401,
        'LOGIN_FAILED',
        'Email or credentials are incorrect, or the account is unavailable.',
      );
    }
    await this.db.rateLimitBucket.deleteMany({ where: { key } });
    return this.createSession(user);
  }
  async createSession(user: User) {
    const token = randomToken();
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      requireRule(
        current.active && current.isVerified,
        403,
        'ACCOUNT_UNAVAILABLE',
        'The account is unavailable.',
      );
      await tx.deviceSession.create({
        data: {
          userId: user.id,
          tokenHash: digest(token),
          expiresAt: new Date(Date.now() + 30 * 86400_000),
        },
      });
    });
    return {
      token,
      csrfToken: keyedDigest(this.config.SESSION_SECRET, `csrf:${token}`),
      ...(await this.context(user)),
    };
  }
  async resolve(token: string | undefined) {
    if (!token) return null;
    const session = await this.db.deviceSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.active ||
      !session.user.isVerified
    )
      return null;
    if (Date.now() - session.lastUsedAt.getTime() > 60_000)
      await this.db.deviceSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      });
    return session;
  }
}
