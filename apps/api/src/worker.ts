import { setTimeout } from 'node:timers/promises';
import { PrismaClient } from '@pitchpresence/database';
import { loadConfig } from './config/index.js';
import { createProviders } from './infrastructure/providers.js';
import { JobRunner } from './infrastructure/jobs.js';
import { PaymentService } from './modules/payments/service.js';
const config = loadConfig();
const db = new PrismaClient();
const providers = createProviders(config);
const runner = new JobRunner(
  db,
  config,
  providers,
  new PaymentService(db, config, providers),
  (event) => {
    if (config.LOG_LEVEL !== 'silent') console.error(JSON.stringify(event));
  },
);
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stopped = true;
  });
let maintained = 0;
try {
  while (!stopped) {
    try {
      if (Date.now() - maintained > 60_000) {
        await runner.maintain();
        maintained = Date.now();
      }
      if (!(await runner.tick())) await setTimeout(1000);
    } catch {
      console.error(
        JSON.stringify({ level: 'error', message: 'Worker database operation failed' }),
      );
      await setTimeout(1000);
    }
  }
} finally {
  await db.$disconnect();
}
