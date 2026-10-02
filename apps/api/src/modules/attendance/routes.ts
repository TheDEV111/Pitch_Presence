import { pagination, schemas } from '@pitchpresence/shared';
import { type Router, empty } from '../../plugins/router.js';
import { cursorPage, page } from '../../plugins/core.js';
import type { AttendanceService } from './service.js';
export function attendanceRoutes(r: Router, service: AttendanceService) {
  r.add(
    'POST',
    '/api/v1/attendance/check-in',
    schemas.checkIn,
    (i, c) => service.checkIn(i.token, c.user.id, c.request.id),
    { access: 'PLAYER' },
  );
  r.add('POST', '/api/v1/training-sessions/:id/attendance/manual', schemas.manual, (i, c) =>
    service.record(c.params.id!, i.playerId, c.user.id, c.request.id),
  );
  r.add('GET', '/api/v1/training-sessions/:id/attendance', empty, (_, c) =>
    service.roster(c.params.id!, c.teamId),
  );
  r.add(
    'GET',
    '/api/v1/me/attendance',
    pagination,
    async (i, c) => {
      const rows = await r.db.sessionParticipant.findMany({
        ...cursorPage(i.cursor, i.limit),
        where: { playerId: c.user.id, teamId: c.teamId },
        include: {
          attendance: true,
          session: { select: { id: true, name: true, date: true, status: true } },
        },
      });
      return page(
        rows.map((row) => ({
          id: row.id,
          session: row.session,
          attendance: row.attendance,
          result: row.attendance
            ? 'PRESENT'
            : row.session.status === 'CLOSED'
              ? 'ABSENT'
              : 'NOT_CHECKED_IN',
        })),
        i.limit,
      );
    },
    { access: 'PLAYER', query: true },
  );
}
