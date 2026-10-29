import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const batch = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
const close = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const clients = vi.hoisted(() => [] as { connected: boolean }[]);
vi.mock('./config.js', () => ({ config: {
  SQL_SERVER: 'sql.test', SQL_DATABASE: 'learning', SQL_USER: 'learning', SQL_PASSWORD: 'test-password',
  SQL_ENCRYPT: 'true', SQL_TRUST_SERVER_CERTIFICATE: 'false',
} }));
vi.mock('mssql', () => ({
  default: {
    ConnectionPool: class {
      connected = true;
      constructor() { clients.push(this); }
      on() {}
      async connect() { await connect(); return this; }
      close = close;
      request() { return { batch }; }
    },
  },
}));
import { migrate, pool, closePool } from './db.js';
beforeEach(async () => {
  await closePool();
  vi.clearAllMocks();
  clients.length = 0;
  connect.mockResolvedValue(undefined);
});
describe('canonical Learning schema', () => {
  it('executes the exact DBA schema script on every initialization instead of separate DDL', async () => {
    const script = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
    await migrate();
    await migrate();
    expect(connect).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenNthCalledWith(1, script);
    expect(batch).toHaveBeenNthCalledWith(2, script);
  });
  it('replaces disconnected cached pools and shares concurrent reconnects', async () => {
    const first = await pool();
    clients[0].connected = false;
    const [second, third] = await Promise.all([pool(), pool()]);
    expect(second).not.toBe(first);
    expect(third).toBe(second);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledOnce();
  });
  it('clears failed connections so subsequent requests can reconnect without replaying writes', async () => {
    connect.mockRejectedValueOnce({ number: 40613 });
    await expect(pool()).rejects.toMatchObject({ number: 40613 });
    await pool();
    expect(connect).toHaveBeenCalledTimes(2);
    expect(batch).not.toHaveBeenCalled();
  });
  it('warns on failed cleanup without replacing the original connection error', async () => {
    const original = { number: 40613 };
    connect.mockRejectedValueOnce(original);
    close.mockRejectedValueOnce(new Error('Cleanup failed'));
    await expect(pool()).rejects.toBe(original);
  });
  it('never retries a migration batch or discards a still-connected pool on query failure', async () => {
    batch.mockRejectedValueOnce({ code: 'ETIMEOUT' });
    await expect(migrate()).rejects.toMatchObject({ code: 'ETIMEOUT' });
    await pool();
    expect(connect).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledOnce();
  });
});
