const transientSqlNumbers = new Set([40613, 40197, 40501, 10928, 10929, 49918, 49919, 49920, 42108, 42109]);
const connectionCodes = new Set(['ETIMEOUT', 'ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

export function isTransientSqlError(error: unknown): boolean {
  const seen = new Set<unknown>();
  function check(value: unknown): boolean {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    const item = value as { number?: unknown; code?: unknown; originalError?: unknown; cause?: unknown; info?: unknown; precedingErrors?: unknown[] };
    return transientSqlNumbers.has(Number(item.number))
      || connectionCodes.has(String(item.code))
      || check(item.originalError) || check(item.cause) || check(item.info)
      || (Array.isArray(item.precedingErrors) && item.precedingErrors.some(check));
  }
  return check(error);
}

export const SQL_WAKE_BUDGET_MS = 90000;
export async function connectWithRetry<T>(
  connect: (remainingMs: number) => Promise<T>,
  enabled: boolean,
): Promise<T> {
  const deadline = Date.now() + SQL_WAKE_BUDGET_MS;
  let delay = 1000;
  for (;;) {
    try { return await connect(Math.max(1, deadline - Date.now())); }
    catch (error) {
      const remaining = deadline - Date.now();
      if (!enabled || !isTransientSqlError(error) || remaining <= delay) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 10000);
    }
  }
}
