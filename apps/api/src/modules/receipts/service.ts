import type { PrismaClient, User } from '@pitchpresence/database';
import type { z } from 'zod';
import type { schemas } from '@pitchpresence/shared';
import { actorTeam, audit, lock, rateLimit, requireRule } from '../../plugins/core.js';
import { recomputeDues } from '../dues/service.js';
import { presentReceipt } from './presentation.js';
import { receiptFile } from './files.js';

export class ReceiptService {
  constructor(
    private db: PrismaClient,
    private pushEnabled = false,
  ) {}
  async upload(
    user: User,
    duesId: string,
    input: z.infer<typeof schemas.receiptUpload>,
    requestId: string,
  ) {
    const teamId = await actorTeam(this.db, user.id);
    await rateLimit(this.db, `receipt-upload:${user.id}`, 5, 3600);
    const file = receiptFile(input.content, input.mimeType, input.fileName);
    const initial = await this.db.monthlyDues.findFirst({
      where: { id: duesId, playerId: user.id, teamId },
    });
    requireRule(initial, 404, 'NOT_FOUND', 'Dues record not found.');
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'User', user.id);
      await actorTeam(tx, user.id);
      // Serialize quotas and account snapshots across uploads for this team.
      await lock(tx, 'Team', teamId);
      const account = await tx.teamTransferAccount.findFirst({
        where: { id: input.accountId, teamId },
      });
      requireRule(account, 422, 'ACCOUNT_INVALID', 'Choose a bank account supplied by your team.');
      let period = await tx.duesPeriod.findUnique({
        where: { teamId_month: { teamId, month: initial.month } },
      });
      requireRule(
        period,
        409,
        'DUES_PERIOD_UNCONFIGURED',
        'Management must configure this month first.',
      );
      await lock(tx, 'DuesPeriod', period.id);
      period = await tx.duesPeriod.findUniqueOrThrow({ where: { id: period.id } });
      await lock(tx, 'MonthlyDues', duesId);
      const dues = await tx.monthlyDues.findUniqueOrThrow({ where: { id: duesId } });
      // A lost response can be retried without storing a second copy.
      const existing = await tx.paymentReceipt.findUnique({
        where: { teamId_sha256: { teamId, sha256: file.sha256 } },
        include: { payment: true },
      });
      if (existing) {
        requireRule(
          existing.playerId === user.id &&
            existing.monthlyDuesId === duesId &&
            existing.accountId === input.accountId &&
            existing.payment.amount === input.amount &&
            (existing.payment.externalReference ?? '') === (input.reference ?? ''),
          409,
          'RECEIPT_DUPLICATE',
          'This receipt has already been submitted. Use the receipt for this transfer.',
        );
        return presentReceipt(existing);
      }
      requireRule(
        dues.status === 'NOT_PAID',
        409,
        'DUES_ALREADY_PAID',
        'This month is already paid.',
      );
      requireRule(
        input.amount >= period.minimumAmount,
        422,
        'PAYMENT_AMOUNT_BELOW_MINIMUM',
        'The amount must meet the monthly minimum.',
      );
      const history = await tx.paymentReceipt.findMany({
        where: { monthlyDuesId: duesId },
        select: { status: true },
      });
      requireRule(
        !history.some((r) => r.status === 'PENDING'),
        409,
        'RECEIPT_PENDING',
        'Your receipt is awaiting review. Do not upload it again.',
      );
      requireRule(
        history.length < 3,
        409,
        'RECEIPT_LIMIT',
        'Three proofs have been submitted for this month. Contact your coach to resolve it.',
      );
      const used = await tx.$queryRaw<
        { teamBytes: bigint; playerBytes: bigint }[]
      >`SELECT COALESCE(sum(size),0)::bigint AS "teamBytes", COALESCE(sum(size) FILTER (WHERE "playerId"=${user.id}::uuid),0)::bigint AS "playerBytes" FROM "PaymentReceipt" WHERE "teamId"=${teamId}::uuid AND content IS NOT NULL`;
      requireRule(
        Number(used[0]!.teamBytes) + file.bytes.length <= 100 * 1024 * 1024 &&
          Number(used[0]!.playerBytes) + file.bytes.length <= 12 * 1024 * 1024,
        409,
        'RECEIPT_STORAGE_FULL',
        'Receipt storage is full. Contact your coach for direct payment confirmation.',
      );
      await tx.duesPeriod.update({
        where: { id: period.id },
        data: { frozenAt: period.frozenAt ?? new Date() },
      });
      const payment = await tx.payment.create({
        data: {
          teamId,
          playerId: user.id,
          monthlyDuesId: duesId,
          amount: input.amount,
          minimumAmount: period.minimumAmount,
          provider: 'EXTERNAL',
          status: 'PENDING',
          externalReference: input.reference,
          needsReview: true,
        },
      });
      const receipt = await tx.paymentReceipt.create({
        data: {
          teamId,
          playerId: user.id,
          monthlyDuesId: duesId,
          accountId: account.id,
          paymentId: payment.id,
          fileName: input.fileName,
          mimeType: input.mimeType,
          size: file.bytes.length,
          content: file.bytes,
          sha256: file.sha256,
        },
      });
      await audit(tx, user.id, 'PAYMENT_PROOF_SUBMITTED', receipt.id, requestId, {
        duesId,
        paymentId: payment.id,
        accountId: account.id,
        amount: input.amount,
      });
      if (this.pushEnabled) {
        const subscriptions = await tx.pushSubscription.findMany({
          where: {
            teamId,
            user: { role: 'MANAGER', active: true, isVerified: true },
            session: { revokedAt: null, expiresAt: { gt: new Date() } },
          },
          select: { id: true },
        });
        if (subscriptions.length)
          await tx.backgroundJob.createMany({
            data: subscriptions.map((s) => ({
              teamId,
              kind: 'PUSH_RECEIPT_SUBMITTED',
              payload: { receiptId: receipt.id, subscriptionId: s.id },
              deduplicationKey: `receipt-push:${receipt.id}:${s.id}`,
            })),
          });
      }
      return presentReceipt(receipt);
    });
  }
  async download(user: User, receiptId: string) {
    const receipt = await this.db.paymentReceipt.findFirst({
      where: {
        id: receiptId,
        teamId: user.teamId!,
        ...(user.role === 'PLAYER' ? { playerId: user.id } : {}),
      },
    });
    requireRule(receipt, 404, 'NOT_FOUND', 'Receipt not found.');
    requireRule(
      receipt.content,
      410,
      'RECEIPT_EXPIRED',
      'The retained receipt file has expired. Its payment history is still available.',
    );
    return { fileName: receipt.fileName, bytes: Buffer.from(receipt.content) };
  }
  async review(
    user: User,
    receiptId: string,
    input: z.infer<typeof schemas.receiptReview>,
    requestId: string,
  ) {
    const teamId = await actorTeam(this.db, user.id);
    const initial = await this.db.paymentReceipt.findFirst({
      where: { id: receiptId, teamId },
      include: { payment: true },
    });
    requireRule(initial, 404, 'NOT_FOUND', 'Receipt not found.');
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'MonthlyDues', initial.monthlyDuesId);
      await lock(tx, 'Payment', initial.paymentId);
      const receipt = await tx.paymentReceipt.findUniqueOrThrow({
        where: { id: receiptId },
        include: { payment: true },
      });
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
      if (receipt.status === status)
        return {
          receipt: presentReceipt(receipt),
          dues: await tx.monthlyDues.findUniqueOrThrow({ where: { id: receipt.monthlyDuesId } }),
        };
      requireRule(
        receipt.status === 'PENDING' && receipt.payment.status === 'PENDING',
        409,
        'RECEIPT_ALREADY_REVIEWED',
        'This receipt has already been reviewed.',
      );
      const dues = await tx.monthlyDues.findUniqueOrThrow({ where: { id: receipt.monthlyDuesId } });
      requireRule(
        status !== 'APPROVED' || dues.status === 'NOT_PAID',
        409,
        'DUES_ALREADY_PAID',
        'This month is already paid. Reject this proof if it does not represent another payment.',
      );
      await tx.payment.update({
        where: { id: receipt.paymentId },
        data: {
          status: status === 'APPROVED' ? 'SUCCESS' : 'FAILED',
          markedBy: user.id,
          needsReview: false,
          ...(status === 'APPROVED' ? { paidAt: new Date(), verifiedAt: new Date() } : {}),
        },
      });
      const updated = await tx.paymentReceipt.update({
        where: { id: receipt.id },
        data: { status, reason: input.reason ?? null, reviewedBy: user.id, reviewedAt: new Date() },
      });
      const result = await recomputeDues(tx, receipt.monthlyDuesId);
      await audit(
        tx,
        user.id,
        `PAYMENT_PROOF_${status}`,
        receipt.id,
        requestId,
        { paymentId: receipt.paymentId, duesId: receipt.monthlyDuesId },
        input.reason,
      );
      return { receipt: presentReceipt(updated), dues: result };
    });
  }
}
