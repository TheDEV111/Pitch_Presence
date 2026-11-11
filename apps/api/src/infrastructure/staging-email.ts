import type { Config } from '../config/index.js';
import { AppError } from '../plugins/core.js';

export function assertStagingRecipient(config: Config, email: string) {
  if (config.APP_ENV !== 'staging') return;
  const allowed = config.STAGING_EMAIL_ALLOWLIST.split(',').map((entry) =>
    entry.trim().toLowerCase(),
  );
  if (!allowed.includes(email.trim().toLowerCase()))
    throw new AppError(
      403,
      'STAGING_EMAIL_NOT_ALLOWED',
      'This is the staging app. Use an approved test email address or ask the administrator to add yours.',
    );
}
