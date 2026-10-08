import { lock, requireRule } from '../plugins/core.js';
import { randomUUID } from 'node:crypto';
import type { BackgroundJob, PrismaClient } from '@pitchpresence/database';
import { z } from 'zod';
import type { Config } from '../config/index.js';
import type { Providers } from './providers.js';
import { decrypt } from './secrets.js';
import type { PaymentService } from '../modules/payments/service.js';
import { createPushSender, type PushSender } from './push.js';
import { pushSubscriptionInput } from '../modules/notifications/schema.js';
const emailPayload = z.object({
  userId: z.string().uuid(),
  challengeId: z.string().uuid(),
  email: z.string().email(),
  purpose: z.string(),
  encryptedOtp: z.string(),
});
const paymentPayload = z.object({ paymentId: z.string().uuid() });
export class JobRunner {
  constructor(
    private db: PrismaClient,
    private config: Config,
    private providers: Providers,
    private payments: PaymentService,
    private onEvent: (event: Record<string, unknown>) => void = () => {},
    private sendPush: PushSender = createPushSender(config),
  ) {}
  async tick() {
    const token = randomUUID();
    const jobs = await this.db.$queryRaw<BackgroundJob[]>`
 UPDATE "BackgroundJob" SET "leaseUntil"=now()+interval '60 seconds',"leaseToken"=${token},attempts=attempts+1
 WHERE id IN (SELECT id FROM "BackgroundJob" WHERE "completedAt" IS NULL AND "failedAt" IS NULL AND "availableAt"<=now() AND ("leaseUntil" IS NULL OR "leaseUntil"<now()) ORDER BY "availableAt" FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
    const job = jobs[0];
    if (!job) return false;
    try {
      if (job.kind === 'EMAIL_OTP') {
        const p = emailPayload.parse(job.payload);
        const challenge = await this.db.verificationToken.findUnique({
          where: { id: p.challengeId },
        });
        requireRule(
          !challenge || (challenge.userId === p.userId && challenge.purpose === p.purpose),
          409,
          'JOB_IDENTITY_MISMATCH',
          'Email job identity mismatch.',
        );
        const user = await this.db.user.findUnique({ where: { id: p.userId } });
        requireRule(
          !challenge || (user?.email === p.email && (!job.teamId || user.teamId === job.teamId)),
          409,
          'JOB_TEAM_MISMATCH',
          'Email job team mismatch.',
        );
        if (challenge && !challenge.consumedAt && challenge.expiresAt > new Date())
          await this.providers.sendOtp(
            p.email,
            decrypt(this.config.SESSION_SECRET, p.encryptedOtp),
            p.purpose,
            job.deduplicationKey,
          );
      } else if (job.kind === 'EMAIL_BANK_CODE' || job.kind === 'EMAIL_BANK_CHANGED') {
        const p = z
          .object({
            changeId: z.string().uuid(),
            encryptedOtp: z.string().optional(),
            recipientId: z.string().uuid().optional(),
          })
          .parse(job.payload);
        const change = await this.db.bankAccountChange.findFirst({
          where: { id: p.changeId, teamId: job.teamId! },
        });
        requireRule(
          change && job.teamId,
          409,
          'JOB_TEAM_MISMATCH',
          'Bank email job team mismatch.',
        );
        const code = job.kind === 'EMAIL_BANK_CODE';
        const recipient = await this.db.user.findFirst({
          where: {
            id: code ? change.requestedBy : (p.recipientId ?? ''),
            teamId: job.teamId,
            role: 'MANAGER',
            active: true,
            isVerified: true,
          },
        });
        const team = await this.db.team.findUniqueOrThrow({ where: { id: job.teamId } });
        if (
          recipient &&
          (code
            ? !change.consumedAt && change.expiresAt > new Date() && change.attempts < 5
            : !!change.appliedAt)
        ) {
          const details =
            change.action === 'REMOVE'
              ? 'remove the current bank account'
              : `set ${change.bankName}, ${change.accountName}, account ending ${change.accountLast4}`;
          const text = code
            ? `You requested to ${details} for ${team.name}. Your confirmation code is ${decrypt(this.config.SESSION_SECRET, p.encryptedOtp!)}. It expires in 10 minutes and applies only to this change. If you did not request it, do not share this code.`
            : `A staff member confirmed a bank change for ${team.name}: ${details}. Review team settings at ${this.config.APP_URL}/management/team. Contact your team immediately if this change was unexpected.`;
          await this.providers.sendBankNotice(
            recipient.email,
            code
              ? 'Confirm your PitchPresence bank account change'
              : 'PitchPresence team bank account changed',
            text,
            job.deduplicationKey,
          );
        }
      } else if (job.kind === 'EMAIL_STAFF_INVITATION') {
        const payload = z
          .object({ invitationId: z.string().uuid(), encryptedToken: z.string() })
          .parse(job.payload);
        const invitation = await this.db.invitation.findFirst({
          where: { id: payload.invitationId, teamId: job.teamId!, kind: 'MANAGER' },
        });
        requireRule(
          invitation && job.teamId,
          409,
          'JOB_TEAM_MISMATCH',
          'Invitation job team mismatch.',
        );
        if (!invitation.revokedAt && !invitation.acceptedAt && invitation.expiresAt > new Date()) {
          const token = decrypt(this.config.SESSION_SECRET, payload.encryptedToken);
          await this.providers.sendStaffInvitation(
            invitation.email!,
            `${this.config.APP_URL}/staff/join?invite=${token}`,
            job.deduplicationKey,
          );
        }
      } else if (job.kind === 'PUSH_RECEIPT_SUBMITTED') {
        requireRule(job.teamId, 409, 'JOB_TEAM_MISMATCH', 'Receipt notification team missing.');
        const p = z
          .object({ receiptId: z.string().uuid(), subscriptionId: z.string().uuid() })
          .parse(job.payload);
        const subscription = await this.db.pushSubscription.findFirst({
          where: {
            id: p.subscriptionId,
            teamId: job.teamId!,
            vapidPublicKey: this.config.VAPID_PUBLIC_KEY,
            user: { active: true, isVerified: true, role: 'MANAGER' },
            session: { revokedAt: null, expiresAt: { gt: new Date() } },
          },
        });
        const receipt = await this.db.paymentReceipt.findFirst({
          where: { id: p.receiptId, teamId: job.teamId!, status: 'PENDING' },
          select: { id: true, monthlyDuesId: true },
        });
        if (
          job.teamId &&
          subscription &&
          receipt &&
          this.config.VAPID_PUBLIC_KEY &&
          Date.now() - job.createdAt.getTime() < 86400_000
        ) {
          const details = pushSubscriptionInput.parse(
            JSON.parse(
              decrypt(this.config.DATA_ENCRYPTION_SECRET, subscription.encryptedSubscription),
            ),
          );
          const dues = await this.db.monthlyDues.findFirstOrThrow({
            where: { id: receipt.monthlyDuesId, teamId: job.teamId },
            select: { month: true },
          });
          const outcome = await this.sendPush(details, {
            receiptId: receipt.id,
            url: `/management/dues?month=${dues.month}`,
          });
          if (outcome === 'gone')
            await this.db.pushSubscription.deleteMany({ where: { id: subscription.id } });
        }
      } else if (job.kind === 'VERIFY_PAYMENT') {
        const p = paymentPayload.parse(job.payload);
        requireRule(
          job.teamId &&
            (await this.db.payment.findFirst({ where: { id: p.paymentId, teamId: job.teamId } })),
          409,
          'JOB_TEAM_MISMATCH',
          'Payment job team mismatch.',
        );
        const result = await this.payments.verify(p.paymentId);
        if (result.status === 'PENDING') throw new Error('Payment remains pending');
      } else throw new Error('Unknown job kind');
      await this.db.backgroundJob.updateMany({
        where: { id: job.id, leaseToken: token },
        data: { completedAt: new Date(), leaseUntil: null, leaseToken: null, payload: {} },
      });
    } catch {
      const paymentJob = job.kind === 'VERIFY_PAYMENT';
      const old = Date.now() - job.createdAt.getTime() > 86400_000;
      const exhausted = paymentJob ? old : job.attempts >= 5;
      if (exhausted && paymentJob) {
        const p = paymentPayload.safeParse(job.payload);
        if (p.success && job.teamId)
          await this.db.payment.updateMany({
            where: { id: p.data.paymentId, teamId: job.teamId ?? undefined, status: 'PENDING' },
            data: { needsReview: true },
          });
      }
      this.onEvent({
        level: exhausted ? 'error' : 'warn',
        message: 'Background job failed',
        jobId: job.id,
        kind: job.kind,
        attempts: job.attempts,
        exhausted,
      });
      await this.db.backgroundJob.updateMany({
        where: { id: job.id, leaseToken: token },
        data: {
          lastError: 'Job processing failed; see provider availability and record state.',
          leaseUntil: null,
          leaseToken: null,
          availableAt: new Date(
            Date.now() + (paymentJob ? 300_000 : Math.min(60_000, 1000 * 2 ** job.attempts)),
          ),
          ...(exhausted ? { failedAt: new Date(), ...(paymentJob ? {} : { payload: {} }) } : {}),
        },
      });
    }
    return true;
  }
  async maintain() {
    await this.db.pushSubscription.deleteMany({
      where: {
        OR: [
          { session: { revokedAt: { not: null } } },
          { session: { expiresAt: { lte: new Date() } } },
          { user: { active: false } },
          { user: { isVerified: false } },
          { user: { role: { not: 'MANAGER' } } },
        ],
      },
    });
    // Keep the payment audit, but remove reviewed receipt bytes after 180 days.
    await this.db.paymentReceipt.updateMany({
      where: {
        status: { not: 'PENDING' },
        reviewedAt: { lt: new Date(Date.now() - 180 * 86400_000) },
        content: { not: null },
      },
      data: { content: null },
    });
    await this.db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const unresolved = await this.db.payment.findMany({
      where: {
        status: 'PENDING',
        provider: 'PAYSTACK',
        createdAt: { lt: new Date(Date.now() - 86400_000) },
        needsReview: false,
      },
      take: 100,
    });
    for (const payment of unresolved) {
      await this.db.$transaction(async (tx) => {
        await lock(tx, 'Payment', payment.id);
        const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
        if (current.status !== 'PENDING' || current.needsReview) return;
        await tx.payment.update({ where: { id: payment.id }, data: { needsReview: true } });
        await tx.auditEvent.create({
          data: {
            teamId: payment.teamId,
            action: 'PAYMENT_RECONCILIATION_ESCALATED',
            entityId: payment.id,
          },
        });
      });
    }
  }
}
