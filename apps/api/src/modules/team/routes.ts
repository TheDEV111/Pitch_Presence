import { z } from 'zod';
import { pagination, schemas } from '@pitchpresence/shared';
import { type Router, empty } from '../../plugins/router.js';
import {
  teamCursor,
  cursorPage,
  digest,
  page,
  rateLimit,
  requireRule,
} from '../../plugins/core.js';
import { publicUser } from '../auth/service.js';
import type { TeamService } from './service.js';
export function teamRoutes(r: Router, service: TeamService) {
  r.add(
    'POST',
    '/api/v1/teams',
    schemas.team,
    (i, c) => service.create(c.user, i.name, c.request.id),
    { access: 'authenticated' },
  );
  r.add(
    'POST',
    '/api/v1/auth/staff-invitation/decline',
    empty,
    async (_, c) => {
      requireRule(
        c.user.role === 'MANAGER' && !c.user.teamId,
        409,
        'TEAM_ALREADY_ASSIGNED',
        'This account already has a team.',
      );
      await r.db.user.update({ where: { id: c.user.id }, data: { pendingInvitationId: null } });
      return { declined: true };
    },
    { access: 'authenticated' },
  );
  r.add(
    'GET',
    '/api/v1/invitations/preview',
    z.object({ token: z.string().min(32).max(200) }).strict(),
    async (i, c) => {
      await rateLimit(r.db, `invitation-preview:${c.request.ip}`, 30, 60);
      const row = await r.db.invitation.findUnique({ where: { tokenHash: digest(i.token) } });
      requireRule(
        row && !row.revokedAt && !row.acceptedAt && row.expiresAt > new Date(),
        422,
        'INVITATION_INVALID',
        'Ask your team for a new invitation.',
      );
      const team = await r.db.team.findUniqueOrThrow({
        where: { id: row.teamId },
        select: { name: true },
      });
      return { kind: row.kind, email: row.email, teamName: team.name, expiresAt: row.expiresAt };
    },
    { access: 'public', query: true },
  );
  r.add('GET', '/api/v1/management/overview', empty, (_, c) => service.overview(c.teamId));
  r.add('GET', '/api/v1/management/team', empty, (_, c) => service.settings(c.teamId));
  r.add(
    'GET',
    '/api/v1/management/staff',
    pagination,
    async (i, c) => {
      await teamCursor(r.db, 'User', c.teamId, i.cursor);
      return page(
        (
          await r.db.user.findMany({
            ...cursorPage(i.cursor, i.limit),
            where: { teamId: c.teamId, role: 'MANAGER' },
          })
        ).map(publicUser),
        i.limit,
      );
    },
    { query: true },
  );
  r.add(
    'GET',
    '/api/v1/management/staff-invitations',
    pagination,
    async (i, c) => {
      await teamCursor(r.db, 'Invitation', c.teamId, i.cursor);
      return page(
        await r.db.invitation.findMany({
          ...cursorPage(i.cursor, i.limit),
          where: { teamId: c.teamId, kind: 'MANAGER' },
          select: { id: true, email: true, expiresAt: true, revokedAt: true, acceptedAt: true },
        }),
        i.limit,
      );
    },
    { query: true },
  );
  r.add('POST', '/api/v1/management/staff-invitations', schemas.staffInvitation, async (i, c) => {
    await rateLimit(r.db, `staff-invite:${c.user.id}`, 20, 3600);
    return service.invite(c.user, i.email, c.request.id);
  });
  r.add('GET', '/api/v1/management/banks', empty, async (_, c) => {
    await rateLimit(r.db, `bank-list:${c.user.id}`, 20, 60);
    return service.banks();
  });
  r.add('POST', '/api/v1/management/bank/resolve', schemas.bankResolve, async (i, c) => {
    await rateLimit(r.db, `bank-resolve:${c.user.id}`, 10, 60);
    return { accountName: await service.resolve(i.bankCode, i.accountNumber) };
  });
  r.add('POST', '/api/v1/management/bank', schemas.bankSetup, (i, c) =>
    service.setup(c.user, i, c.request.id),
  );
  r.add('POST', '/api/v1/management/transfer-account/request', schemas.transferChange, (i, c) =>
    service.transfers.request(c.user, i, c.request.id),
  );
  r.add('POST', '/api/v1/management/transfer-account/confirm', schemas.transferConfirm, (i, c) =>
    service.transfers.confirm(c.user, i, c.request.id),
  );
  r.add(
    'GET',
    '/api/v1/me/transfer-account',
    empty,
    async (_, c) => ({ account: await service.transfers.current(c.teamId) }),
    { access: 'PLAYER' },
  );
  r.add('POST', '/api/v1/management/bank/reconcile', empty, (_, c) =>
    service.reconcile(c.user, c.request.id),
  );
}
