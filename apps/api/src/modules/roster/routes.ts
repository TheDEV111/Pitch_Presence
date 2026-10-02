import { pagination, schemas } from '@pitchpresence/shared';
import type { Router } from '../../plugins/router.js';
import { audit, teamCursor, cursorPage, lock, page, requireRule } from '../../plugins/core.js';
import { publicUser } from '../auth/service.js';
export function rosterRoutes(r: Router) {
  r.add(
    'GET',
    '/api/v1/management/players',
    pagination,
    async (i, c) => {
      await teamCursor(r.db, 'User', c.teamId, i.cursor);
      const rows = await r.db.user.findMany({
        ...cursorPage(i.cursor, i.limit),
        where: { role: 'PLAYER', teamId: c.teamId },
      });
      return page(rows.map(publicUser), i.limit);
    },
    { query: true },
  );
  r.add('PATCH', '/api/v1/management/players/:id', schemas.roster, async (i, c) =>
    r.db.$transaction(async (tx) => {
      requireRule(
        await tx.user.findFirst({ where: { id: c.params.id, teamId: c.teamId, role: 'PLAYER' } }),
        404,
        'NOT_FOUND',
        'Player not found.',
      );
      await lock(tx, 'User', c.params.id!);
      const user = await tx.user.findFirst({ where: { id: c.params.id, teamId: c.teamId } });
      requireRule(user?.role === 'PLAYER', 404, 'NOT_FOUND', 'Player not found.');
      requireRule(
        i.active !== true || user.isVerified,
        409,
        'EMAIL_UNVERIFIED',
        'Verify email before activating a player.',
      );
      const updated = await tx.user.update({ where: { id: user.id }, data: i });
      if (i.active === false)
        await tx.deviceSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await audit(tx, c.user.id, 'PLAYER_UPDATED', user.id, c.request.id, {
        before: { name: user.name, active: user.active },
        after: { name: updated.name, active: updated.active },
      });
      return publicUser(updated);
    }),
  );
}
