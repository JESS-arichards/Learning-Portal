import { createApp } from './app.js';
import { config } from './config.js';
import { migrate, pool, closePool } from './db.js';
import { logger } from './errors.js';
import { checkStorage } from './storage.js';
import { initialize } from './readiness.js';

const readiness = { ready: false };
const initialization = () => initialize(readiness, { connect: pool, migrate, storage: checkStorage },
  config.SQL_SERVERLESS_ENABLED, (err) => logger.warn({ err }, 'Learning initialization waiting for infrastructure'));
if (!config.SQL_SERVERLESS_ENABLED) await initialization();
const server = createApp(readiness).listen(config.PORT, () => logger.info({ port: config.PORT }, 'Learning Portal listening'));
if (config.SQL_SERVERLESS_ENABLED) {
  void initialization().catch((err) => {
    logger.fatal({ err }, 'Learning initialization failed');
    server.close();
    process.exit(1);
  });
}
async function stop() {
  server.close(async () => {
    try { await closePool(); } catch (err) { logger.warn({ err }, 'Learning SQL shutdown failed'); }
    process.exit(0);
  });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
