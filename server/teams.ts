import { Router } from 'express';
import { z } from 'zod';
import { config } from './config.js';
import { requireUser } from './auth.js';
import { HttpError, logger } from './errors.js';
import { pool, sql } from './db.js';
import { platform, parsePlatform } from './platform.js';
import { emailSchema, normaliseEmail, meetingOptionsSchema, type User } from '../shared/learning.js';

type TeamsSettings = { tenantId: string; clientId: string; clientSecret: string };
export const TEAMS_SCOPES = 'https://graph.microsoft.com/.default';
export const TEAMS_TIME_ZONE = 'Arabian Standard Time';
export const TEAMS_MAX_ATTENDEES = 500;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const LOGIN = 'https://login.microsoftonline.com';
const TEAMS_HOSTS = new Set(['teams.microsoft.com', 'teams.cloud.microsoft']);
const REQUEST_TIMEOUT_MS = 15000;
const CREATE_TIMEOUT_MS = 20000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_SECONDS = 10;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const adminMessage = 'Ask your Microsoft 365 administrator to check the application permissions Calendars.ReadWrite and OnlineMeetings.ReadWrite.All, admin consent, Exchange mailbox access restriction and Teams application access policy.';

function settings(): TeamsSettings | undefined {
  const [tenantId, clientId, clientSecret] = [config.ENTRA_TENANT_ID, config.ENTRA_CLIENT_ID, config.ENTRA_CLIENT_SECRET].map((v) => v?.trim());
  if (!tenantId && !clientId && !clientSecret) return undefined;
  if (!tenantId || !uuidPattern.test(tenantId) || !clientId || !uuidPattern.test(clientId) || !clientSecret)
    throw new HttpError(503, 'Microsoft Teams application access is misconfigured. Set ENTRA_TENANT_ID, ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET.');
  return { tenantId: tenantId.toLowerCase(), clientId: clientId.toLowerCase(), clientSecret };
}
function requireSettings(): TeamsSettings {
  const value = settings();
  if (!value) throw new HttpError(503, 'Microsoft Teams application access is not configured for Learning Portal.');
  return value;
}
function isStaff(user: User) { return user.isActive && user.roles.includes('Staff'); }
async function requireTeacher(user: User): Promise<void> {
  if (!isStaff(user)) throw new HttpError(403, 'Only teaching staff can organise Microsoft Teams lessons.');
  const result = await (await pool()).request().input('userId', sql.Int, user.id)
    .query('SET LOCK_TIMEOUT 5000; SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.LearningClassTeachers WHERE UserId=@userId) THEN 1 ELSE 0 END AS assigned;');
  if (z.array(z.object({ assigned: z.number() })).length(1).parse(result.recordset)[0].assigned !== 1)
    throw new HttpError(403, 'Only teachers assigned to a class can use Microsoft Teams lessons.');
}

const organizerSchema = z.object({
  userId: z.number().int().positive(), tenantId: z.string().regex(uuidPattern), objectId: z.string().regex(uuidPattern),
});
async function organizerFor(user: User, s: TeamsSettings): Promise<string> {
  if (!isStaff(user)) throw new HttpError(403, 'Only active teaching staff can manage Microsoft Teams lessons.');
  // This authenticated service endpoint reads the central verified Entra binding, never a browser email or organiser.
  const identity = parsePlatform(organizerSchema, await platform(`/users/${user.id}/teams-organizer`));
  if (identity.userId !== user.id || identity.tenantId.toLowerCase() !== s.tenantId)
    throw new HttpError(403, 'The teacher Microsoft identity does not belong to the configured school tenant. Contact an administrator.');
  return identity.objectId.toLowerCase();
}

type CachedToken = { key: string; token: string; expiresAt: number };
let cachedToken: CachedToken | undefined;
let tokenFlight: { key: string; promise: Promise<string> } | undefined;
const tokenSchema = z.object({
  token_type: z.string().regex(/^bearer$/i), access_token: z.string().min(1), expires_in: z.coerce.number().int().positive(),
});
function isNetworkError(error: unknown) {
  return error instanceof TypeError || error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError');
}
async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try { return JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) return undefined; throw error; }
}
async function applicationToken(s: TeamsSettings): Promise<string> {
  const key = JSON.stringify([s.tenantId, s.clientId, s.clientSecret]);
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  if (tokenFlight?.key === key) return tokenFlight.promise;
  const promise = (async () => {
    let response: Response;
    try {
      response = await fetch(`${LOGIN}/${s.tenantId}/oauth2/v2.0/token`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, scope: TEAMS_SCOPES, grant_type: 'client_credentials' }),
      });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      throw new HttpError(503, 'Microsoft application authentication is unavailable. Please try again shortly.');
    }
    const data = await readJson(response);
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Teams application token request rejected');
      throw new HttpError(503, `Microsoft rejected application authentication. Check the ENTRA credentials and admin consent. ${adminMessage}`);
    }
    const parsed = tokenSchema.safeParse(data);
    if (!parsed.success) throw new HttpError(502, 'Microsoft returned an invalid application authentication response.');
    cachedToken = { key, token: parsed.data.access_token, expiresAt: Date.now() + parsed.data.expires_in * 1000 };
    return parsed.data.access_token;
  })();
  tokenFlight = { key, promise };
  try { return await promise; }
  finally { if (tokenFlight?.promise === promise) tokenFlight = undefined; }
}
async function accessFor(user: User, s: TeamsSettings) {
  const graphUserId = await organizerFor(user, s);
  return { graphUserId, accessToken: await applicationToken(s) };
}
type GraphOptions = {
  method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; timeoutMs?: number; ambiguousOnFailure?: string; headers?: Record<string, string>;
  messages?: { forbidden?: string; notFound?: string; rejected?: string };
};
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
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json', ...options.headers },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      throw new HttpError(options.ambiguousOnFailure ? 504 : 503, options.ambiguousOnFailure ?? 'Microsoft Teams is unavailable. Please try again shortly.');
    }
    // A 503 may follow a processed POST. Keep creation/cancellation ambiguous until an explicit durable retry.
    if (response.status === 429 || response.status === 503 && (method === 'GET' || method === 'PATCH')) {
      const header = response.headers.get('retry-after');
      const seconds = header && /^\d+$/.test(header) ? Number(header) : 2;
      await response.body?.cancel();
      if (attempt >= MAX_ATTEMPTS || seconds > MAX_RETRY_AFTER_SECONDS)
        throw new HttpError(503, `Microsoft Teams is busy. Please try again in ${Math.max(seconds, 10)} seconds.`);
      await sleep(seconds * 1000);
      continue;
    }
    const data = await readJson(response);
    if (response.ok) return { status: response.status, data };
    const failure = graphErrorSchema.safeParse(data);
    const code = failure.success ? failure.data.error.code : 'unknown';
    logger.warn({ method, status: response.status, code, requestId: response.headers.get('request-id') }, 'Microsoft Graph request rejected');
    if (response.status === 401) {
      if (cachedToken?.token === accessToken) cachedToken = undefined;
      throw new GraphError(503, `Microsoft rejected application access. ${adminMessage} Retry after configuration is corrected.`, 401, code);
    }
    if (response.status === 403) throw new GraphError(403, options.messages?.forbidden ?? `Microsoft denied application access to this teacher's mailbox. ${adminMessage}`, 403, code);
    if (response.status === 404) throw new GraphError(404, options.messages?.notFound ?? 'The Microsoft calendar item or teacher mailbox was not found.', 404, code);
    if (response.status >= 500) throw new GraphError(options.ambiguousOnFailure ? 504 : 503,
      options.ambiguousOnFailure ?? 'Microsoft Teams is unavailable. Please try again shortly.', response.status, code);
    throw new GraphError(502, `${options.messages?.rejected ?? 'Microsoft rejected the calendar request'} (${code}). Contact support if this continues.`, response.status, code);
  }
}

/** connected is application authentication readiness, not a per-teacher OAuth connection. Policies are checked by Graph on use. */
export type TeamsStatus = { configured: boolean; connected: boolean; meetingOptionsReady: boolean; error?: string };
export type TeamsMeetingOptions = z.infer<typeof meetingOptionsSchema>;
export type TeamsEventInput = {
  transactionId: string; subject: string; description: string; date: string; start: string; end: string;
  attendees: { email: string; displayName: string }[]; options?: TeamsMeetingOptions;
};
export type TeamsEventResult = { eventId: string; joinUrl: string; organizerId?: string };
export type TeamsCancelResult = { status: 'cancelled' | 'alreadyGone' };
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm.');
export const teamsMeetingOptionsSchema = meetingOptionsSchema;
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
  options: teamsMeetingOptionsSchema.optional(),
}).strict().refine((v) => v.end > v.start, { message: 'The lesson must end after it starts.', path: ['end'] });
const eventIdSchema = z.string().regex(/^[A-Za-z0-9+/=_-]{1,2048}$/, 'Invalid Microsoft event ID.');
const createdEventSchema = z.object({
  id: eventIdSchema, transactionId: z.string().nullable().optional(),
  onlineMeeting: z.object({ joinUrl: z.string().nullable().optional() }).nullable().optional(),
});
export function isTeamsJoinUrl(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch (error) { if (error instanceof TypeError) return false; throw error; }
  return url.protocol === 'https:' && TEAMS_HOSTS.has(url.hostname.toLowerCase()) && !url.username && !url.password && !url.port;
}
export async function teamsStatus(user: User): Promise<TeamsStatus> {
  await requireTeacher(user);
  const s = settings();
  if (!s) return { configured: false, connected: false, meetingOptionsReady: false };
  try {
    await accessFor(user, s);
    return { configured: true, connected: true, meetingOptionsReady: true };
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { configured: true, connected: false, meetingOptionsReady: false, error: error.message };
  }
}
/** Local validation runs before durable pending state is written. Organiser identity is resolved separately on the server. */
export function validateTeamsEventInput(user: User, input: TeamsEventInput): TeamsEventInput {
  const parsed = teamsEventInputSchema.safeParse(input);
  if (!parsed.success)
    throw new HttpError(400, `Invalid Teams lesson details: ${parsed.error.issues.map((i) => `(${i.path.join('.') || 'input'}) ${i.message}`).join('; ')}`);
  const value = parsed.data;
  const seen = new Set<string>([normaliseEmail(user.email)]);
  const attendees = value.attendees.filter((a) => !seen.has(a.email) && seen.add(a.email));
  if (attendees.length > TEAMS_MAX_ATTENDEES)
    throw new HttpError(400, `This lesson would invite ${attendees.length} people, but Microsoft Teams calendar invitations allow at most ${TEAMS_MAX_ATTENDEES}. Split the class into smaller groups or share the meeting link another way.`);
  return { ...value, attendees };
}
export async function createTeamsEvent(user: User, input: TeamsEventInput): Promise<TeamsEventResult> {
  const s = requireSettings();
  const value = validateTeamsEventInput(user, input);
  await requireTeacher(user);
  const connection = await accessFor(user, s);
  const retry = `Microsoft Teams did not confirm whether the meeting was created. Retry with the same transactionId (${value.transactionId}) so Microsoft can avoid a duplicate; do not generate a new one.`;
  const { data } = await graph(connection.accessToken, `/users/${connection.graphUserId}/events`, {
    method: 'POST', timeoutMs: CREATE_TIMEOUT_MS, ambiguousOnFailure: retry,
    headers: { Prefer: `outlook.timezone="${TEAMS_TIME_ZONE}"` },
    body: {
      subject: value.subject, body: { contentType: 'text', content: value.description },
      start: { dateTime: `${value.date}T${value.start}:00`, timeZone: TEAMS_TIME_ZONE },
      end: { dateTime: `${value.date}T${value.end}:00`, timeZone: TEAMS_TIME_ZONE },
      attendees: value.attendees.map((a) => ({ emailAddress: { address: a.email, name: a.displayName }, type: 'required' })),
      isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', allowNewTimeProposals: false, transactionId: value.transactionId,
    },
  });
  const event = createdEventSchema.safeParse(data);
  if (!event.success || (event.data.transactionId && event.data.transactionId !== value.transactionId)) throw new HttpError(502, retry);
  const joinUrl = event.data.onlineMeeting?.joinUrl;
  if (!joinUrl || !isTeamsJoinUrl(joinUrl)) throw new HttpError(502, `Microsoft created the calendar event without a valid Teams link. ${retry}`);
  logger.info({ userId: user.id, eventId: event.data.id }, 'Teams lesson event created');
  return { eventId: event.data.id, joinUrl, organizerId: connection.graphUserId };
}
export async function cancelTeamsEvent(user: User, eventId: string): Promise<TeamsCancelResult> {
  const id = eventIdSchema.parse(eventId);
  // Keep cancellation available after class reassignment; the route still checks durable original ownership.
  const connection = await accessFor(user, requireSettings());
  try {
    await graph(connection.accessToken, `/users/${connection.graphUserId}/events/${encodeURIComponent(id)}/cancel`, {
      method: 'POST', body: { comment: 'This lesson has been cancelled.' },
      ambiguousOnFailure: 'Microsoft Teams did not confirm whether the meeting was cancelled. Retry the cancellation; it is safe to repeat.',
    });
  } catch (error) {
    if (error instanceof GraphError && error.graphStatus === 404 && error.graphCode === 'ErrorItemNotFound') return { status: 'alreadyGone' };
    throw error;
  }
  return { status: 'cancelled' };
}

const meetingIdSchema = z.string().regex(/^[A-Za-z0-9+/=_-]{1,2048}$/);
const onlineMeetingSchema = z.object({
  id: z.string(), joinWebUrl: z.string().nullable().optional(), allowBreakoutRooms: z.boolean().nullable().optional(),
});
const onlineMeetingListSchema = z.object({ value: z.array(z.unknown()) });
const optionsGraphMessages = {
  forbidden: `Microsoft denied application access to Teams meeting options for this teacher. ${adminMessage}`,
  notFound: "Microsoft could not find this Teams meeting in the verified organiser's account.",
  rejected: 'Microsoft rejected the Teams meeting options request',
};
function sameJoinUrl(expected: string, actual: string | null | undefined): boolean {
  return typeof actual === 'string' && isTeamsJoinUrl(actual) && new URL(actual).href === new URL(expected).href;
}
export async function applyTeamsMeetingOptions(user: User, joinUrl: string, options: TeamsMeetingOptions): Promise<void> {
  const parsed = teamsMeetingOptionsSchema.safeParse(options);
  if (!parsed.success) throw new HttpError(400, 'Invalid Teams meeting options.');
  if (typeof joinUrl !== 'string' || joinUrl.length > 2048 || !isTeamsJoinUrl(joinUrl))
    throw new HttpError(400, 'A valid Microsoft Teams join link is required to apply meeting options.');
  const connection = await accessFor(user, requireSettings());
  const base = `/users/${connection.graphUserId}/onlineMeetings`;
  const unconfirmed = 'Microsoft Teams did not confirm the meeting options. The lesson invitation already exists; retry applying the options (it is safe to repeat) instead of creating the lesson again.';
  const filter = `JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`;
  const lookup = onlineMeetingListSchema.safeParse((await graph(connection.accessToken, `${base}?$filter=${encodeURIComponent(filter)}`, { messages: optionsGraphMessages })).data);
  if (!lookup.success) throw new HttpError(502, unconfirmed);
  if (!lookup.data.value.length) throw new HttpError(404, optionsGraphMessages.notFound);
  if (lookup.data.value.length !== 1) throw new HttpError(502, unconfirmed);
  const found = onlineMeetingSchema.safeParse(lookup.data.value[0]);
  const id = meetingIdSchema.safeParse(found.success ? found.data.id : undefined);
  if (!found.success || !id.success || !sameJoinUrl(joinUrl, found.data.joinWebUrl)) throw new HttpError(502, unconfirmed);
  const path = `${base}/${encodeURIComponent(id.data)}`;
  const { allowBreakoutRooms } = parsed.data;
  const updated = onlineMeetingSchema.safeParse((await graph(connection.accessToken, path, {
    method: 'PATCH', body: { allowBreakoutRooms }, ambiguousOnFailure: unconfirmed, messages: optionsGraphMessages,
  })).data);
  if (!updated.success || updated.data.id !== id.data || (updated.data.joinWebUrl != null && !sameJoinUrl(joinUrl, updated.data.joinWebUrl)))
    throw new HttpError(502, unconfirmed);
  let applied = updated.data.allowBreakoutRooms;
  if (applied == null) {
    const reread = onlineMeetingSchema.safeParse((await graph(connection.accessToken, path, { messages: optionsGraphMessages })).data);
    applied = reread.success && reread.data.id === id.data && (reread.data.joinWebUrl == null || sameJoinUrl(joinUrl, reread.data.joinWebUrl))
      ? reread.data.allowBreakoutRooms : undefined;
  }
  if (applied == null) throw new HttpError(502, unconfirmed);
  if (applied !== allowBreakoutRooms)
    throw new HttpError(502, `Microsoft Teams did not ${allowBreakoutRooms ? 'enable' : 'disable'} breakout rooms for this meeting. Your organisation's Teams policy may not allow it; contact your Microsoft 365 administrator.`);
}
export function createTeamsRouter() {
  const router = Router();
  router.use(requireUser);
  router.get('/status', async (req, res) => {
    if (!req.user) throw new HttpError(401, 'Please sign in.');
    res.setHeader('Cache-Control', 'no-store');
    res.json(await teamsStatus(req.user));
  });
  return router;
}
