import { loadConfig } from '../apps/api/dist/config/index.js';

try {
  const config = loadConfig();
  console.log(
    `Runtime environment validation passed (${config.APP_ENV}). No database connection was made.`,
  );
} catch {
  console.error(
    'Runtime environment validation failed. Check environment settings, staging project references, database destination and approved email addresses. No migration was started.',
  );
  process.exitCode = 1;
}
