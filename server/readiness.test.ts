import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialize } from './readiness.js';

afterEach(() => vi.useRealTimers());
describe('startup readiness', () => {
  it('preserves fail-fast provisioned startup', async () => {
    const readiness = { ready: false };
    const steps = { connect: vi.fn().mockRejectedValue({ number: 40613 }), migrate: vi.fn(), storage: vi.fn() };
    await expect(initialize(readiness, steps, false)).rejects.toMatchObject({ number: 40613 });
    expect(readiness.ready).toBe(false);
    expect(steps.connect).toHaveBeenCalledOnce();
    expect(steps.migrate).not.toHaveBeenCalled();
  });
  it('remains unready during connection and storage outages without replaying migrations', async () => {
    vi.useFakeTimers();
    const readiness = { ready: false };
    const steps = {
      connect: vi.fn().mockRejectedValueOnce({ number: 40613 }).mockResolvedValue(undefined),
      migrate: vi.fn().mockResolvedValue(undefined),
      storage: vi.fn().mockRejectedValueOnce({ statusCode: 503 }).mockResolvedValue(undefined),
    };
    const work = initialize(readiness, steps, true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(readiness.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    await work;
    expect(readiness.ready).toBe(true);
    expect(steps.migrate).toHaveBeenCalledOnce();
  });
  it('never retries a migration write even on transient-looking failures', async () => {
    const readiness = { ready: false };
    const steps = { connect: vi.fn(), migrate: vi.fn().mockRejectedValue({ code: 'ESOCKET' }), storage: vi.fn() };
    await expect(initialize(readiness, steps, true)).rejects.toMatchObject({ code: 'ESOCKET' });
    expect(steps.migrate).toHaveBeenCalledOnce();
    expect(readiness.ready).toBe(false);
    expect(steps.storage).not.toHaveBeenCalled();
  });
  it('does not hide storage credentials or configuration failures behind retries', async () => {
    const steps = { connect: vi.fn(), migrate: vi.fn(), storage: vi.fn().mockRejectedValue({ statusCode: 403 }) };
    await expect(initialize({ ready: false }, steps, true)).rejects.toMatchObject({ statusCode: 403 });
    expect(steps.storage).toHaveBeenCalledOnce();
  });
});
