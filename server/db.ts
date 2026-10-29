import sql from 'mssql';
import { config } from './config.js';
import { logger } from './errors.js';
import { readFile } from 'node:fs/promises';
import { sqlConfig } from './sqlConfig.js';
import { connectWithRetry } from './availability.js';

let connection: Promise<sql.ConnectionPool> | undefined;
export async function pool(): Promise<sql.ConnectionPool> {
  if (connection) {
    const pending = connection;
    const cached = await pending;
    if (connection !== pending) return pool();
    if (cached.connected !== false) return cached;
    connection = undefined;
    void cached.close().catch((err) => logger.warn({ err }, 'Learning SQL pool close failed'));
  }
  if (!connection) {
    const pending = connectWithRetry(async (remainingMs) => {
      const settings = sqlConfig(config);
      if (config.SQL_SERVERLESS_ENABLED) {
        settings.connectionTimeout = Math.min(15000, remainingMs);
        settings.options = { ...settings.options, connectTimeout: settings.connectionTimeout };
      }
      const client = new sql.ConnectionPool(settings);
      client.on('error', (err) => logger.error({ err }, 'Learning SQL pool error'));
      try { return await client.connect(); }
      catch (error) {
        await client.close().catch((err) => logger.warn({ err }, 'Learning failed SQL connection cleanup failed'));
        throw error;
      }
    }, config.SQL_SERVERLESS_ENABLED);
    connection = pending;
    void pending.catch(() => { if (connection === pending) connection = undefined; });
  }
  return connection;
}
export async function closePool() {
  const pending = connection;
  connection = undefined;
  if (pending) await (await pending).close();
}
export async function transaction<T>(work: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(await pool());
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    // All learning mutations share this lock, including the first write to an empty database.
    await tx.request().query("DECLARE @r int; EXEC @r = sp_getapplock @Resource = 'learning-write', @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000; IF @r < 0 THROW 51000, 'Learning data is busy. Please retry.', 1;");
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch (rollbackError) { logger.error({ err: rollbackError }, 'Learning transaction rollback failed'); }
    throw error;
  }
}
export async function migrate() {
  const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  await (await pool()).request().batch(schema);
}
export { sql };
