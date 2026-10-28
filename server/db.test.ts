import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';

const batch = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());
vi.mock('./config.js', () => ({ config: {
  SQL_SERVER: 'sql.test', SQL_DATABASE: 'learning', SQL_USER: 'learning', SQL_PASSWORD: 'test-password',
  SQL_ENCRYPT: 'true', SQL_TRUST_SERVER_CERTIFICATE: 'false',
} }));
vi.mock('mssql', () => ({
  default: {
    ConnectionPool: class {
      on() {}
      connect() { connect(); return Promise.resolve({ request: () => ({ batch }) }); }
    },
  },
}));
import { migrate } from './db.js';
describe('canonical Learning schema', () => {
  it('executes the exact DBA schema script on every initialization instead of separate DDL', async () => {
    const script = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
    await migrate();
    await migrate();
    expect(connect).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenNthCalledWith(1, script);
    expect(batch).toHaveBeenNthCalledWith(2, script);
  });
});
