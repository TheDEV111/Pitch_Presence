import { writeFile } from 'node:fs/promises';
import { buildApp } from '../apps/api/src/app.js';
import { loadConfig } from '../apps/api/src/config/index.js';
const config = loadConfig({
  ...process.env,
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://localhost/pitchpresence',
  SESSION_SECRET: 'documentation-session-secret-000000000',
  QR_SIGNING_SECRET: 'documentation-qr-secret-0000000000000',
  LOG_LEVEL: 'silent',
});
const { app, openapi } = await buildApp(config);
await writeFile('docs/backend/openapi.json', JSON.stringify(openapi, null, 2) + '\n');
await app.close();
