import { z } from 'zod';
import { config } from './config.js';
import { HttpError, logger } from './errors.js';
import { navigationSchema, publicConfigSchema, userSchema } from '../shared/learning.js';

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
  const data = parsePlatform(publicConfigSchema, await platform('/learning/config'));
  const assetUrl = (asset: string, source: string | null) => {
    if (!source) return null;
    const version = new URL(source, config.APPLICATIONS_PORTAL_URL).searchParams.get('v');
    return `/api/branding/assets/${asset}${version ? `?${new URLSearchParams({ v: version })}` : ''}`;
  };
  return {
    ...data,
    branding: {
      ...data.branding,
      logoUrl: assetUrl('logo', data.branding.logoUrl),
      iconUrl: assetUrl('icon', data.branding.iconUrl),
      backgroundUrl: assetUrl('background', data.branding.backgroundUrl),
      footerLogoUrl: assetUrl('footerLogo', data.branding.footerLogoUrl),
    },
  };
}
export async function navigationFor(id: number) {
  return parsePlatform(navigationSchema, await platform(`/learning/navigation/${id}`));
}
export async function platformImage(path: string) {
  let response: Response;
  try {
    response = await fetch(`${config.APPLICATIONS_PORTAL_URL}/api/platform/v1${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'x-platform-key': config.PLATFORM_API_KEY },
    });
  } catch (error) {
    logger.error({ err: error }, 'Central Portal image connection failed');
    throw new HttpError(503, 'The central Portal image service is unavailable.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new HttpError(response.status === 404 ? 404 : 503, response.status === 404 ? 'Image not found.' : 'The central Portal image service is unavailable.');
  }
  const contentType = response.headers.get('content-type')?.split(';')[0].trim();
  if (!contentType || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(contentType) || !response.body) {
    await response.body?.cancel();
    logger.error({ contentType }, 'Central Portal returned an invalid image response');
    throw new HttpError(503, 'The central Portal returned an invalid image.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Central image exceeds 10 MB.');
      }
      chunks.push(value);
    }
  } catch (error) {
    logger.error({ err: error }, 'Central Portal image transfer failed');
    throw new HttpError(503, 'The central Portal image could not be loaded.');
  } finally { reader.releaseLock(); }
  return { contentType, data: Buffer.concat(chunks) };
}
export function parsePlatform<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    logger.error({ issues: result.error.issues.map((i) => ({ path: i.path, code: i.code })) }, 'Central Portal response contract mismatch');
    throw new HttpError(503, 'The central Portal integration needs updating. Please contact support.');
  }
  return result.data;
}
