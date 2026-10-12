import { randomInt } from 'node:crypto';
import argon2 from 'argon2';
import { Prisma, type OtpPurpose, type PrismaClient, type User } from '@pitchpresence/database';
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
  removedAt: u.removedAt,
  activatedAt: u.activatedAt,
  teamId: u.teamId,
});
export class AuthService {
  private dummyHash = argon2.hash(randomToken(), { type: argon2.argon2id });
  constructor(
    private db: PrismaClient,
    private config: Config,
  ) {}
  private async registrationLimits(email: string, ip: string, role: 'PLAYER' | 'MANAGER') {
    await rateLimit(this.db, `register-v2:${role}:${ip}`, role === 'PLAYER' ? 120 : 30, 3600);
    await rateLimit(
      this.db,
      `register-email:${keyedDigest(this.config.SESSION_SECRET, email.trim().toLowerCase())}`,
      5,
      900,
    );
  }
  async register(input: RegisterInput, ip: string) {
    await this.registrationLimits(input.email, ip, 'PLAYER');
    const pinHash = await argon2.hash(input.pin, { type: argon2.argon2id });
    try {
      await this.db.$transaction(async (tx) => {
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
        requireRule(
          !(await tx.account.findUnique({ where: { email: input.email } })),
          409,
          'ACCOUNT_EXISTS',
          'This email already has an account. Sign in to accept this team invitation.',
        );
        const account = await tx.account.create({ data: { email: input.email, pinHash } });
        const user = await tx.user.create({
          data: {
            accountId: account.id,
            name: input.name,
            email: input.email,
            pinHash,
            teamId: current.teamId,
          },
        });
        await this.otpLimits(tx, user.email);
        await this.queueOtp(tx, user, 'VERIFY_EMAIL');
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(
          409,
          'ACCOUNT_EXISTS',
          'This email already has an account. Sign in to accept this team invitation.',
        );
      throw error;
    }
    return { message: 'Check your email for a verification code.', resendAfterSeconds: 60 };
  }
  async staffRegister(
    input: { name: string; email: string; password: string; invitationToken?: string },
    ip: string,
  ) {
    await this.registrationLimits(input.email, ip, 'MANAGER');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      return await this.db.$transaction(async (tx) => {
        const identity = await tx.account.findUnique({ where: { email: input.email } });
        const existing = identity
          ? await tx.user.findFirst({
              where: { accountId: identity.id, role: 'MANAGER' },
              orderBy: { createdAt: 'asc' },
            })
          : null;
        requireRule(
          !identity || existing,
          409,
          'ACCOUNT_EXISTS',
          'This email already has an account. Sign in to accept the invitation.',
        );
        if (existing) {
          await lock(tx, 'User', existing.id);
          const current = await tx.user.findUniqueOrThrow({ where: { id: existing.id } });
          requireRule(
            current.role === 'MANAGER' &&
              !current.isVerified &&
              current.passwordHash &&
              (await argon2.verify(current.passwordHash, input.password)),
            409,
            'ACCOUNT_EXISTS',
            'An account already uses this email. Sign in or continue email verification.',
          );
          // A retry must not replace credentials, names or invitation membership.
          const challenge = await tx.verificationToken.findFirst({
            where: {
              userId: current.id,
              purpose: 'VERIFY_EMAIL',
              consumedAt: null,
              attempts: { lt: 5 },
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          });
          const job = challenge
            ? await tx.backgroundJob.findUnique({
                where: { deduplicationKey: `otp:${challenge.id}` },
              })
            : null;
          if (!challenge || !job || job.failedAt) {
            await this.otpLimits(tx, current.email);
            await this.queueOtp(tx, current, 'VERIFY_EMAIL');
          }
          const bucket = await tx.rateLimitBucket.findUnique({
            where: {
              key: `otp-cooldown:${keyedDigest(this.config.SESSION_SECRET, current.email)}`,
            },
          });
          return {
            message: 'Continue with your latest email code, or request a new one.',
            resendAfterSeconds: Math.max(
              0,
              Math.min(60, Math.ceil(((bucket?.expiresAt.getTime() ?? 0) - Date.now()) / 1000)),
            ),
          };
        }
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
        const account = await tx.account.create({ data: { email: input.email, passwordHash } });
        const user = await tx.user.create({
          data: {
            accountId: account.id,
            name: input.name,
            email: input.email,
            role: 'MANAGER',
            passwordHash,
            pendingInvitationId: invitationId,
          },
        });
        await this.otpLimits(tx, user.email);
        await this.queueOtp(tx, user, 'VERIFY_EMAIL');
        return { message: 'Check your email for a verification code.', resendAfterSeconds: 60 };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppError(
          409,
          'ACCOUNT_EXISTS',
          'An account already uses this email. Sign in or continue email verification.',
        );
      throw error;
    }
  }
  async context(user: User, authMethod = user.role === 'MANAGER' ? 'PASSWORD' : 'PIN') {
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
    const account = await this.db.account.findUniqueOrThrow({ where: { id: user.accountId } });
    const memberships = await this.db.user.findMany({
      where: { accountId: user.accountId, teamId: { not: null } },
      include: { team: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return {
      user: publicUser(user),
      authMethod,
      hasPlayerPin: !!account.pinHash,
      memberships: memberships.map((m) => ({
        id: m.id,
        teamId: m.teamId!,
        teamName: m.team!.name,
        role: m.role,
        active: m.active,
        removedAt: m.removedAt,
      })),
      team,
      pendingInvitation,
      nextStep: user.teamId
        ? ('READY' as const)
        : user.pendingInvitationId
          ? ('ACCEPT_INVITATION' as const)
          : ('CREATE_TEAM' as const),
    };
  }
  async acceptInvitation(userId: string, token?: string, authMethod?: string, pin?: string) {
    return this.db.$transaction(async (tx) => {
      const initial = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      await lock(tx, 'Account', initial.accountId);
      await lock(tx, 'User', userId);
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      requireRule(
        user.isVerified && user.active && !user.removedAt,
        403,
        'FORBIDDEN',
        'A verified active account is required.',
      );
      const invitation = token
        ? await tx.invitation.findUnique({ where: { tokenHash: digest(token) } })
        : user.pendingInvitationId
          ? await tx.invitation.findUnique({ where: { id: user.pendingInvitationId } })
          : null;
      requireRule(
        invitation && (invitation.kind === 'PLAYER' || invitation.email === user.email),
        422,
        'INVITATION_INVALID',
        'This invitation does not match your account.',
      );
      await tx.$queryRaw`SELECT id FROM "Invitation" WHERE id=${invitation.id}::uuid FOR UPDATE`;
      const current = await tx.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      const previous = await tx.user.findUnique({
        where: { accountId_teamId: { accountId: user.accountId, teamId: current.teamId } },
      });
      if (
        previous &&
        current.kind === previous.role &&
        !previous.removedAt &&
        previous.active &&
        (!current.acceptedAt || current.acceptedBy === previous.id) &&
        !current.revokedAt &&
        current.expiresAt > new Date()
      )
        return previous;
      requireRule(
        !previous,
        409,
        'MEMBERSHIP_EXISTS',
        'This account already has a membership in this team. Contact the team manager.',
      );
      requireRule(
        !current.revokedAt && !current.acceptedAt && current.expiresAt > new Date(),
        422,
        'INVITATION_INVALID',
        'Ask your team for a new invitation.',
      );
      requireRule(
        !user.teamId || this.config.MULTI_TEAM_ENABLED === 'true',
        409,
        'MULTI_TEAM_DISABLED',
        'Joining additional teams is not enabled yet.',
      );
      const account = await tx.account.findUniqueOrThrow({ where: { id: user.accountId } });
      if (current.kind === 'MANAGER')
        requireRule(
          (authMethod ?? (user.role === 'MANAGER' ? 'PASSWORD' : 'PIN')) === 'PASSWORD' &&
            account.passwordHash,
          403,
          'PASSWORD_REQUIRED',
          'Sign in with your password before joining as team staff. You can set a password through email recovery.',
        );
      let pinHash = account.pinHash;
      if (current.kind === 'PLAYER' && !pinHash) {
        requireRule(pin, 422, 'PIN_REQUIRED', 'Choose a four-digit PIN for player access.');
        pinHash = await argon2.hash(pin, { type: argon2.argon2id });
        await tx.account.update({ where: { id: account.id }, data: { pinHash } });
      }
      const data = {
        teamId: current.teamId,
        role: current.kind,
        pinHash: current.kind === 'PLAYER' ? pinHash : null,
        passwordHash: current.kind === 'MANAGER' ? account.passwordHash : null,
        isVerified: true,
        active: true,
        activatedAt: new Date(),
        pendingInvitationId: null,
      };
      const updated =
        !user.teamId && user.role === current.kind
          ? await tx.user.update({ where: { id: userId }, data })
          : await tx.user.create({
              data: { ...data, name: user.name, email: account.email, accountId: account.id },
            });
      if (current.kind === 'MANAGER')
        await tx.invitation.update({
          where: { id: current.id },
          data: { acceptedAt: new Date(), acceptedBy: updated.id },
        });
      await audit(
        tx,
        updated.id,
        current.kind === 'MANAGER' ? 'STAFF_JOINED' : 'PLAYER_JOINED',
        current.teamId,
        undefined,
        undefined,
        undefined,
        current.teamId,
      );
      return updated;
    });
  }
  async verifyPassword(accountId: string, password?: string) {
    await rateLimit(this.db, `membership-step-up:${accountId}`, 5, 900);
    const account = await this.db.account.findUniqueOrThrow({ where: { id: accountId } });
    requireRule(
      password && account.passwordHash && (await argon2.verify(account.passwordHash, password)),
      403,
      'PASSWORD_REQUIRED',
      'Enter your account password. If you have no password, set one through email recovery.',
    );
  }
  async switchMembership(user: User, membershipId: string, authMethod: string, password?: string) {
    const target = await this.db.user.findFirst({
      where: { id: membershipId, accountId: user.accountId },
    });
    requireRule(target, 404, 'NOT_FOUND', 'Team membership unavailable.');
    if (target.role === 'MANAGER' && authMethod !== 'PASSWORD') {
      await this.verifyPassword(user.accountId, password);
      authMethod = 'PASSWORD';
    }
    return this.createSession(target, authMethod);
  }
  private async otpLimits(db: PrismaClient | Prisma.TransactionClient, email: string) {
    // Rate limits apply to nonexistent accounts too, avoiding enumeration through timing/state.
    const key = keyedDigest(this.config.SESSION_SECRET, email);
    await rateLimit(db, `otp-cooldown:${key}`, 1, 60);
    await rateLimit(db, `otp-hour:${key}`, 5, 3600);
  }
  private async queueOtp(tx: Prisma.TransactionClient, user: User, purpose: OtpPurpose) {
    await tx.verificationToken.updateMany({
      where: { user: { accountId: user.accountId }, purpose, consumedAt: null },
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
  }
  private async otpUser(email: string, purpose: OtpPurpose) {
    return this.db.user.findFirst({
      where: {
        email,
        removedAt: null,
        ...(purpose === 'PIN_RESET' ? { role: 'PLAYER' as const } : {}),
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }
  async issueOtp(email: string, purpose: OtpPurpose) {
    await this.otpLimits(this.db, email);
    const user = await this.otpUser(email, purpose);
    if (!user || (purpose === 'VERIFY_EMAIL' && user.isVerified))
      return { message: 'If eligible, a code will be sent.' };
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'Account', user.accountId);
      await lock(tx, 'User', user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      if (!current.removedAt && (purpose !== 'VERIFY_EMAIL' || !current.isVerified))
        await this.queueOtp(tx, current, purpose);
    });
    return { message: 'If eligible, a code will be sent.' };
  }
  async consumeOtp(email: string, otp: string, purpose: OtpPurpose, credential?: string) {
    const account = await this.db.account.findUnique({ where: { email } });
    requireRule(account, 422, 'OTP_INVALID', 'The code is invalid or expired.');
    const changing = purpose === 'PIN_RESET' || purpose === 'PASSWORD_RESET';
    const credentialHash = credential
      ? await argon2.hash(credential, { type: argon2.argon2id })
      : undefined;
    const result = await this.db.$transaction(async (tx) => {
      await lock(tx, 'Account', account.id);
      const token = await tx.verificationToken.findFirst({
        where: { user: { accountId: account.id }, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!token || token.expiresAt <= new Date() || token.attempts >= 5) return null;
      const user = await tx.user.findUniqueOrThrow({ where: { id: token.userId } });
      await lock(tx, 'User', user.id);
      const valid = safeEqual(
        token.otpHash,
        keyedDigest(this.config.SESSION_SECRET, `${user.id}:${purpose}:${otp}`),
      );
      await tx.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 }, ...(valid ? { consumedAt: new Date() } : {}) },
      });
      if (
        !valid ||
        user.removedAt ||
        (changing && user.isVerified && !user.active) ||
        (purpose === 'PIN_RESET' && user.role !== 'PLAYER')
      )
        return null;
      if (credentialHash) {
        await tx.account.update({
          where: { id: account.id },
          data:
            purpose === 'PASSWORD_RESET'
              ? { passwordHash: credentialHash }
              : { pinHash: credentialHash },
        });
        await tx.user.updateMany({
          where: {
            accountId: account.id,
            role: purpose === 'PASSWORD_RESET' ? 'MANAGER' : 'PLAYER',
          },
          data:
            purpose === 'PASSWORD_RESET'
              ? { passwordHash: credentialHash }
              : { pinHash: credentialHash },
        });
        await tx.deviceSession.updateMany({
          where: { user: { accountId: account.id }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.pushSubscription.deleteMany({ where: { user: { accountId: account.id } } });
      }
      if (!account.isVerified) {
        await tx.account.update({ where: { id: account.id }, data: { isVerified: true } });
        await tx.user.updateMany({
          where: { accountId: account.id, isVerified: false, removedAt: null },
          data: { isVerified: true, active: true, activatedAt: new Date() },
        });
      }
      const verified = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
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
    if (blocked && blocked.expiresAt > new Date() && blocked.count >= 5)
      throw new AppError(
        429,
        'RATE_LIMITED',
        'Too many attempts; try again later.',
        Math.max(1, Math.ceil((blocked.expiresAt.getTime() - Date.now()) / 1000)),
      );
    const account = await this.db.account.findUnique({ where: { email } });
    const profiles = account
      ? await this.db.user.findMany({
          where: { accountId: account.id },
          orderBy: [{ active: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        })
      : [];
    const user =
      profiles.find((p) => p.role === role && !p.removedAt && p.active) ??
      profiles.find((p) => p.role === role) ??
      (role === 'MANAGER' && account?.passwordHash
        ? profiles.find((p) => !p.removedAt && p.active)
        : undefined);
    // A fixed dummy hash maintains the expensive verification path for unknown email addresses.
    const hash =
      (role === 'MANAGER' ? account?.passwordHash : account?.pinHash) ?? (await this.dummyHash);
    const valid = await argon2.verify(hash, pin);
    if (user && valid && user.removedAt)
      throw new AppError(
        403,
        'PLAYER_REMOVED',
        'You have been removed from your team. Contact your coach or manager for help.',
      );
    if (user && valid && !user.isVerified)
      throw new AppError(
        403,
        'EMAIL_VERIFICATION_REQUIRED',
        'Verify your email before signing in.',
      );
    if (
      !user ||
      (role === 'PLAYER' && user.role !== 'PLAYER') ||
      !valid ||
      !account?.isVerified ||
      !user.isVerified ||
      !user.active
    ) {
      await rateLimit(this.db, key, 5, 900);
      throw new AppError(
        401,
        'LOGIN_FAILED',
        'Email or credentials are incorrect, or the account is unavailable.',
      );
    }
    await this.db.rateLimitBucket.deleteMany({ where: { key } });
    return this.createSession(user, role === 'MANAGER' ? 'PASSWORD' : 'PIN');
  }
  async createSession(user: User, authMethod = user.role === 'MANAGER' ? 'PASSWORD' : 'PIN') {
    requireRule(
      user.role !== 'MANAGER' || authMethod === 'PASSWORD',
      403,
      'PASSWORD_REQUIRED',
      'A password is required for staff access.',
    );
    const token = randomToken();
    await this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      requireRule(
        !current.removedAt,
        403,
        'PLAYER_REMOVED',
        'You have been removed from your team. Contact your coach or manager for help.',
      );
      requireRule(
        current.active && current.isVerified && !current.removedAt,
        403,
        'ACCOUNT_UNAVAILABLE',
        'The account is unavailable.',
      );
      await tx.deviceSession.create({
        data: {
          userId: user.id,
          authMethod,
          tokenHash: digest(token),
          expiresAt: new Date(Date.now() + 30 * 86400_000),
        },
      });
    });
    return {
      token,
      csrfToken: keyedDigest(this.config.SESSION_SECRET, `csrf:${token}`),
      ...(await this.context(user, authMethod)),
    };
  }
  async resolve(token: string | undefined, reportRemoval = false) {
    if (!token) return null;
    const session = await this.db.deviceSession.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    if (reportRemoval && session?.user.removedAt && session.expiresAt > new Date())
      throw new AppError(
        403,
        'PLAYER_REMOVED',
        'You have been removed from your team. Contact your coach or manager for help.',
      );
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.active ||
      session.user.removedAt ||
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
