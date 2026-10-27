import { createApp } from './app.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { logger } from './errors.js';
import { checkStorage } from './storage.js';

await migrate();
await checkStorage();
const server = createApp().listen(config.PORT, () => logger.info({ port: config.PORT }, 'Learning Portal listening'));
async function stop() {
  server.close(async () => { await (await pool()).close(); process.exit(0); });
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
