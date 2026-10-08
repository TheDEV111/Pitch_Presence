import type { Router } from '../../plugins/router.js';
import { empty } from '../../plugins/router.js';
import { pushSubscriptionInput } from './schema.js';
import type { NotificationService } from './service.js';
export function notificationRoutes(r: Router, service: NotificationService) {
  r.add('GET', '/api/v1/management/notifications/push', empty, (_, c) =>
    service.settings(c.session),
  );
  r.add('POST', '/api/v1/management/notifications/push', pushSubscriptionInput, (input, c) =>
    service.subscribe(c.user, c.session, input),
  );
  r.add('DELETE', '/api/v1/management/notifications/push', empty, (_, c) =>
    service.unsubscribe(c.session),
  );
}
