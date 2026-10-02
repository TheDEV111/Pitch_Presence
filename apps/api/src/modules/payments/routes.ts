import { schemas } from '@pitchpresence/shared';
import { type Router, empty } from '../../plugins/router.js';
import { requireRule, rateLimit } from '../../plugins/core.js';
import type { PaymentService } from './service.js';
export function paymentRoutes(r: Router, service: PaymentService) {
  r.add(
    'POST',
    '/api/v1/payments/paystack/initialize',
    schemas.initialize,
    (i, c) => {
      const key = c.request.headers['idempotency-key'];
      requireRule(
        typeof key === 'string' && /^[a-zA-Z0-9_-]{8,128}$/.test(key),
        422,
        'IDEMPOTENCY_KEY_REQUIRED',
        'Provide an Idempotency-Key of 8–128 letters, digits, underscores or hyphens.',
      );
      return service.initialize(c.user, i, key, c.request.id);
    },
    { access: 'PLAYER' },
  );
  r.add(
    'POST',
    '/api/v1/payments/paystack/webhook',
    empty,
    (_, c) => {
      const sig = c.request.headers['x-paystack-signature'];
      return service.webhook(
        c.request.rawBody ?? Buffer.alloc(0),
        typeof sig === 'string' ? sig : undefined,
      );
    },
    { access: 'public', raw: true },
  );
  const owned = async (id: string, userId: string, teamId: string) => {
    const payment = await r.db.payment.findFirst({ where: { id, playerId: userId, teamId } });
    requireRule(payment, 404, 'NOT_FOUND', 'Payment not found.');
    return payment;
  };
  r.add(
    'GET',
    '/api/v1/payments/:id',
    empty,
    async (_, c) => service.present(await owned(c.params.id!, c.user.id, c.teamId)),
    { access: 'PLAYER' },
  );
  r.add(
    'POST',
    '/api/v1/payments/:id/verify',
    empty,
    async (_, c) => {
      await owned(c.params.id!, c.user.id, c.teamId);
      await rateLimit(r.db, `verify:${c.user.id}`, 12, 60);
      return service.verify(c.params.id!, c.request.id);
    },
    { access: 'PLAYER' },
  );
}
