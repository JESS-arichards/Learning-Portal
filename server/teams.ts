import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { SignJWT, jwtVerify, errors } from 'jose';
import { z } from 'zod';
import { config } from './config.js';
import { requireUser } from './auth.js';
import { HttpError, logger } from './errors.js';
import { pool, sql } from './db.js';
import { emailSchema, normaliseEmail, type User } from '../shared/learning.js';

/*
  Delegated (per-teacher) Microsoft Graph integration for Teams online lessons.
  Tokens are only ever held server-side, encrypted with AES-256-GCM in
  dbo.LearningTeamsConnections; app-only Graph access is never used.
*/

type TeamsEnvironment = {
  ENTRA_TENANT_ID?: string; ENTRA_CLIENT_ID?: string; ENTRA_CLIENT_SECRET?: string; TEAMS_TOKEN_KEY?: string;
};
type TeamsSettings = { tenantId: string; clientId: string; clientSecret: string; tokenKey: Buffer; redirectUri: string };

export const TEAMS_SCOPES = 'openid profile offline_access User.Read Calendars.ReadWrite';
export const TEAMS_TIME_ZONE = 'Arabian Standard Time';
// Exchange Online default per-message recipient limit; meeting invitations are sent as one message.
export const TEAMS_MAX_ATTENDEES = 500;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
const FLOW_COOKIE = 'learning_teams_flow';
const FLOW_TTL_SECONDS = 600;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;
const CREATE_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_SECONDS = 10;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const reconnectMessage = 'Your Microsoft Teams connection has expired or was revoked. Reconnect Teams from Classes.';

function settings(): TeamsSettings | undefined {
  const env = config as typeof config & TeamsEnvironment;
  const values = [env.ENTRA_TENANT_ID, env.ENTRA_CLIENT_ID, env.ENTRA_CLIENT_SECRET, env.TEAMS_TOKEN_KEY].map((v) => v?.trim() || undefined);
  if (!env.TEAMS_TOKEN_KEY?.trim()) return undefined;
  const [tenantId, clientId, clientSecret, tokenKey] = values;
  const key = tokenKey ? Buffer.from(tokenKey, 'base64') : undefined;
  if (!tenantId || !uuidPattern.test(tenantId) || !clientId || !uuidPattern.test(clientId) || !clientSecret
    || !key || key.length !== 32 || key.toString('base64') !== tokenKey) {
    throw new HttpError(503, 'Microsoft Teams integration is misconfigured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET and TEAMS_TOKEN_KEY.');
  }
  return {
    tenantId: tenantId.toLowerCase(), clientId: clientId.toLowerCase(), clientSecret, tokenKey: key,
    redirectUri: new URL('/api/teams/callback', config.PUBLIC_BASE_URL).toString(),
  };
}
function requireSettings(): TeamsSettings {
  const value = settings();
  if (!value) throw new HttpError(503, 'Microsoft Teams integration is not configured for Learning Portal.');
  return value;
}

// ---------- Encrypted token storage ----------
const storedSchema = z.object({
  v: z.literal(1), tenantId: z.string(), clientId: z.string(), graphUserId: z.string().min(1), account: z.string().min(1),
  accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number().int(),
}).strict();
type StoredConnection = z.infer<typeof storedSchema>;
const aad = (userId: number) => Buffer.from(`learning-teams:v1:${userId}`);

export function encryptConnection(key: Buffer, userId: number, value: StoredConnection): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(userId));
  const data = Buffer.concat([cipher.update(JSON.stringify(storedSchema.parse(value)), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), data.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}
export function decryptConnection(key: Buffer, userId: number, payload: string): StoredConnection | undefined {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return undefined;
  const [, iv, data, tag] = parts.map((p) => Buffer.from(p, 'base64url'));
  if (iv.length !== 12 || tag.length !== 16) return undefined;
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aad(userId));
  decipher.setAuthTag(tag);
  let plain: string;
  try { plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
  catch (error) {
    if (error instanceof Error && /authenticate data/i.test(error.message)) return undefined;
    throw error;
  }
  let json: unknown;
  try { json = JSON.parse(plain); } catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
  const parsed = storedSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

async function readPayload(userId: number): Promise<string | undefined> {
  const result = await (await pool()).request().input('userId', sql.Int, userId)
    .query('SELECT Payload AS payload FROM dbo.LearningTeamsConnections WHERE UserId=@userId;');
  const row = z.array(z.object({ payload: z.string() })).max(1).parse(result.recordset)[0];
  return row?.payload;
}
type Connection = sql.ConnectionPool | sql.Transaction;
async function readPayloadWith(connection: Connection, userId: number): Promise<string | undefined> {
  const result = await connection.request().input('userId', sql.Int, userId)
    .query('SELECT Payload AS payload FROM dbo.LearningTeamsConnections WITH (UPDLOCK, HOLDLOCK) WHERE UserId=@userId;');
  return z.array(z.object({ payload: z.string() })).max(1).parse(result.recordset)[0]?.payload;
}
/** Conditional write: only replaces the exact ciphertext that was read, so stale tokens never overwrite newer ones. */
async function replacePayload(tx: sql.Transaction, userId: number, previous: string | undefined, next: string | null): Promise<void> {
  const request = tx.request().input('userId', sql.Int, userId);
  let result: sql.IResult<unknown>;
  if (previous === undefined) {
    if (next === null) return;
    result = await request.input('payload', sql.NVarChar(sql.MAX), next)
      .query('INSERT dbo.LearningTeamsConnections (UserId, Payload, UpdatedAt) SELECT @userId, @payload, SYSUTCDATETIME() WHERE NOT EXISTS (SELECT 1 FROM dbo.LearningTeamsConnections WHERE UserId=@userId);');
  } else {
    request.input('previous', sql.NVarChar(sql.MAX), previous);
    result = next === null
      ? await request.query('DELETE dbo.LearningTeamsConnections WHERE UserId=@userId AND Payload=@previous;')
      : await request.input('payload', sql.NVarChar(sql.MAX), next)
        .query('UPDATE dbo.LearningTeamsConnections SET Payload=@payload, UpdatedAt=SYSUTCDATETIME() WHERE UserId=@userId AND Payload=@previous;');
  }
  if (result.rowsAffected[0] !== 1) throw new HttpError(409, 'Your Microsoft Teams connection changed concurrently. Please retry.');
}

const LOCK_BUSY = 51001;
/**
 * Cross-instance serialization: a short dedicated SQL transaction holding exclusive app locks
 * (independent of 'learning-write', so callers may already hold that lock on another connection).
 * Resources are acquired in the given order; the global connect lock always precedes user locks.
 */
async function withSqlLocks<T>(resources: string[], work: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const tx = new sql.Transaction(await pool());
  await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    for (const resource of resources) {
      await tx.request().input('resource', sql.NVarChar(255), resource).query(`DECLARE @r int;
        EXEC @r = sys.sp_getapplock @Resource=@resource, @LockMode=N'Exclusive', @LockOwner=N'Transaction', @LockTimeout=20000;
        IF @r < 0 THROW ${LOCK_BUSY}, 'Teams connection is busy.', 1;`);
    }
    const result = await work(tx);
    await tx.commit();
    return result;
  } catch (error) {
    try { await tx.rollback(); } catch (rollbackError) { logger.error({ err: rollbackError }, 'Teams connection transaction rollback failed'); }
    if (typeof error === 'object' && error !== null && 'number' in error && error.number === LOCK_BUSY) {
      throw new HttpError(503, 'Your Microsoft Teams connection is busy. Please retry shortly.');
    }
    throw error;
  }
}
const userLock = (userId: number) => `learning-teams:user:${userId}`;
const CONNECT_LOCK = 'learning-teams:connect';

// In-process queue avoids needless SQL lock contention between requests on the same instance.
const locks = new Map<number, Promise<void>>();
async function withUserLock<T>(userId: number, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const current = previous.then(() => gate);
  locks.set(userId, current);
  await previous;
  try { return await work(); }
  finally {
    release();
    if (locks.get(userId) === current) locks.delete(userId);
  }
}

// ---------- Access checks ----------
function isStaff(user: User) { return user.isActive && user.roles.includes('Staff'); }
async function requireTeacher(user: User): Promise<void> {
  if (!isStaff(user)) throw new HttpError(403, 'Only teaching staff can connect Microsoft Teams.');
  const result = await (await pool()).request().input('userId', sql.Int, user.id)
    .query('SET LOCK_TIMEOUT 5000; SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.LearningClassTeachers WHERE UserId=@userId) THEN 1 ELSE 0 END AS assigned;');
  const assigned = z.array(z.object({ assigned: z.number() })).length(1).parse(result.recordset)[0].assigned === 1;
  if (!assigned) throw new HttpError(403, 'Only teachers assigned to a class can use Microsoft Teams lessons.');
}
function accountMatches(user: User, emails: (string | null | undefined)[]) {
  const expected = normaliseEmail(user.email);
  return emails.some((email) => typeof email === 'string' && normaliseEmail(email) === expected);
}

// ---------- Microsoft identity platform ----------
const tokenResponseSchema = z.object({
  token_type: z.string().regex(/^bearer$/i), access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive(), scope: z.string().optional(), id_token: z.string().optional(),
});
type TokenResponse = z.infer<typeof tokenResponseSchema>;
const tokenErrorSchema = z.object({
  error: z.string().regex(/^[a-z_]{1,64}$/).catch('unknown'), error_codes: z.array(z.number()).optional().catch(undefined),
  correlation_id: z.string().max(64).optional().catch(undefined),
});
const idClaimsSchema = z.object({ tid: z.string(), oid: z.string(), aud: z.string(), iss: z.string(), nonce: z.string().optional() });

function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
async function tokenRequest(s: TeamsSettings, grant: Record<string, string>, purpose: 'exchange' | 'refresh'): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${LOGIN}/${s.tenantId}/oauth2/v2.0/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, scope: TEAMS_SCOPES, ...grant }),
    });
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    logger.error({ purpose, reason: error instanceof Error ? error.name : 'unknown' }, 'Microsoft token endpoint unreachable');
    throw new HttpError(503, 'Microsoft sign-in is unavailable. Please try again shortly.');
  }
  const data = await readJson(response);
  if (!response.ok) {
    const failure = tokenErrorSchema.safeParse(data);
    const code = failure.success ? failure.data.error : 'unknown';
    logger.warn({ purpose, status: response.status, error: code, errorCodes: failure.success ? failure.data.error_codes : undefined,
      correlationId: failure.success ? failure.data.correlation_id : undefined }, 'Microsoft token request rejected');
    if (response.status >= 500) throw new HttpError(503, 'Microsoft sign-in is unavailable. Please try again shortly.');
    if (code === 'invalid_grant') {
      throw new HttpError(purpose === 'refresh' ? 409 : 400, purpose === 'refresh' ? reconnectMessage
        : 'The Microsoft authorization expired or was already used. Connect Teams again.');
    }
    throw new HttpError(502, 'Microsoft rejected the Teams connection request. Contact support if this continues.');
  }
  const parsed = tokenResponseSchema.safeParse(data);
  if (!parsed.success) {
    logger.error({ purpose, issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })) }, 'Microsoft token response invalid');
    throw new HttpError(502, 'Microsoft returned an invalid sign-in response. Contact support.');
  }
  return parsed.data;
}
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
}
function idTokenClaims(s: TeamsSettings, idToken: string | undefined) {
  // Received directly from the tenant token endpoint over TLS, so the signature need not be re-verified (OIDC Core 3.1.3.7).
  const segment = idToken?.split('.')[1];
  let json: unknown;
  try { json = segment ? JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) : undefined; }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  const claims = idClaimsSchema.safeParse(json);
  if (!claims.success || claims.data.tid.toLowerCase() !== s.tenantId || claims.data.aud.toLowerCase() !== s.clientId
    || claims.data.iss.toLowerCase() !== `${LOGIN}/${s.tenantId}/v2.0`) {
    throw new HttpError(403, 'The Microsoft account must belong to the school Microsoft 365 tenant.');
  }
  return claims.data;
}
function hasCalendarScope(scope: string | undefined) {
  return (scope ?? '').split(/\s+/).some((s) => /(^|\/)calendars\.readwrite$/i.test(s));
}

// ---------- Microsoft Graph (delegated only) ----------
type GraphOptions = { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; ambiguousOnFailure?: string; headers?: Record<string, string> };
const graphErrorSchema = z.object({ error: z.object({ code: z.string().max(100).catch('unknown') }) });
export class GraphError extends HttpError {
  constructor(status: number, message: string, public graphStatus: number, public graphCode: string) { super(status, message); }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function graph(accessToken: string, path: string, options: GraphOptions = {}): Promise<{ status: number; data: unknown }> {
  const method = options.method ?? 'GET';
  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${GRAPH}${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      logger.error({ method, reason: error instanceof Error ? error.name : 'unknown' }, 'Microsoft Graph request did not complete');
      if (options.ambiguousOnFailure) throw new HttpError(504, options.ambiguousOnFailure);
      throw new HttpError(503, 'Microsoft Teams is unavailable. Please try again shortly.');
    }
    const requestId = response.headers.get('request-id') ?? undefined;
    // 429 means Graph did not process the request, so a bounded replay is safe (event creation also carries transactionId).
    const retryable = response.status === 429 || response.status === 503 && method === 'GET';
    if (retryable) {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : 2;
      await response.body?.cancel();
      logger.warn({ method, status: response.status, retryAfter: seconds, attempt, requestId }, 'Microsoft Graph throttled request');
      if (attempt >= MAX_ATTEMPTS || seconds > MAX_RETRY_AFTER_SECONDS) {
        throw new HttpError(503, `Microsoft Teams is busy. Please try again in ${Math.max(seconds, 10)} seconds.`);
      }
      await sleep(seconds * 1000);
      continue;
    }
    const data = await readJson(response);
    if (response.ok) return { status: response.status, data };
    const failure = graphErrorSchema.safeParse(data);
    const code = failure.success ? failure.data.error.code : 'unknown';
    logger.warn({ method, status: response.status, code, requestId }, 'Microsoft Graph request rejected');
    if (response.status === 401) throw new GraphError(409, reconnectMessage, 401, code);
    if (response.status === 403) throw new GraphError(403, 'Microsoft denied calendar access for this account. Reconnect Teams and approve calendar access.', 403, code);
    if (response.status === 404) throw new GraphError(404, 'The Microsoft calendar item was not found.', 404, code);
    if (response.status >= 500) {
      if (options.ambiguousOnFailure) throw new GraphError(504, options.ambiguousOnFailure, response.status, code);
      throw new GraphError(503, 'Microsoft Teams is unavailable. Please try again shortly.', response.status, code);
    }
    throw new GraphError(502, `Microsoft rejected the calendar request (${code}). Contact support if this continues.`, response.status, code);
  }
}

async function accessTokenFor(user: User, s: TeamsSettings): Promise<StoredConnection> {
  return withUserLock(user.id, async () => {
    const fast = await readPayload(user.id);
    if (!fast) throw new HttpError(409, 'Connect Microsoft Teams from Classes before scheduling online lessons.');
    const current = usableConnection(user, s, fast);
    if (!current) throw new HttpError(409, 'Your Microsoft Teams connection must be renewed. Reconnect Teams from Classes.');
    if (current.expiresAt - REFRESH_MARGIN_MS > Date.now()) return current;
    type Outcome = { ok: StoredConnection } | { error: HttpError };
    const outcome = await withSqlLocks<Outcome>([userLock(user.id)], async (tx) => {
      // Re-read under the SQL lock: another instance may already have rotated the refresh token.
      const payload = await readPayloadWith(tx, user.id);
      if (!payload) return { error: new HttpError(409, 'Connect Microsoft Teams from Classes before scheduling online lessons.') };
      const stored = usableConnection(user, s, payload);
      if (!stored) return { error: new HttpError(409, 'Your Microsoft Teams connection must be renewed. Reconnect Teams from Classes.') };
      if (stored.expiresAt - REFRESH_MARGIN_MS > Date.now()) return { ok: stored };
      let tokens: TokenResponse;
      try { tokens = await tokenRequest(s, { grant_type: 'refresh_token', refresh_token: stored.refreshToken }, 'refresh'); }
      catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        // Revoked/expired grant: remove it (committed) so status shows reconnect, then surface the error.
        await replacePayload(tx, user.id, payload, null);
        return { error };
      }
      if (tokens.id_token && idTokenClaims(s, tokens.id_token).oid !== stored.graphUserId) {
        await replacePayload(tx, user.id, payload, null);
        return { error: new HttpError(403, 'The Microsoft account changed. Reconnect Teams from Classes.') };
      }
      const next: StoredConnection = {
        ...stored, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? stored.refreshToken,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      };
      await replacePayload(tx, user.id, payload, encryptConnection(s.tokenKey, user.id, next));
      return { ok: next };
    });
    if ('error' in outcome) throw outcome.error;
    return outcome.ok;
  });
}
function usableConnection(user: User, s: TeamsSettings, payload: string): StoredConnection | undefined {
  const stored = decryptConnection(s.tokenKey, user.id, payload);
  if (!stored) { logger.warn({ userId: user.id }, 'Stored Teams connection could not be decrypted'); return undefined; }
  if (stored.tenantId !== s.tenantId || stored.clientId !== s.clientId || !accountMatches(user, [stored.account])) return undefined;
  return stored;
}

// ---------- Public API ----------
export type TeamsStatus = { configured: boolean; connected: boolean; account?: string; reconnectRequired?: boolean };
export type TeamsEventInput = {
  transactionId: string; subject: string; description: string; date: string; start: string; end: string;
  attendees: { email: string; displayName: string }[];
};
export type TeamsEventResult = { eventId: string; joinUrl: string; organizerId?: string };
export type TeamsCancelResult = { status: 'cancelled' | 'alreadyGone' };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.');
export const teamsEventInputSchema = z.object({
  transactionId: z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/, 'Use a stable 8-200 character transaction ID.'),
  subject: z.string().trim().min(1).max(255, 'Subject must be at most 255 characters.'),
  description: z.string().max(20000, 'Description must be at most 20000 characters.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
  }, 'Use a real YYYY-MM-DD date.'),
  start: time, end: time,
  attendees: z.array(z.object({ email: emailSchema, displayName: z.string().trim().min(1).max(200) }).strict()).max(5000, 'A lesson cannot include more than 5000 attendee entries.'),
}).strict().refine((v) => v.end > v.start, { message: 'The lesson must end after it starts.', path: ['end'] });
const eventIdSchema = z.string().regex(/^[A-Za-z0-9+/=_-]{1,1024}$/, 'Invalid Microsoft event ID.');
const createdEventSchema = z.object({
  id: z.string().min(1), transactionId: z.string().nullable().optional(),
  onlineMeeting: z.object({ joinUrl: z.string().nullable().optional() }).nullable().optional(),
});

export function isTeamsJoinUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch (error) { if (error instanceof TypeError) return false; throw error; }
  return url.protocol === 'https:' && TEAMS_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password && !url.port;
}

export async function teamsStatus(user: User): Promise<TeamsStatus> {
  const s = settings();
  if (!s) return { configured: false, connected: false };
  const payload = await readPayload(user.id);
  if (!payload) return { configured: true, connected: false };
  const stored = usableConnection(user, s, payload);
  if (!stored) return { configured: true, connected: false, reconnectRequired: true };
  return { configured: true, connected: true, account: stored.account };
}

/**
 * Pure local validation and normalisation (no SQL, token or network access) so callers can reject an
 * event before persisting pending state. Trims text, normalises and deduplicates attendee emails, removes
 * the organizer (the user; a stored connection always matches the user's email) and enforces the
 * recipient limit. Throws HttpError(400) with an actionable message.
 */
export function validateTeamsEventInput(user: User, input: TeamsEventInput): TeamsEventInput {
  const parsed = teamsEventInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, `Invalid Teams lesson details: ${parsed.error.issues.map((i) => `(${i.path.join('.') || 'input'}) ${i.message}`).join('; ')}`);
  }
  const value = parsed.data;
  const seen = new Set<string>([normaliseEmail(user.email)]);
  const attendees = value.attendees.filter((a) => !seen.has(a.email) && seen.add(a.email));
  if (attendees.length > TEAMS_MAX_ATTENDEES) {
    throw new HttpError(400, `This lesson would invite ${attendees.length} people, but Microsoft Teams calendar invitations allow at most ${TEAMS_MAX_ATTENDEES}. Split the class into smaller groups or share the meeting link another way.`);
  }
  return { ...value, attendees };
}

export async function createTeamsEvent(user: User, input: TeamsEventInput): Promise<TeamsEventResult> {
  const s = requireSettings();
  const value = validateTeamsEventInput(user, input);
  const attendees = value.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.displayName }, type: 'required' as const }));
  await requireTeacher(user);
  const connection = await accessTokenFor(user, s);
  const retry = `Microsoft Teams did not confirm whether the meeting was created. Retry with the same transactionId (${value.transactionId}) so Microsoft can avoid a duplicate; do not generate a new one.`;
  const { data } = await graph(connection.accessToken, '/me/events', {
    method: 'POST', timeoutMs: CREATE_TIMEOUT_MS, ambiguousOnFailure: retry,
    headers: { Prefer: `outlook.timezone="${TEAMS_TIME_ZONE}"` },
    body: {
      subject: value.subject,
      body: { contentType: 'text', content: value.description },
      start: { dateTime: `${value.date}T${value.start}:00`, timeZone: TEAMS_TIME_ZONE },
      end: { dateTime: `${value.date}T${value.end}:00`, timeZone: TEAMS_TIME_ZONE },
      attendees, isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', allowNewTimeProposals: false,
      transactionId: value.transactionId,
    },
  });
  const event = createdEventSchema.safeParse(data);
  if (!event.success || (event.data.transactionId && event.data.transactionId !== value.transactionId)) {
    logger.error({ userId: user.id }, 'Microsoft Graph returned an invalid created event');
    throw new HttpError(502, retry);
  }
  const joinUrl = event.data.onlineMeeting?.joinUrl;
  if (!joinUrl || !isTeamsJoinUrl(joinUrl)) {
    logger.error({ userId: user.id, eventId: event.data.id }, 'Microsoft Graph event lacks a valid Teams join URL');
    throw new HttpError(502, `Microsoft created the calendar event without a valid Teams link. ${retry}`);
  }
  logger.info({ userId: user.id, eventId: event.data.id }, 'Teams lesson event created');
  return { eventId: event.data.id, joinUrl, organizerId: connection.graphUserId };
}

export async function cancelTeamsEvent(user: User, eventId: string): Promise<TeamsCancelResult> {
  const s = requireSettings();
  const id = eventIdSchema.parse(eventId);
  // Staff role only: cancellation acts solely on the caller's own calendar and must still work after class reassignment.
  if (!isStaff(user)) throw new HttpError(403, 'Only teaching staff can cancel Microsoft Teams lessons.');
  const connection = await accessTokenFor(user, s);
  try {
    await graph(connection.accessToken, `/me/events/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', body: { comment: 'This lesson has been cancelled.' },
      ambiguousOnFailure: 'Microsoft Teams did not confirm whether the meeting was cancelled. Retry the cancellation; it is safe to repeat.',
    });
  } catch (error) {
    // Only Graph's explicit not-found code means the event is gone; any other refusal (e.g. 400 for an
    // already-cancelled item still in Deleted Items) stays an explicit error rather than an assumed success.
    if (error instanceof GraphError && error.graphStatus === 404 && error.graphCode === 'ErrorItemNotFound') {
      logger.info({ userId: user.id, eventId: id }, 'Teams lesson event already removed');
      return { status: 'alreadyGone' };
    }
    throw error;
  }
  logger.info({ userId: user.id, eventId: id }, 'Teams lesson event cancelled');
  return { status: 'cancelled' };
}

// ---------- OAuth routes ----------
const flowKey = () => new TextEncoder().encode(config.SESSION_SECRET);
const flowCookieOptions = () => ({ httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/api/teams' });
const flowSchema = z.object({ uid: z.number().int().positive(), sv: z.number().int().nonnegative(), state: opaque, verifier: opaque, nonce: opaque });
const callbackSchema = z.object({
  code: z.string().min(1).max(8192).regex(/^[\x21-\x7e]+$/).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});
const meSchema = z.object({
  id: z.string().min(1), mail: z.string().nullable().optional(), userPrincipalName: z.string().min(1), userType: z.string().nullable().optional(),
});

function currentUser(req: Request): User {
  if (!req.user) throw new HttpError(401, 'Please sign in.');
  return req.user;
}

export function createTeamsRouter() {
  const router = Router();
  router.use(requireUser);
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many Microsoft Teams connection requests. Please wait a few minutes.' },
  });
  router.get('/status', async (req, res) => { res.json(await teamsStatus(currentUser(req))); });
  router.get('/connect', limiter, async (req, res) => {
    const user = currentUser(req);
    const s = requireSettings();
    await requireTeacher(user);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const flow = await new SignJWT({ uid: user.id, sv: user.sessionVersion, state, verifier, nonce })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('learning-teams').setAudience('learning-teams')
      .setIssuedAt().setExpirationTime(`${FLOW_TTL_SECONDS}s`).sign(flowKey());
    const target = new URL(`${LOGIN}/${s.tenantId}/oauth2/v2.0/authorize`);
    target.search = new URLSearchParams({
      client_id: s.clientId, response_type: 'code', response_mode: 'query', redirect_uri: s.redirectUri, scope: TEAMS_SCOPES,
      state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      login_hint: user.email, prompt: 'select_account',
    }).toString();
    res.cookie(FLOW_COOKIE, flow, { ...flowCookieOptions(), maxAge: FLOW_TTL_SECONDS * 1000 });
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(target.toString());
  });
  router.get('/callback', limiter, async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    const user = currentUser(req);
    const s = requireSettings();
    const token: unknown = req.cookies?.[FLOW_COOKIE];
    res.clearCookie(FLOW_COOKIE, flowCookieOptions());
    const query = callbackSchema.safeParse(req.query);
    if (typeof token !== 'string' || !query.success || !query.data.state) {
      throw new HttpError(400, 'The Teams connection request is missing or expired. Connect Teams again from Classes.');
    }
    let flow: z.infer<typeof flowSchema>;
    try {
      const { payload } = await jwtVerify(token, flowKey(), { issuer: 'learning-teams', audience: 'learning-teams', algorithms: ['HS256'] });
      flow = flowSchema.parse(payload);
    } catch (error) {
      if (error instanceof errors.JOSEError || error instanceof z.ZodError) {
        throw new HttpError(400, 'The Teams connection request expired or is invalid. Connect Teams again from Classes.');
      }
      throw error;
    }
    const state = Buffer.from(query.data.state);
    if (state.length !== flow.state.length || !timingSafeEqual(state, Buffer.from(flow.state))) {
      throw new HttpError(400, 'The Teams connection state does not match this browser. Connect Teams again from Classes.');
    }
    if (flow.uid !== user.id || flow.sv !== user.sessionVersion) {
      throw new HttpError(403, 'This Teams connection was started by a different Learning Portal session. Connect Teams again.');
    }
    if (query.data.error) {
      const code = /^[a-z_]{1,64}$/.test(query.data.error) ? query.data.error : 'unknown';
      logger.warn({ userId: user.id, error: code }, 'Microsoft authorization returned an error');
      throw new HttpError(400, code === 'access_denied' || code === 'consent_required'
        ? 'Microsoft Teams calendar access was not granted. Connect Teams again and approve access.'
        : 'Microsoft sign-in did not complete. Connect Teams again from Classes.');
    }
    if (!query.data.code) throw new HttpError(400, 'Microsoft did not return an authorization code. Connect Teams again from Classes.');
    await requireTeacher(user);
    const tokens = await tokenRequest(s, {
      grant_type: 'authorization_code', code: query.data.code, redirect_uri: s.redirectUri, code_verifier: flow.verifier,
    }, 'exchange');
    const claims = idTokenClaims(s, tokens.id_token);
    if (claims.nonce !== flow.nonce) throw new HttpError(400, 'The Microsoft sign-in response did not match this request. Connect Teams again.');
    if (!tokens.refresh_token) throw new HttpError(502, 'Microsoft did not grant offline access. Contact support.');
    if (!hasCalendarScope(tokens.scope)) throw new HttpError(403, 'Microsoft calendar access was not granted. Connect Teams again and approve calendar access.');
    const { data } = await graph(tokens.access_token, '/me?$select=id,mail,userPrincipalName,userType');
    const me = meSchema.safeParse(data);
    if (!me.success) throw new HttpError(502, 'Microsoft returned an invalid profile. Contact support.');
    if (me.data.id !== claims.oid) throw new HttpError(403, 'The Microsoft account could not be verified. Connect Teams again.');
    if (me.data.userType !== 'Member' || me.data.userPrincipalName.includes('#EXT#')) {
      throw new HttpError(403, 'Guest or external Microsoft accounts cannot connect Teams. Sign in with your school staff account.');
    }
    // The UPN is the tenant-unique sign-in name. `mail` is not uniqueness-enforced for every account type, so a
    // different staff/admin account carrying the same `mail` value must never be accepted on `mail` alone.
    if (!accountMatches(user, [me.data.userPrincipalName])) {
      logger.warn({ userId: user.id, mailMatched: accountMatches(user, [me.data.mail]) }, 'Teams connection rejected: Microsoft sign-in name does not match Learning user');
      throw new HttpError(403, `Sign in to Microsoft as ${user.email} to connect Teams. Other Microsoft accounts, even with the same mailbox address, are not accepted.`);
    }
    const stored: StoredConnection = {
      v: 1, tenantId: s.tenantId, clientId: s.clientId, graphUserId: me.data.id, account: normaliseEmail(me.data.userPrincipalName),
      accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    await withUserLock(user.id, () => withSqlLocks([CONNECT_LOCK, userLock(user.id)], async (tx) => {
      const others = await tx.request().input('userId', sql.Int, user.id)
        .query('SELECT UserId AS userId, Payload AS payload FROM dbo.LearningTeamsConnections WHERE UserId<>@userId;');
      for (const row of z.array(z.object({ userId: z.number().int(), payload: z.string() })).parse(others.recordset)) {
        if (decryptConnection(s.tokenKey, row.userId, row.payload)?.graphUserId === me.data.id) {
          logger.warn({ userId: user.id, otherUserId: row.userId }, 'Teams connection rejected: Microsoft account already linked to another user');
          throw new HttpError(409, 'This Microsoft account is already connected to another Learning Portal user. Contact support.');
        }
      }
      const existing = await readPayloadWith(tx, user.id);
      await replacePayload(tx, user.id, existing, encryptConnection(s.tokenKey, user.id, stored));
    }));
    logger.info({ userId: user.id }, 'Microsoft Teams connected');
    res.redirect('/classes?teams=connected');
  });
  return router;
}
