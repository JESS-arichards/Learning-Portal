import { z } from 'zod';
import { config } from './config.js';
import { HttpError, logger } from './errors.js';
import { publicConfigSchema, userSchema } from '../shared/learning.js';

export async function platform(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${config.APPLICATIONS_PORTAL_URL}/api/platform/v1${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'x-platform-key': config.PLATFORM_API_KEY, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    logger.error({ err: error }, 'Central Portal connection failed');
    throw new HttpError(503, 'The central Portal is unavailable. Please try again later.');
  }
  let data: unknown;
  try { data = await response.json(); }
  catch (error) {
    logger.error({ err: error, status: response.status }, 'Central Portal returned a non-JSON response');
    throw new HttpError(503, 'The central Portal returned an invalid response. Please contact support.');
  }
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(data);
    throw new HttpError(response.status >= 500 ? 503 : response.status, parsed.success ? parsed.data.error : 'Central Portal rejected the request.');
  }
  return data;
}
export async function getUser(id: number) {
  return parsePlatform(userSchema, await platform(`/users/${id}`));
}
export async function findUsers(emails: string[]) {
  return parsePlatform(z.object({ users: z.array(userSchema) }), await platform('/users/lookup', 'POST', { emails })).users;
}
export async function publicConfig() {
  return parsePlatform(publicConfigSchema, await platform('/learning/config'));
}
export function parsePlatform<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    logger.error({ issues: result.error.issues.map((i) => ({ path: i.path, code: i.code })) }, 'Central Portal response contract mismatch');
    throw new HttpError(503, 'The central Portal integration needs updating. Please contact support.');
  }
  return result.data;
}
