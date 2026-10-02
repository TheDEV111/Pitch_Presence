import { createHmac, randomUUID } from 'node:crypto';
import type { PrismaClient, User } from '@pitchpresence/database';
import type { PaymentInput } from '@pitchpresence/shared';
import type { Config } from '../../config/index.js';
import type { Providers } from '../../infrastructure/providers.js';
import {
  AppError,
  actorTeam,
  audit,
  digest,
  lock,
  requireRule,
  safeEqual,
} from '../../plugins/core.js';
import { recomputeDues, resolveDues } from '../dues/service.js';
export class PaymentService {
  constructor(
    private db: PrismaClient,
    private config: Config,
    private providers: Providers,
  ) {}
  async initialize(player: User, input: PaymentInput, idempotencyKey: string, requestId: string) {
    const teamId = await actorTeam(this.db, player.id);
    const key = `${teamId}:${player.id}:${idempotencyKey}`;
    const fingerprint = digest(JSON.stringify(input));
    const prepared = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
      const replay = await tx.idempotencyRecord.findUnique({ where: { key } });
      if (replay) {
        requireRule(
          replay.fingerprint === fingerprint,
          409,
          'IDEMPOTENCY_CONFLICT',
          'This key was used for a different request.',
        );
        return {
          payment: await tx.payment.findUniqueOrThrow({ where: { id: replay.paymentId } }),
          created: false,
        };
      }
      let period = await tx.duesPeriod.findUnique({
        where: { teamId_month: { teamId, month: input.month } },
      });
      if (period) {
        await lock(tx, 'DuesPeriod', period.id);
        period = await tx.duesPeriod.findUnique({ where: { id: period.id } });
      }
      requireRule(
        period,
        409,
        'DUES_PERIOD_UNCONFIGURED',
        'Management must configure this month first.',
      );
      requireRule(
        input.amount >= period.minimumAmount,
        422,
        'PAYMENT_AMOUNT_BELOW_MINIMUM',
        'Enter at least the monthly minimum.',
      );
      const initial = await resolveDues(tx, player, input.month);
      await lock(tx, 'MonthlyDues', initial.id);
      const dues = await tx.monthlyDues.findUniqueOrThrow({ where: { id: initial.id } });
      requireRule(
        dues.status === 'NOT_PAID',
        409,
        'DUES_ALREADY_PAID',
        'This month is already paid.',
      );
      let payment = await tx.payment.findFirst({
        where: { monthlyDuesId: dues.id, provider: 'PAYSTACK', status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
      });
      const created = !payment;
      if (payment)
        requireRule(
          payment.amount === input.amount,
          409,
          'PAYMENT_PENDING',
          'A payment with a different amount is already pending for this month.',
        );
      if (!payment) {
        const team = await tx.team.findUniqueOrThrow({ where: { id: teamId } });
        const profile = team.paymentProfileId
          ? await tx.teamPaymentProfile.findFirst({
              where: { id: team.paymentProfileId, teamId, status: 'READY' },
            })
          : null;
        requireRule(
          profile?.subaccountCode,
          409,
          'TEAM_PAYMENTS_UNAVAILABLE',
          'Your team must connect its bank account before online payment.',
        );
        await tx.duesPeriod.update({
          where: { id: period.id },
          data: { frozenAt: period.frozenAt ?? new Date() },
        });
        payment = await tx.payment.create({
          data: {
            teamId,
            paymentProfileId: profile.id,
            subaccountCode: profile.subaccountCode,
            playerId: player.id,
            monthlyDuesId: dues.id,
            amount: input.amount,
            minimumAmount: period.minimumAmount,
            provider: 'PAYSTACK',
            providerReference: `pp_${randomUUID()}`,
          },
        });
        await tx.backgroundJob.create({
          data: {
            teamId,
            kind: 'VERIFY_PAYMENT',
            deduplicationKey: `verify:${payment.id}`,
            payload: { paymentId: payment.id },
            availableAt: new Date(Date.now() + 300_000),
          },
        });
        await audit(tx, player.id, 'PAYMENT_INITIALIZED', payment.id, requestId, {
          month: input.month,
          amount: input.amount,
        });
      }
      await tx.idempotencyRecord.create({
        data: { teamId, key, playerId: player.id, fingerprint, paymentId: payment.id },
      });
      return { payment, created };
    });
    if (!prepared.created) return this.present(prepared.payment);
    try {
      const url = await this.providers.initialize({
        subaccountCode: prepared.payment.subaccountCode!,
        email: player.email,
        amount: prepared.payment.amount,
        reference: prepared.payment.providerReference!,
        callbackUrl: `${this.config.APP_URL}/dues/payment-return?paymentId=${prepared.payment.id}`,
      });
      const payment = await this.db.payment.update({
        where: { id: prepared.payment.id },
        data: { checkoutUrl: url },
      });
      return this.present(payment);
    } catch (error) {
      // Unknown provider outcomes retain the reference and pending state for reconciliation.
      await this.db.auditEvent.create({
        data: {
          teamId,
          actorId: player.id,
          action: 'PAYMENT_INITIALIZATION_UNRESOLVED',
          entityId: prepared.payment.id,
          requestId,
        },
      });
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'PAYMENT_INITIALIZATION_UNRESOLVED',
        'Payment initialization is unresolved; check payment status before retrying.',
      );
    }
  }
  present(payment: import('@pitchpresence/database').Payment) {
    return {
      id: payment.id,
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency,
      checkoutUrl: payment.checkoutUrl,
      providerReference: payment.providerReference,
      paidAt: payment.paidAt,
    };
  }
  async verify(paymentId: string, requestId?: string) {
    const initial = await this.db.payment.findUnique({
      where: { id: paymentId },
      include: { player: true },
    });
    requireRule(
      initial && initial.provider === 'PAYSTACK',
      404,
      'NOT_FOUND',
      'Paystack payment not found.',
    );
    if (initial.status === 'SUCCESS') return this.present(initial);
    const verified = await this.providers.verify(initial.providerReference!);
    const matches =
      verified.reference === initial.providerReference &&
      verified.amount === initial.amount &&
      verified.currency === initial.currency &&
      verified.email === initial.player.email &&
      verified.subaccountCode === initial.subaccountCode &&
      initial.teamId === initial.player.teamId;
    if (!matches) {
      await this.db.payment.update({ where: { id: initial.id }, data: { needsReview: true } });
      throw new AppError(
        409,
        'PAYMENT_VERIFICATION_MISMATCH',
        'Payment details require management review.',
      );
    }
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'MonthlyDues', initial.monthlyDuesId);
      await lock(tx, 'Payment', paymentId);
      const current = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (current.status === 'SUCCESS') return this.present(current);
      if (verified.status !== 'success') {
        if (['failed', 'abandoned', 'reversed'].includes(verified.status))
          await tx.payment.update({
            where: { id: paymentId },
            data: { status: 'FAILED', verifiedAt: new Date() },
          });
        return this.present(await tx.payment.findUniqueOrThrow({ where: { id: paymentId } }));
      }
      const dues = await tx.monthlyDues.findUniqueOrThrow({ where: { id: initial.monthlyDuesId } });
      const payment = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'SUCCESS',
          paidAt: new Date(),
          verifiedAt: new Date(),
          needsReview: current.needsReview || dues.status === 'PAID',
        },
      });
      await recomputeDues(tx, dues.id);
      await audit(
        tx,
        null,
        'PAYMENT_VERIFIED',
        paymentId,
        requestId,
        {
          reference: current.providerReference,
          amount: current.amount,
          additionalPayment: dues.status === 'PAID',
        },
        undefined,
        initial.teamId,
      );
      return this.present(payment);
    });
  }
  async webhook(raw: Buffer, signature: string | undefined) {
    requireRule(
      this.config.PAYSTACK_SECRET_KEY && signature && /^[a-f0-9]{128}$/i.test(signature),
      401,
      'WEBHOOK_SIGNATURE_INVALID',
      'Invalid webhook signature.',
    );
    const expected = createHmac('sha512', this.config.PAYSTACK_SECRET_KEY)
      .update(raw)
      .digest('hex');
    requireRule(
      safeEqual(expected, signature.toLowerCase()),
      401,
      'WEBHOOK_SIGNATURE_INVALID',
      'Invalid webhook signature.',
    );
    let event: { event?: string; data?: { reference?: unknown } };
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new AppError(422, 'WEBHOOK_INVALID', 'Invalid webhook payload.');
    }
    if (event.event !== 'charge.success') return { accepted: true };
    requireRule(
      typeof event.data?.reference === 'string' && event.data.reference.length <= 200,
      422,
      'WEBHOOK_INVALID',
      'Invalid payment reference.',
    );
    const payment = await this.db.payment.findUnique({
      where: { providerReference: event.data.reference },
    });
    if (!payment) return { accepted: true }; // Other transactions on the same provider account are irrelevant.
    await this.db.backgroundJob.upsert({
      where: { deduplicationKey: `webhook:${payment.id}` },
      create: {
        teamId: payment.teamId,
        kind: 'VERIFY_PAYMENT',
        payload: { paymentId: payment.id },
        deduplicationKey: `webhook:${payment.id}`,
      },
      update: {},
    });
    return { accepted: true };
  }
}
