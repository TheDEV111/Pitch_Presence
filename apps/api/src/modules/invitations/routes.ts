import { pagination } from '@pitchpresence/shared';
import { type Router, empty } from '../../plugins/router.js';
import {
  audit,
  teamCursor,
  cursorPage,
  digest,
  page,
  randomToken,
  requireRule,
} from '../../plugins/core.js';
import type { Config } from '../../config/index.js';
export function invitationRoutes(r: Router, config: Config) {
  r.add('POST', '/api/v1/management/invitations', empty, async (_, c) => {
    const token = randomToken();
    const invitation = await r.db.$transaction(async (tx) => {
      const row = await tx.invitation.create({
        data: {
          teamId: c.teamId,
          tokenHash: digest(token),
          createdBy: c.user.id,
          expiresAt: new Date(Date.now() + 7 * 86400_000),
        },
      });
      await audit(tx, c.user.id, 'INVITATION_CREATED', row.id, c.request.id);
      return row;
    });
    return {
      id: invitation.id,
      expiresAt: invitation.expiresAt,
      registrationUrl: `${config.APP_URL}/register?invite=${token}`,
    };
  });
  r.add(
    'GET',
    '/api/v1/management/invitations',
    pagination,
    async (i, c) => {
      await teamCursor(r.db, 'Invitation', c.teamId, i.cursor);
      return page(
        await r.db.invitation.findMany({
          ...cursorPage(i.cursor, i.limit),
          where: { teamId: c.teamId, kind: 'PLAYER' },
          select: { id: true, createdBy: true, expiresAt: true, revokedAt: true, createdAt: true },
        }),
        i.limit,
      );
    },
    { query: true },
  );
  r.add('DELETE', '/api/v1/management/invitations/:id', empty, async (_, c) =>
    r.db.$transaction(async (tx) => {
      const result = await tx.invitation.updateMany({
        where: { id: c.params.id, teamId: c.teamId },
        data: { revokedAt: new Date() },
      });
      requireRule(result.count, 404, 'NOT_FOUND', 'Invitation not found.');
      await audit(tx, c.user.id, 'INVITATION_REVOKED', c.params.id!, c.request.id);
      return { revoked: true };
    }),
  );
}
