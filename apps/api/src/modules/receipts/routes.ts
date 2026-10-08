import { schemas } from '@pitchpresence/shared';
import { empty, type Router } from '../../plugins/router.js';
import { rateLimit } from '../../plugins/core.js';
import type { ReceiptService } from './service.js';
export function receiptRoutes(r: Router, service: ReceiptService) {
  r.add(
    'POST',
    '/api/v1/me/dues/:id/receipt',
    schemas.receiptUpload,
    (i, c) => service.upload(c.user, c.params.id!, i, c.request.id),
    { access: 'PLAYER', bodyLimit: 2_850_000 },
  );
  r.add('POST', '/api/v1/management/receipts/:id/review', schemas.receiptReview, (i, c) =>
    service.review(c.user, c.params.id!, i, c.request.id),
  );
  r.add(
    'GET',
    '/api/v1/receipts/:id/file',
    empty,
    async (_, c) => {
      await rateLimit(r.db, `receipt-download:${c.user.id}`, 30, 60);
      const file = await service.download(c.user, c.params.id!);
      return c.reply
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        .header('Content-Disposition', `attachment; filename="${file.fileName}"`)
        .type('application/octet-stream')
        .send(file.bytes);
    },
    { access: 'authenticated', binary: true },
  );
}
