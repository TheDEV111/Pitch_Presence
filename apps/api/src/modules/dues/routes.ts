import { schemas, monthPagination } from '@pitchpresence/shared';
import { type Router } from '../../plugins/router.js';
import { localMonth } from '../../plugins/core.js';
import type { DuesService } from './service.js';
export function duesRoutes(r: Router, service: DuesService) {
  r.add('PUT', '/api/v1/management/dues-periods/:month', schemas.period, (i, c) =>
    service.configure(c.params.month!, i.minimumAmount, c.user.id, c.request.id),
  );
  r.add(
    'GET',
    '/api/v1/management/dues-periods',
    monthPagination,
    async (i, c) => {
      const rows = await r.db.duesPeriod.findMany({
        where: { teamId: c.teamId, ...(i.cursor ? { month: { lt: i.cursor } } : {}) },
        take: i.limit + 1,
        orderBy: { month: 'desc' },
      });
      return {
        items: rows.slice(0, i.limit),
        nextCursor: rows.length > i.limit ? rows[i.limit - 1]!.month : null,
      };
    },
    { query: true },
  );
  r.add(
    'GET',
    '/api/v1/me/dues',
    monthPagination,
    (i, c) => service.own(c.user, i.limit, i.cursor),
    { access: 'PLAYER', query: true },
  );
  r.add(
    'GET',
    '/api/v1/management/dues',
    schemas.duesQuery,
    (i, c) => service.management(i.month ?? localMonth(), i.limit, i.cursor, i.status, c.teamId),
    { query: true },
  );
  r.add('POST', '/api/v1/dues/:id/mark-paid', schemas.markPaid, (i, c) =>
    service.markPaid(c.params.id!, i.amount, c.user.id, c.request.id, i.externalReference),
  );
  r.add('POST', '/api/v1/dues/:id/reverse-manual-payment', schemas.reverse, (i, c) =>
    service.reverse(c.params.id!, i.paymentId, i.reason, c.user.id, c.request.id),
  );
}
