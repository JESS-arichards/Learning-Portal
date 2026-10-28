import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWithRetry, isTransientSqlError } from './availability.js';

afterEach(() => vi.useRealTimers());
describe('optional SQL connection wake retries', () => {
  it.each([
    { number: 40613 }, { code: 'ETIMEOUT' }, { code: 'ESOCKET' },
    { originalError: { info: { number: 40197 } } }, { precedingErrors: [{ number: 40501 }] },
    { cause: { code: 'ECONNRESET' } },
  ])('recognizes known transient SQL error %j', (error) => {
    expect(isTransientSqlError(error)).toBe(true);
  });
  it.each([{ code: 'ELOGIN', number: 18456 }, { number: 208 }, { number: 2627 }, { number: 1205 }, new Error('database unavailable'), null])(
    'does not classify unknown, credential, query or write errors as wake failures: %j', (error) => {
      expect(isTransientSqlError(error)).toBe(false);
    },
  );
  it('does not retry at all by default', async () => {
    const connect = vi.fn().mockRejectedValue({ number: 40613 });
    await expect(connectWithRetry(connect, false)).rejects.toEqual({ number: 40613 });
    expect(connect).toHaveBeenCalledOnce();
  });
  it('backs off transient connection establishment, then succeeds', async () => {
    vi.useFakeTimers();
    const connect = vi.fn().mockRejectedValueOnce({ number: 40613 }).mockRejectedValueOnce({ code: 'ETIMEOUT' }).mockResolvedValue('connected');
    const result = connectWithRetry(connect, true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await result).toBe('connected');
    expect(connect).toHaveBeenCalledTimes(3);
    expect(connect.mock.calls.map(([remaining]) => remaining)).toEqual([90000, 89000, 87000]);
  });
  it('exhausts the 90-second budget including time spent connecting', async () => {
    vi.useFakeTimers();
    const started = Date.now();
    const connect = vi.fn(async (remaining: number) => {
      await new Promise((resolve) => setTimeout(resolve, Math.min(15000, remaining)));
      throw { number: 40613 };
    });
    const result = expect(connectWithRetry(connect, true)).rejects.toEqual({ number: 40613 });
    await vi.advanceTimersByTimeAsync(90000);
    await result;
    expect(Date.now() - started).toBe(90000);
    expect(connect).toHaveBeenCalledTimes(5);
  });
  it('fails immediately on permanent connection errors even when enabled', async () => {
    const connect = vi.fn().mockRejectedValue({ code: 'ELOGIN', number: 18456 });
    await expect(connectWithRetry(connect, true)).rejects.toMatchObject({ number: 18456 });
    expect(connect).toHaveBeenCalledOnce();
  });
});
