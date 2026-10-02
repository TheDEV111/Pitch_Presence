import { buildApp } from './app.js';
import { loadConfig } from './config/index.js';
const config = loadConfig();
const { app } = await buildApp(config);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ port: config.PORT, host: '0.0.0.0' });
