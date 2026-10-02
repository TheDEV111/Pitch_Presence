import { pagination } from '@pitchpresence/shared';
import type { Router } from '../../plugins/router.js';
import { teamCursor, cursorPage, page } from '../../plugins/core.js';
export function auditRoutes(r: Router) {
  r.add(
    'GET',
    '/api/v1/management/audit-events',
    pagination,
    async (i, c) => {
      await teamCursor(r.db, 'AuditEvent', c.teamId, i.cursor);
      return page(
        await r.db.auditEvent.findMany({
          ...cursorPage(i.cursor, i.limit),
          where: { teamId: c.teamId },
        }),
        i.limit,
      );
    },
    { query: true },
  );
}
