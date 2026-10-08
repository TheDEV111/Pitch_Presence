import { randomInt } from 'node:crypto';
import type { PrismaClient, User } from '@pitchpresence/database';
import type { z } from 'zod';
import type { schemas } from '@pitchpresence/shared';
import type { Config } from '../../config/index.js';
import { encrypt, decrypt } from '../../infrastructure/secrets.js';
import {
  actorTeam,
  audit,
  keyedDigest,
  lock,
  rateLimit,
  requireRule,
  safeEqual,
} from '../../plugins/core.js';
import { verifyStaffPassword } from './reauth.js';

export class TransferService {
  constructor(
    private db: PrismaClient,
    private config: Config,
  ) {}
  async current(teamId: string) {
    const team = await this.db.team.findUniqueOrThrow({ where: { id: teamId } });
    const account = team.transferAccountId
      ? await this.db.teamTransferAccount.findFirst({
          where: { id: team.transferAccountId, teamId },
        })
      : null;
    return account
      ? {
          id: account.id,
          bankName: account.bankName,
          accountName: account.accountName,
          accountNumber: decrypt(this.config.DATA_ENCRYPTION_SECRET, account.encryptedNumber),
          createdAt: account.createdAt,
        }
      : null;
  }
  async pending(teamId: string) {
    return this.db.bankAccountChange.findFirst({
      where: { teamId, consumedAt: null, expiresAt: { gt: new Date() }, attempts: { lt: 5 } },
      select: {
        id: true,
        action: true,
        bankName: true,
        accountName: true,
        accountLast4: true,
        requestedBy: true,
        expiresAt: true,
      },
    });
  }
  async request(user: User, input: z.infer<typeof schemas.transferChange>, requestId: string) {
    const teamId = await actorTeam(this.db, user.id);
    await rateLimit(this.db, `bank-change-user:${user.id}`, 3, 3600);
    await rateLimit(this.db, `bank-change-team:${teamId}`, 5, 86400);
    await verifyStaffPassword(this.db, user, input.password);
    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'Team', teamId);
      const current = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
      requireRule(
        input.action !== 'REMOVE' || current.transferAccountId,
        409,
        'ACCOUNT_MISSING',
        'There is no active transfer account to remove.',
      );
      if (input.action === 'SET' && current.transferAccountId) {
        const old = await tx.teamTransferAccount.findUniqueOrThrow({
          where: { id: current.transferAccountId },
        });
        requireRule(
          old.bankName !== input.bankName ||
            old.accountName !== input.accountName ||
            decrypt(this.config.DATA_ENCRYPTION_SECRET, old.encryptedNumber) !==
              input.accountNumber,
          409,
          'ACCOUNT_UNCHANGED',
          'These account details are already active.',
        );
      }
      await tx.bankAccountChange.updateMany({
        where: { teamId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      // SET proposals retain their encrypted number until applied/expired; never log it.
      const change = await tx.bankAccountChange.create({
        data: {
          teamId,
          requestedBy: user.id,
          action: input.action,
          previousAccountId: current.transferAccountId,
          ...(input.action === 'SET'
            ? {
                bankName: input.bankName,
                accountName: input.accountName,
                accountLast4: input.accountNumber.slice(-4),
                encryptedNumber: encrypt(this.config.DATA_ENCRYPTION_SECRET, input.accountNumber),
              }
            : {}),
          otpHash: '',
          expiresAt: new Date(Date.now() + 600_000),
        },
      });
      await tx.bankAccountChange.update({
        where: { id: change.id },
        data: { otpHash: keyedDigest(this.config.SESSION_SECRET, `bank:${change.id}:${otp}`) },
      });
      await tx.backgroundJob.create({
        data: {
          teamId,
          kind: 'EMAIL_BANK_CODE',
          deduplicationKey: `bank-code:${change.id}`,
          payload: { changeId: change.id, encryptedOtp: encrypt(this.config.SESSION_SECRET, otp) },
        },
      });
      await audit(tx, user.id, 'BANK_CHANGE_REQUESTED', change.id, requestId, {
        action: input.action,
        previousAccountId: current.transferAccountId,
      });
      return {
        changeId: change.id,
        expiresAt: change.expiresAt,
        message:
          'A confirmation code has been queued for your staff email. The active account has not changed.',
      };
    });
  }
  async confirm(user: User, input: z.infer<typeof schemas.transferConfirm>, requestId: string) {
    const teamId = await actorTeam(this.db, user.id);
    await rateLimit(this.db, `bank-code:${user.id}`, 10, 900);
    const result = await this.db.$transaction(async (tx) => {
      await lock(tx, 'Team', teamId);
      const change = await tx.bankAccountChange.findFirst({
        where: { id: input.changeId, teamId, requestedBy: user.id },
      });
      requireRule(change, 404, 'NOT_FOUND', 'Account change not found.');
      if (change.appliedAt) return { applied: true }; // Safe retry after a lost response.
      requireRule(
        !change.consumedAt && change.expiresAt > new Date() && change.attempts < 5,
        422,
        'BANK_CODE_EXPIRED',
        'This code is expired or replaced. Request the change again.',
      );
      if (
        !safeEqual(
          change.otpHash,
          keyedDigest(this.config.SESSION_SECRET, `bank:${change.id}:${input.otp}`),
        )
      ) {
        await tx.bankAccountChange.update({
          where: { id: change.id },
          data: {
            attempts: { increment: 1 },
            ...(change.attempts === 4 ? { consumedAt: new Date() } : {}),
          },
        });
        return { applied: false };
      }
      const current = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
      requireRule(
        current.transferAccountId === change.previousAccountId,
        409,
        'ACCOUNT_CHANGED',
        'Another staff member changed this account. Reload before requesting a new change.',
      );
      let id: string | null = null;
      if (change.action === 'SET') {
        const account = await tx.teamTransferAccount.create({
          data: {
            teamId,
            bankName: change.bankName!,
            accountName: change.accountName!,
            accountLast4: change.accountLast4!,
            encryptedNumber: change.encryptedNumber!,
            configuredBy: user.id,
          },
        });
        id = account.id;
      }
      await tx.team.update({ where: { id: teamId }, data: { transferAccountId: id } });
      await tx.bankAccountChange.update({
        where: { id: change.id },
        data: { consumedAt: new Date(), appliedAt: new Date() },
      });
      const staff = await tx.user.findMany({
        where: { teamId, role: 'MANAGER', active: true, isVerified: true },
        select: { id: true },
      });
      for (const member of staff)
        await tx.backgroundJob.create({
          data: {
            teamId,
            kind: 'EMAIL_BANK_CHANGED',
            deduplicationKey: `bank-changed:${change.id}:${member.id}`,
            payload: { changeId: change.id, recipientId: member.id },
          },
        });
      await audit(
        tx,
        user.id,
        change.action === 'SET' ? 'TRANSFER_ACCOUNT_SET' : 'TRANSFER_ACCOUNT_REMOVED',
        change.id,
        requestId,
        {
          previousAccountId: change.previousAccountId,
          accountId: id,
          bankName: change.bankName,
          accountLast4: change.accountLast4,
        },
      );
      return { applied: true };
    });
    requireRule(result.applied, 422, 'BANK_CODE_INVALID', 'Check the email code and try again.');
    return { confirmed: true, transferAccount: await this.current(teamId) };
  }
}
