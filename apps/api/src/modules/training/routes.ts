import { pagination, schemas } from '@pitchpresence/shared';
import { type Router, empty } from '../../plugins/router.js';
import { page, requireRule } from '../../plugins/core.js';
import type { TrainingService } from './service.js';
export function trainingRoutes(r: Router, service: TrainingService) {
  r.add('POST', '/api/v1/training-sessions', schemas.training, (i, c) =>
    service.start(i, c.user.id, c.request.id),
  );
  r.add(
    'GET',
    '/api/v1/training-sessions',
    pagination,
    async (i, c) => {
      if (i.cursor)
        requireRule(
          await r.db.trainingSession.findFirst({ where: { id: i.cursor, teamId: c.teamId } }),
          404,
          'NOT_FOUND',
          'Session cursor not found.',
        );
      return page(
        await r.db.trainingSession.findMany({
          take: i.limit + 1,
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          ...(i.cursor ? { cursor: { id: i.cursor }, skip: 1 } : {}),
          where: { teamId: c.teamId },
        }),
        i.limit,
      );
    },
    { query: true },
  );
  r.add('GET', '/api/v1/training-sessions/:id', empty, async (_, c) => {
    const row = await r.db.trainingSession.findFirst({
      where: { id: c.params.id, teamId: c.teamId },
    });
    requireRule(row, 404, 'NOT_FOUND', 'Session not found.');
    return row;
  });
  r.add('POST', '/api/v1/training-sessions/:id/qr-token', empty, (_, c) =>
    service.qr(c.params.id!, c.teamId),
  );
  r.add('POST', '/api/v1/training-sessions/:id/close', empty, (_, c) =>
    service.close(c.params.id!, c.user.id, c.request.id),
  );
}
