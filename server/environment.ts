import { z } from 'zod';

const optional = z.string().trim().optional().transform((v) => v || undefined);
export const environmentSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(8081),
  PUBLIC_BASE_URL: z.url(),
  APPLICATIONS_PORTAL_URL: z.url(),
  PLATFORM_API_KEY: z.string().min(32),
  SESSION_SECRET: z.string().min(32),
  SQL_CONNECTION_STRING: optional,
  SQL_SERVER: optional, SQL_DATABASE: optional, SQL_USER: optional,
  SQL_PASSWORD: z.string().optional().transform((v) => v || undefined),
  SQL_ENCRYPT: z.enum(['true', 'false']).default('true'),
  SQL_TRUST_SERVER_CERTIFICATE: z.enum(['true', 'false']).default('false'),
  AZURE_STORAGE_CONNECTION_STRING: z.string().trim().min(1).refine(
    (v) => /(?:^|;)AccountName=[^;]+(?:;|$)/i.test(v) && /(?:^|;)AccountKey=[^;]+(?:;|$)/i.test(v)
      && /(?:^|;)DefaultEndpointsProtocol=https(?:;|$)/i.test(v),
    'Use an HTTPS Azure Storage connection string containing AccountName and AccountKey.',
  ),
  AZURE_STORAGE_CONTAINER: z.string().regex(/^[a-z0-9](?!.*--)[a-z0-9-]{1,61}[a-z0-9]$/).default('learning-files'),
}).superRefine((env, ctx) => {
  if (!env.SQL_CONNECTION_STRING && (!env.SQL_SERVER || !env.SQL_DATABASE || !env.SQL_USER || !env.SQL_PASSWORD)) {
    ctx.addIssue({ code: 'custom', path: ['SQL_USER'], message: 'Configure SQL_SERVER, SQL_DATABASE, SQL_USER and SQL_PASSWORD, or a SQL-authenticated SQL_CONNECTION_STRING. Managed identity is not supported.' });
  }
  for (const key of ['PUBLIC_BASE_URL', 'APPLICATIONS_PORTAL_URL'] as const) {
    const url = new URL(env[key]);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname) && url.protocol === 'http:'))) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'Use an HTTPS origin without a path, credentials, query or fragment (HTTP localhost allowed in development).' });
    }
  }
});
