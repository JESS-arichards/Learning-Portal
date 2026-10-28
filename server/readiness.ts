import { isTransientSqlError } from './availability.js';

export interface Readiness { ready: boolean }
function transientStorage(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const value = error as { statusCode?: number; code?: string };
  return [408, 429, 500, 502, 503, 504].includes(value.statusCode ?? 0)
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'REQUEST_SEND_ERROR'].includes(value.code ?? '');
}

export async function initialize(
  readiness: Readiness,
  steps: { connect: () => Promise<unknown>; migrate: () => Promise<void>; storage: () => Promise<void> },
  serverless: boolean,
  onRetry: (error: unknown) => void = () => {},
) {
  async function retry(step: () => Promise<unknown>, transient: (error: unknown) => boolean) {
    // Startup deliberately waits persistently; each pool wake cycle has its own 90s budget.
    for (;;) {
      try { await step(); return; }
      catch (error) {
        if (!serverless || !transient(error)) throw error;
        onRetry(error);
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }
  await retry(steps.connect, isTransientSqlError);
  // Never replay a migration batch or application write after an ambiguous failure.
  await steps.migrate();
  await retry(steps.storage, transientStorage);
  readiness.ready = true;
}
