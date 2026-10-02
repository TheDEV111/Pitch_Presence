import argon2 from 'argon2';
import type { PrismaClient, User } from '@pitchpresence/database';
import type { z } from 'zod';
import type { schemas } from '@pitchpresence/shared';
import type { Config } from '../../config/index.js';
import type { Providers, Subaccount } from '../../infrastructure/providers.js';
import { encrypt } from '../../infrastructure/secrets.js';
import {
  actorTeam,
  audit,
  digest,
  localMonth,
  lock,
  randomToken,
  rateLimit,
  requireRule,
} from '../../plugins/core.js';
export class TeamService {
  constructor(
    private db: PrismaClient,
    private config: Config,
    private providers: Providers,
  ) {}
  banks() {
    return this.providers.banks();
  }
  resolve(bankCode: string, accountNumber: string) {
    return this.providers.resolveBank(bankCode, accountNumber);
  }
  async create(user: User, name: string, requestId: string) {
    requireRule(user.role === 'MANAGER', 403, 'FORBIDDEN', 'A staff account is required.');
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
      requireRule(
        current.role === 'MANAGER' && current.isVerified && current.active,
        403,
        'ACCOUNT_UNAVAILABLE',
        'A verified active staff account is required.',
      );
      if (current.teamId) return tx.team.findUniqueOrThrow({ where: { id: current.teamId } });
      requireRule(
        !current.pendingInvitationId,
        409,
        'INVITATION_PENDING',
        'Accept or decline your staff invitation first.',
      );
      const team = await tx.team.create({ data: { name, createdBy: user.id } });
      await tx.user.update({ where: { id: user.id }, data: { teamId: team.id } });
      await audit(tx, user.id, 'TEAM_CREATED', team.id, requestId);
      return team;
    });
  }
  async invite(user: User, email: string, requestId: string) {
    const teamId = await actorTeam(this.db, user.id);
    const existing = await this.db.user.findUnique({ where: { email } });
    requireRule(
      !existing || (existing.role === 'MANAGER' && !existing.teamId),
      409,
      'ACCOUNT_ALREADY_ASSIGNED',
      'This email already belongs to a team or player account.',
    );
    const token = randomToken();
    return this.db.$transaction(async (tx) => {
      const row = await tx.invitation.create({
        data: {
          teamId,
          kind: 'MANAGER',
          email,
          tokenHash: digest(token),
          createdBy: user.id,
          expiresAt: new Date(Date.now() + 7 * 86400_000),
        },
      });
      await tx.backgroundJob.create({
        data: {
          teamId,
          kind: 'EMAIL_STAFF_INVITATION',
          deduplicationKey: `invitation:${row.id}`,
          payload: {
            invitationId: row.id,
            encryptedToken: encrypt(this.config.SESSION_SECRET, token),
          },
        },
      });
      await audit(tx, user.id, 'STAFF_INVITED', row.id, requestId);
      return {
        id: row.id,
        email,
        expiresAt: row.expiresAt,
        registrationUrl: `${this.config.APP_URL}/staff/join?invite=${token}`,
      };
    });
  }
  async settings(teamId: string) {
    const team = await this.db.team.findUniqueOrThrow({
      where: { id: teamId },
      select: { id: true, name: true, createdAt: true, paymentProfileId: true },
    });
    const profiles = await this.db.teamPaymentProfile.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    const active = team.paymentProfileId
      ? await this.db.teamPaymentProfile.findUnique({ where: { id: team.paymentProfileId } })
      : null;
    const present = (p: typeof active) =>
      p
        ? {
            id: p.id,
            status: p.status,
            bankCode: p.bankCode,
            accountName: p.accountName,
            accountLast4: p.accountLast4,
            createdAt: p.createdAt,
          }
        : null;
    return {
      team: { id: team.id, name: team.name, createdAt: team.createdAt },
      paymentProfile: present(active),
      latestSetup: present(profiles[0] ?? null),
      paymentsReady: !!active && active.status === 'READY',
    };
  }
  async overview(teamId: string) {
    const month = localMonth();
    const eligible = {
      teamId,
      role: 'PLAYER' as const,
      active: true,
      isVerified: true,
      activatedAt: { not: null },
    };
    const [settings, currentSession, recentSessions, activePlayers, totalPlayers, period, paid] =
      await Promise.all([
        this.settings(teamId),
        this.db.trainingSession.findFirst({ where: { teamId, status: 'OPEN' } }),
        this.db.trainingSession.findMany({
          where: { teamId },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          take: 5,
        }),
        this.db.user.count({ where: eligible }),
        this.db.user.count({ where: { teamId, role: 'PLAYER' } }),
        this.db.duesPeriod.findUnique({ where: { teamId_month: { teamId, month } } }),
        this.db.monthlyDues.count({ where: { teamId, month, status: 'PAID', player: eligible } }),
      ]);
    return {
      ...settings,
      currentSession,
      recentSessions,
      players: { active: activePlayers, total: totalPlayers },
      dues: {
        month,
        paid,
        unpaid: activePlayers - paid,
        minimumAmount: period?.minimumAmount ?? null,
      },
      setup: {
        hasPlayers: activePlayers > 0,
        duesConfigured: !!period,
        paymentsReady: settings.paymentsReady,
      },
    };
  }
  async password(user: User, password: string) {
    await rateLimit(this.db, `bank-reauth:${user.id}`, 5, 900);
    const current = await this.db.user.findUniqueOrThrow({ where: { id: user.id } });
    requireRule(
      current.active &&
        current.isVerified &&
        current.passwordHash &&
        (await argon2.verify(current.passwordHash, password)),
      401,
      'REAUTHENTICATION_FAILED',
      'Check your password and try again.',
    );
  }
  async setup(user: User, input: z.infer<typeof schemas.bankSetup>, requestId: string) {
    const teamId = await actorTeam(this.db, user.id);
    await this.password(user, input.password);
    const banks = await this.providers.banks();
    requireRule(
      banks.some((bank) => bank.code === input.bankCode),
      422,
      'BANK_INVALID',
      'Select a supported bank.',
    );
    const accountName = await this.providers.resolveBank(input.bankCode, input.accountNumber);
    requireRule(
      accountName === input.accountName,
      409,
      'ACCOUNT_NAME_CHANGED',
      'Resolve and confirm the account name again.',
    );
    const profile = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bank:${teamId}`}))::text`;
      const unresolved = await tx.teamPaymentProfile.findFirst({
        where: { teamId, status: { in: ['PENDING', 'REVIEW'] } },
      });
      requireRule(
        !unresolved,
        409,
        'BANK_REVIEW_REQUIRED',
        'An earlier bank connection is awaiting review. Check its status before retrying.',
      );
      const row = await tx.teamPaymentProfile.create({
        data: {
          teamId,
          bankCode: input.bankCode,
          accountName,
          accountLast4: input.accountNumber.slice(-4),
          configuredBy: user.id,
        },
      });
      await audit(tx, user.id, 'BANK_SETUP_STARTED', row.id, requestId);
      return row;
    });
    try {
      const team = await this.db.team.findUniqueOrThrow({ where: { id: teamId } });
      const result = await this.providers.createSubaccount({
        name: team.name,
        bankCode: input.bankCode,
        accountNumber: input.accountNumber,
        profileId: profile.id,
      });
      await this.activate(profile.id, teamId, result, user.id, requestId);
    } catch {
      await this.db.teamPaymentProfile.updateMany({
        where: { id: profile.id, status: 'PENDING' },
        data: { status: 'REVIEW' },
      });
      // Never repeat a provider creation whose outcome is unknown.
    }
    return this.settings(teamId);
  }
  private async activate(
    profileId: string,
    teamId: string,
    result: Subaccount,
    actorId: string,
    requestId: string,
  ) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bank:${teamId}`}))::text`;
      const profile = await tx.teamPaymentProfile.findFirstOrThrow({
        where: { id: profileId, teamId },
      });
      requireRule(
        result.active &&
          result.profileId === profile.id &&
          result.accountLast4 === profile.accountLast4 &&
          result.accountName === profile.accountName &&
          /^ACCT_/.test(result.code),
        409,
        'BANK_REVIEW_REQUIRED',
        'The provider bank details need review.',
      );
      await tx.teamPaymentProfile.update({
        where: { id: profileId },
        data: { status: 'READY', subaccountCode: result.code },
      });
      await tx.team.update({ where: { id: teamId }, data: { paymentProfileId: profileId } });
      await audit(tx, actorId, 'BANK_CONNECTED', profileId, requestId);
    });
  }
  async reconcile(user: User, requestId: string) {
    const teamId = await actorTeam(this.db, user.id);
    await rateLimit(this.db, `bank-review:${teamId}`, 5, 300);
    const profile = await this.db.teamPaymentProfile.findFirst({
      where: { teamId, status: { in: ['PENDING', 'REVIEW'] } },
    });
    if (profile) {
      const result = await this.providers.findSubaccount(profile.id);
      if (result) await this.activate(profile.id, teamId, result, user.id, requestId);
    }
    return this.settings(teamId);
  }
}
