import sql from 'mssql';
import { config } from './config.js';
import { logger } from './errors.js';
import { readFile } from 'node:fs/promises';
import { sqlConfig } from './sqlConfig.js';

let connection: Promise<sql.ConnectionPool> | undefined;
export function pool() {
  if (!connection) {
    const client = new sql.ConnectionPool(sqlConfig(config));
    client.on('error', (err) => logger.error({ err }, 'Learning SQL pool error'));
    connection = client.connect().catch((err) => { connection = undefined; throw err; });
  }
  return connection;
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
