import type { Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OID = 'bbbbbbbb-1111-4222-8333-cccccccccccc';
const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>, teachers: new Set<number>(), users: new Map<number, unknown>(),
  platform: vi.fn(), queries: [] as string[],
}));
vi.mock('./config.js', () => ({ config: mocks.config }));
vi.mock('./auth.js', () => ({
  requireUser: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = mocks.users.get(Number(req.headers['x-test-user'])) as never;
    if (!req.user) return next(Object.assign(new Error('Please sign in.'), { status: 401 }));
    next();
  },
}));
vi.mock('./platform.js', () => ({
  platform: mocks.platform,
  parsePlatform: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
}));
vi.mock('./db.js', () => ({
  sql: { Int: 'int' },
  pool: async () => ({ request: () => {
    let userId = 0;
    const request = {
      input(_name: string, _type: unknown, value: number) { userId = value; return request; },
      async query(text: string) {
        mocks.queries.push(text);
        if (!text.includes('LearningClassTeachers')) throw new Error(`Unexpected SQL: ${text}`);
        return { recordset: [{ assigned: mocks.teachers.has(userId) ? 1 : 0 }] };
      },
    };
    return request;
  } }),
}));
import { HttpError } from './errors.js';
import {
  applyTeamsMeetingOptions, cancelTeamsEvent, createTeamsEvent, createTeamsRouter, teamsStatus, validateTeamsEventInput,
  TEAMS_SCOPES, type TeamsEventInput,
} from './teams.js';

const realFetch = globalThis.fetch;
const graphFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const teacher = { id: 5, email: 'teacher@school.test', displayName: 'Teacher', isActive: true, sessionVersion: 3, roles: ['Staff'], studentEmails: [] };
const student = { ...teacher, id: 7, roles: ['Student'] };
const admin = { ...teacher, id: 8, roles: ['Full Admin'] };
const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const token = () => json(200, { token_type: 'Bearer', access_token: 'application-token', expires_in: 3600 });
const joinUrl = 'https://teams.microsoft.com/l/meetup-join/abc';
const created = { id: 'AAMkEvent=', transactionId: 'occ-1111-2222', onlineMeeting: { joinUrl } };
const input: TeamsEventInput = {
  transactionId: 'occ-1111-2222', subject: 'Maths 7A', description: 'Fractions', date: '2026-11-02', start: '08:00', end: '08:45',
  attendees: [
    { email: 'Student@school.test', displayName: 'Student One' }, { email: 'student@school.test', displayName: 'Dup' },
    { email: teacher.email, displayName: 'Self' }, { email: 'two@school.test', displayName: 'Student Two' },
  ],
};
let server: Server, url: string, generation = 0;
beforeEach(async () => {
  for (const k of Object.keys(mocks.config)) delete mocks.config[k];
  Object.assign(mocks.config, { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: `secret-${++generation}` });
  mocks.teachers.clear(); mocks.users.clear(); mocks.queries.length = 0;
  mocks.teachers.add(teacher.id);
  for (const u of [teacher, student, admin]) mocks.users.set(u.id, u);
  mocks.platform.mockReset().mockResolvedValue({ userId: teacher.id, tenantId: TENANT, objectId: OID });
  graphFetch.mockReset();
  vi.stubGlobal('fetch', (target: string | URL | Request, init?: RequestInit) => {
    const href = String(target instanceof Request ? target.url : target);
    return href.startsWith('http://127.0.0.1') ? realFetch(target, init) : graphFetch(href, init ?? {});
  });
  const app = express();
  app.use('/api/teams', createTeamsRouter());
  app.use(((error, _req, res, _next) => {
    res.status(error.status ?? (error.name === 'ZodError' ? 400 : 500)).json({ error: error.message });
  }) as express.ErrorRequestHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
const get = (path: string, user?: number) => realFetch(url + path, { redirect: 'manual', headers: user ? { 'x-test-user': String(user) } : {} });

describe('application-authorised Teams', () => {
  it('uses existing ENTRA credentials without TEAMS_TOKEN_KEY or teacher tokens and resolves the organiser centrally', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(201, created));
    expect(await createTeamsEvent(teacher, input)).toEqual({ eventId: created.id, joinUrl, organizerId: OID });
    expect(mocks.platform).toHaveBeenCalledExactlyOnceWith('/users/5/teams-organizer');
    const [tokenUrl, tokenInit] = graphFetch.mock.calls[0];
    expect(tokenUrl).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const grant = new URLSearchParams(String(tokenInit.body));
    expect(Object.fromEntries(grant)).toEqual({
      client_id: CLIENT, client_secret: mocks.config.ENTRA_CLIENT_SECRET, scope: TEAMS_SCOPES, grant_type: 'client_credentials',
    });
    const [eventUrl, eventInit] = graphFetch.mock.calls[1];
    expect(eventUrl).toBe(`https://graph.microsoft.com/v1.0/users/${OID}/events`);
    expect(eventInit.headers).toMatchObject({ Authorization: 'Bearer application-token' });
    const body = JSON.parse(String(eventInit.body));
    expect(body).toMatchObject({
      transactionId: input.transactionId, subject: input.subject, isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness',
      start: { dateTime: '2026-11-02T08:00:00', timeZone: 'Arabian Standard Time' },
    });
    expect(body.organizer).toBeUndefined();
    expect(body.attendees.map((a: { emailAddress: { address: string } }) => a.emailAddress.address)).toEqual(['student@school.test', 'two@school.test']);
    expect(mocks.queries.every((query) => !query.includes('LearningTeamsConnections'))).toBe(true);
  });
  it('caches a single application token across concurrent requests, not per teacher connections', async () => {
    graphFetch.mockImplementation(async (url) => url.includes('/token') ? token() : json(201, created));
    await Promise.all([createTeamsEvent(teacher, input), createTeamsEvent(teacher, input)]);
    expect(graphFetch.mock.calls.filter(([url]) => url.includes('/token'))).toHaveLength(1);
  });
  it.each([student, admin, { ...teacher, isActive: false }])('refuses non-active teaching staff $id', async (user) => {
    await expect(createTeamsEvent(user, input)).rejects.toMatchObject({ status: 403 });
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('refuses unassigned teachers', async () => {
    mocks.teachers.clear();
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.platform).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 99, tenantId: TENANT, objectId: OID },
    { userId: 5, tenantId: CLIENT, objectId: OID },
    { userId: 5, tenantId: TENANT, objectId: 'teacher@school.test' },
  ])('never falls back to email or trusts an invalid central binding', async (identity) => {
    mocks.platform.mockResolvedValue(identity);
    await expect(createTeamsEvent(teacher, input)).rejects.toThrow();
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('surfaces missing verified identity without trying Graph or email lookups', async () => {
    mocks.platform.mockRejectedValue(new HttpError(409, 'Teacher has no verified school Microsoft identity.'));
    expect(await teamsStatus(teacher)).toMatchObject({ configured: true, connected: false, error: expect.stringContaining('verified') });
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('reports absent or partially configured application credentials clearly', async () => {
    delete mocks.config.ENTRA_CLIENT_SECRET;
    await expect(teamsStatus(teacher)).rejects.toMatchObject({ status: 503 });
    delete mocks.config.ENTRA_CLIENT_ID; delete mocks.config.ENTRA_TENANT_ID;
    expect(await teamsStatus(teacher)).toEqual({ configured: false, connected: false, meetingOptionsReady: false });
  });
  it('returns application readiness and removes delegated connect and callback endpoints', async () => {
    graphFetch.mockResolvedValueOnce(token());
    expect((await get('/api/teams/status')).status).toBe(401);
    expect((await get('/api/teams/status', student.id)).status).toBe(403);
    const response = await get('/api/teams/status', teacher.id);
    expect(await response.json()).toEqual({ configured: true, connected: true, meetingOptionsReady: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await get('/api/teams/connect', teacher.id)).status).toBe(404);
    expect((await get('/api/teams/callback', teacher.id)).status).toBe(404);
  });
  it('reports application authentication errors, never reconnect instructions', async () => {
    graphFetch.mockResolvedValueOnce(json(401, { error: 'invalid_client', error_description: 'SECRET MUST NOT LEAK' }));
    const result = await teamsStatus(teacher);
    expect(result).toMatchObject({ connected: false, error: expect.stringContaining('admin consent') });
    expect(result.error).not.toContain('SECRET MUST NOT LEAK');
    expect(result.error).not.toMatch(/reconnect/i);
  });
  it('rejects invalid input and browser-provided organiser fields before any network call', async () => {
    await expect(createTeamsEvent(teacher, { ...input, organizer: 'attacker' } as TeamsEventInput)).rejects.toMatchObject({ status: 400 });
    await expect(createTeamsEvent(teacher, { ...input, date: '2026-02-30' })).rejects.toMatchObject({ status: 400 });
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('validates attendee limits after normalisation and deduplication', () => {
    expect(validateTeamsEventInput(teacher, input).attendees).toHaveLength(2);
    const attendees = Array.from({ length: 501 }, (_, i) => ({ email: `student${i}@school.test`, displayName: `Student ${i}` }));
    expect(() => validateTeamsEventInput(teacher, { ...input, attendees })).toThrow(/at most 500/);
  });
  it('preserves transaction IDs on an ambiguous create and explicit retry', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockRejectedValueOnce(new TypeError('network failure')).mockResolvedValueOnce(json(201, created));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 504, message: expect.stringContaining('same transactionId') });
    await createTeamsEvent(teacher, input);
    expect(graphFetch.mock.calls.slice(1).map(([, init]) => JSON.parse(String(init.body)).transactionId)).toEqual([input.transactionId, input.transactionId]);
  });
  it('does not automatically replay a 503 creation whose outcome may be ambiguous', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(503, { error: { code: 'ServiceUnavailable' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 504, message: expect.stringContaining('same transactionId') });
    expect(graphFetch).toHaveBeenCalledTimes(2);
  });
  it('rejects missing or untrusted Teams join URLs without silently completing creation', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(201, { ...created, onlineMeeting: { joinUrl: 'https://evil.test' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 502, message: expect.stringContaining('same transactionId') });
  });
  it('surfaces mailbox restrictions and does not retry failed authorisation as a new event', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(403, { error: { code: 'ErrorAccessDenied' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 403, message: expect.stringContaining('Exchange mailbox') });
    expect(graphFetch).toHaveBeenCalledTimes(2);
  });
  it('invalidates an expired/rejected application token so a safe explicit retry obtains a new token', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(401, { error: { code: 'InvalidAuthenticationToken' } }))
      .mockResolvedValueOnce(token()).mockResolvedValueOnce(json(201, created));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 503 });
    await createTeamsEvent(teacher, input);
    expect(graphFetch.mock.calls.filter(([url]) => url.includes('/token'))).toHaveLength(2);
  });
  it('honours throttling without changing the durable transaction ID', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(429, {}, { 'retry-after': '0' })).mockResolvedValueOnce(json(201, created));
    await createTeamsEvent(teacher, input);
    expect(graphFetch.mock.calls[1][1].body).toBe(graphFetch.mock.calls[2][1].body);
  });
  it('leaves long throttles actionable rather than waiting indefinitely', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(429, {}, { 'retry-after': '60' }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('60 seconds') });
  });
  it('cancels existing delegated events in the same verified mailbox without any old token, even after reassignment', async () => {
    mocks.teachers.clear();
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(202));
    expect(await cancelTeamsEvent(teacher, 'AAMkOldEvent+/=')).toEqual({ status: 'cancelled' });
    expect(graphFetch.mock.calls[1][0]).toBe(`https://graph.microsoft.com/v1.0/users/${OID}/events/AAMkOldEvent%2B%2F%3D/cancel`);
    expect(mocks.queries).toHaveLength(0);
  });
  it('treats only explicit ErrorItemNotFound as an already removed event', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(404, { error: { code: 'ErrorItemNotFound' } }))
      .mockResolvedValueOnce(json(404, { error: { code: 'ResourceNotFound' } }));
    expect(await cancelTeamsEvent(teacher, created.id)).toEqual({ status: 'alreadyGone' });
    await expect(cancelTeamsEvent(teacher, created.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('application onlineMeeting options', () => {
  it('looks up and patches the meeting under the verified organiser object ID', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { value: [{ id: 'meeting+id=', joinWebUrl: joinUrl }] }))
      .mockResolvedValueOnce(json(200, { id: 'meeting+id=', joinWebUrl: joinUrl, allowBreakoutRooms: true }));
    await applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: true });
    const lookup = new URL(graphFetch.mock.calls[1][0]);
    expect(lookup.pathname).toBe(`/v1.0/users/${OID}/onlineMeetings`);
    expect(lookup.searchParams.get('$filter')).toBe(`JoinWebUrl eq '${joinUrl}'`);
    expect(graphFetch.mock.calls[2][0]).toBe(`https://graph.microsoft.com/v1.0/users/${OID}/onlineMeetings/meeting%2Bid%3D`);
    expect(JSON.parse(String(graphFetch.mock.calls[2][1].body))).toEqual({ allowBreakoutRooms: true });
  });
  it('reads back an omitted option instead of assuming success', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { value: [{ id: 'meeting', joinWebUrl: joinUrl }] }))
      .mockResolvedValueOnce(json(200, { id: 'meeting' })).mockResolvedValueOnce(json(200, { id: 'meeting', allowBreakoutRooms: false }));
    await applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: false });
    expect(graphFetch).toHaveBeenCalledTimes(4);
  });
  it.each([
    { value: [] },
    { value: [{ id: 'meeting', joinWebUrl: 'https://teams.microsoft.com/l/other' }] },
    { value: [{ id: 'a', joinWebUrl: joinUrl }, { id: 'b', joinWebUrl: joinUrl }] },
  ])('does not patch missing, ambiguous or mismatched meetings: $value', async ({ value }) => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { value }));
    await expect(applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: true })).rejects.toThrow();
    expect(graphFetch).toHaveBeenCalledTimes(2);
  });
  it('does not publish unconfirmed settings when school policy ignores the requested value', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { value: [{ id: 'meeting', joinWebUrl: joinUrl }] }))
      .mockResolvedValueOnce(json(200, { id: 'meeting', allowBreakoutRooms: false }));
    await expect(applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: true })).rejects.toMatchObject({
      status: 502, message: expect.stringContaining("organisation's Teams policy"),
    });
  });
  it('reports missing Teams application access policy explicitly', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(403, { error: { code: 'Forbidden' } }));
    await expect(applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: true })).rejects.toMatchObject({
      status: 403, message: expect.stringContaining('Teams application access policy'),
    });
  });
  it('retains the invitation and asks to retry options after an ambiguous PATCH', async () => {
    graphFetch.mockResolvedValueOnce(token()).mockResolvedValueOnce(json(200, { value: [{ id: 'meeting', joinWebUrl: joinUrl }] }))
      .mockRejectedValueOnce(new TypeError('network failure'));
    await expect(applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: true })).rejects.toMatchObject({
      status: 504, message: expect.stringContaining('invitation already exists'),
    });
  });
  it('rejects invalid options and malicious join links locally', async () => {
    await expect(applyTeamsMeetingOptions(teacher, 'https://evil.test', { allowBreakoutRooms: true })).rejects.toMatchObject({ status: 400 });
    await expect(applyTeamsMeetingOptions(teacher, joinUrl, { allowBreakoutRooms: 'true' } as never)).rejects.toMatchObject({ status: 400 });
    expect(graphFetch).not.toHaveBeenCalled();
  });
});
