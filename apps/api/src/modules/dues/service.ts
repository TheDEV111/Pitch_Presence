import type { PrismaClient, User } from '@pitchpresence/database';
import {
  actorTeam,
  teamCursor,
  audit,
  localMonth,
  lock,
  monthRange,
  requireRule,
  type Tx,
} from '../../plugins/core.js';
export async function resolveDues(tx: Tx, player: User, month: string) {
  requireRule(
    player.role === 'PLAYER' && player.isVerified && player.activatedAt,
    422,
    'PLAYER_UNAVAILABLE',
    'A verified player is required.',
  );
  requireRule(
    month >= localMonth(player.activatedAt) && month <= localMonth(),
    422,
    'MONTH_INELIGIBLE',
    'Choose a month between joining and the current month.',
  );
  return tx.monthlyDues.upsert({
    where: { playerId_month: { playerId: player.id, month } },
    create: { teamId: player.teamId!, playerId: player.id, month },
    update: {},
  });
}
export async function recomputeDues(tx: Tx, duesId: string) {
  const qualifying = await tx.payment.findFirst({
    where: { monthlyDuesId: duesId, status: 'SUCCESS', reversedAt: null },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
  });
  return tx.monthlyDues.update({
    where: { id: duesId },
    data: {
      status: qualifying ? 'PAID' : 'NOT_PAID',
      qualifyingPaymentId: qualifying?.id ?? null,
      paidAt: qualifying?.paidAt ?? null,
    },
  });
}
export class DuesService {
  constructor(private db: PrismaClient) {}
  async configure(month: string, minimumAmount: number, managerId: string, requestId: string) {
    const teamId = await actorTeam(this.db, managerId);
    return this.db.$transaction(async (tx) => {
      // An advisory lock also serializes creation before a DuesPeriod row exists.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`dues-period:${teamId}:${month}`}))::text`;
      let old = await tx.duesPeriod.findUnique({ where: { teamId_month: { teamId, month } } });
      if (old) {
        await lock(tx, 'DuesPeriod', old.id);
        old = await tx.duesPeriod.findUnique({ where: { id: old.id } });
      }
      requireRule(
        !old?.frozenAt || old.minimumAmount === minimumAmount,
        409,
        'DUES_PERIOD_FROZEN',
        'This minimum is frozen because settlement activity has started.',
      );
      const period = await tx.duesPeriod.upsert({
        where: { teamId_month: { teamId, month } },
        create: { teamId, month, minimumAmount, configuredBy: managerId },
        update: { minimumAmount, configuredBy: managerId },
      });
      await audit(tx, managerId, 'DUES_PERIOD_CONFIGURED', month, requestId, {
        previousMinimum: old?.minimumAmount ?? null,
        minimumAmount,
      });
      return period;
    });
  }
  async own(player: User, limit = 25, cursor?: string) {
    const months = monthRange(localMonth(player.activatedAt!));
    await this.db.monthlyDues.createMany({
      data: months.map((month) => ({ teamId: player.teamId!, playerId: player.id, month })),
      skipDuplicates: true,
    });
    const records = await this.db.monthlyDues.findMany({
      where: {
        teamId: player.teamId!,
        playerId: player.id,
        ...(cursor ? { month: { lt: cursor } } : {}),
      },
      take: limit + 1,
      orderBy: { month: 'desc' },
      include: {
        payments: {
          select: {
            id: true,
            provider: true,
            status: true,
            amount: true,
            currency: true,
            paidAt: true,
            reversedAt: true,
            providerReference: true,
          },
        },
      },
    });
    const periods = await this.db.duesPeriod.findMany({
      where: { teamId: player.teamId!, month: { in: months } },
    });
    const team = await this.db.team.findUniqueOrThrow({ where: { id: player.teamId! } });
    const ready = team.paymentProfileId
      ? await this.db.teamPaymentProfile.findFirst({
          where: { id: team.paymentProfileId, teamId: player.teamId!, status: 'READY' },
        })
      : null;
    return {
      nextCursor: records.length > limit ? records[limit - 1]!.month : null,
      items: records.slice(0, limit).map((r) => {
        const p = periods.find((p) => p.month === r.month);
        return {
          ...r,
          minimumAmount: p?.minimumAmount ?? null,
          currency: 'NGN',
          paymentsReady: !!ready,
          paymentAvailable: r.status === 'NOT_PAID' && !!p && !!ready,
        };
      }),
    };
  }
  async management(
    month: string,
    limit: number,
    cursor: string | undefined,
    status: 'PAID' | 'NOT_PAID' | undefined,
    teamId: string,
  ) {
    await teamCursor(this.db, 'MonthlyDues', teamId, cursor);
    const [year, number] = month.split('-').map(Number) as [number, number];
    const nextMonth =
      number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
    const end = new Date(`${nextMonth}-01T00:00:00+01:00`);
    const eligible = await this.db.user.findMany({
      where: {
        teamId,
        role: 'PLAYER',
        isVerified: true,
        activatedAt: { lt: end },
        ...(month === localMonth() ? { active: true } : {}),
      },
    });
    requireRule(
      month <= localMonth(),
      422,
      'MONTH_INELIGIBLE',
      'Future months cannot be reported.',
    );
    await this.db.$transaction(async (tx) => {
      for (const player of eligible) await resolveDues(tx, player, month);
    });
    const rows = await this.db.monthlyDues.findMany({
      where: { teamId, month, playerId: { in: eligible.map((p) => p.id) }, status },
      take: limit + 1,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        player: { select: { id: true, name: true, active: true } },
        payments: {
          select: {
            id: true,
            provider: true,
            status: true,
            amount: true,
            reversedAt: true,
            markedBy: true,
            paidAt: true,
            needsReview: true,
          },
        },
      },
    });
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
    };
  }
  async markPaid(
    duesId: string,
    amount: number,
    managerId: string,
    requestId: string,
    externalReference?: string,
  ) {
    const teamId = await actorTeam(this.db, managerId);
    const initial = await this.db.monthlyDues.findFirst({ where: { id: duesId, teamId } });
    requireRule(initial, 404, 'NOT_FOUND', 'Dues record not found.');
    return this.db.$transaction(async (tx) => {
      let period = await tx.duesPeriod.findUnique({
        where: { teamId_month: { teamId, month: initial.month } },
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
        amount >= period.minimumAmount,
        422,
        'PAYMENT_AMOUNT_BELOW_MINIMUM',
        'The amount must meet the monthly minimum.',
      );
      await lock(tx, 'MonthlyDues', duesId);
      const dues = await tx.monthlyDues.findUniqueOrThrow({ where: { id: duesId } });
      requireRule(
        dues.status === 'NOT_PAID',
        409,
        'DUES_ALREADY_PAID',
        'This month is already paid.',
      );
      await tx.duesPeriod.update({
        where: { id: period.id },
        data: { frozenAt: period.frozenAt ?? new Date() },
      });
      const payment = await tx.payment.create({
        data: {
          teamId,
          playerId: dues.playerId,
          monthlyDuesId: duesId,
          amount,
          minimumAmount: period.minimumAmount,
          provider: 'EXTERNAL',
          status: 'SUCCESS',
          markedBy: managerId,
          externalReference,
          paidAt: new Date(),
          verifiedAt: new Date(),
        },
      });
      const updated = await recomputeDues(tx, duesId);
      await audit(tx, managerId, 'DUES_EXTERNAL_CONFIRMED', payment.id, requestId, {
        duesId,
        amount,
        externalReference: externalReference ?? null,
      });
      return { dues: updated, payment };
    });
  }
  async reverse(
    duesId: string,
    paymentId: string,
    reason: string,
    managerId: string,
    requestId: string,
  ) {
    const teamId = await actorTeam(this.db, managerId);
    requireRule(
      await this.db.monthlyDues.findFirst({ where: { id: duesId, teamId } }),
      404,
      'NOT_FOUND',
      'Dues record not found.',
    );
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'MonthlyDues', duesId);
      requireRule(
        await tx.payment.findFirst({ where: { id: paymentId, teamId, monthlyDuesId: duesId } }),
        404,
        'NOT_FOUND',
        'Payment not found.',
      );
      await lock(tx, 'Payment', paymentId);
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      requireRule(
        payment && payment.monthlyDuesId === duesId,
        404,
        'NOT_FOUND',
        'Payment not found.',
      );
      requireRule(
        payment.provider === 'EXTERNAL' && payment.status === 'SUCCESS',
        409,
        'REVERSAL_NOT_ALLOWED',
        'Only external confirmations may be reversed.',
      );
      requireRule(
        !payment.reversedAt,
        409,
        'PAYMENT_ALREADY_REVERSED',
        'This confirmation was already reversed.',
      );
      await tx.payment.update({
        where: { id: paymentId },
        data: { reversedAt: new Date(), reversedBy: managerId, reversalReason: reason },
      });
      const dues = await recomputeDues(tx, duesId);
      await audit(
        tx,
        managerId,
        'DUES_EXTERNAL_REVERSED',
        paymentId,
        requestId,
        { duesId },
        reason,
      );
      return dues;
    });
  }
}
