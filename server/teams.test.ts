import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY = Buffer.alloc(32, 7).toString('base64');
const mocks = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  store: new Map<number, string>(),
  teachers: new Set<number>(),
  queries: [] as string[],
  users: new Map<number, unknown>(),
  transactions: 0,
  rollbacks: 0,
}));
vi.mock('./config.js', () => ({ config: mocks.config }));
vi.mock('./auth.js', () => ({
  requireUser: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const user = mocks.users.get(Number(req.headers['x-test-user']));
    if (!user) throw Object.assign(new (class extends Error {})('Please sign in.'), { status: 401 });
    req.user = user as never;
    next();
  },
}));
vi.mock('./db.js', () => {
  // Simulates SQL Server app locks shared by every "instance" (module copy) that uses the same database.
  const appLocks = new Map<string, Promise<void>>();
  const makeRequest = (owner?: { release: (() => void)[] }) => {
    const inputs: Record<string, unknown> = {};
    const request = {
      input(name: string, _type: unknown, value: unknown) { inputs[name] = value; return request; },
      async query(text: string) {
        mocks.queries.push(text);
        const id = Number(inputs.userId);
        if (text.includes('sp_getapplock')) {
          if (!owner) throw new Error('applock outside transaction');
          const resource = String(inputs.resource);
          const previous = appLocks.get(resource) ?? Promise.resolve();
          let release!: () => void;
          const mine = new Promise<void>((r) => { release = r; });
          const chained = previous.then(() => mine);
          appLocks.set(resource, chained);
          owner.release.push(() => { release(); if (appLocks.get(resource) === chained) appLocks.delete(resource); });
          await previous;
          return { recordset: [], rowsAffected: [] };
        }
        if (text.includes('LearningClassTeachers')) return { recordset: [{ assigned: mocks.teachers.has(id) ? 1 : 0 }], rowsAffected: [1] };
        if (text.includes('UserId<>@userId')) return { recordset: [...mocks.store].filter(([k]) => k !== id).map(([userId, payload]) => ({ userId, payload })), rowsAffected: [0] };
        if (text.includes('SELECT Payload')) return { recordset: mocks.store.has(id) ? [{ payload: mocks.store.get(id) }] : [], rowsAffected: [0] };
        if (text.startsWith('INSERT')) {
          if (mocks.store.has(id)) return { recordset: [], rowsAffected: [0] };
          mocks.store.set(id, String(inputs.payload)); return { recordset: [], rowsAffected: [1] };
        }
        if (text.includes('Payload=@previous')) {
          if (mocks.store.get(id) !== inputs.previous) return { recordset: [], rowsAffected: [0] };
          if (text.startsWith('DELETE')) mocks.store.delete(id); else mocks.store.set(id, String(inputs.payload));
          return { recordset: [], rowsAffected: [1] };
        }
        throw new Error(`Unexpected SQL: ${text}`);
      },
    };
    return request;
  };
  class Transaction {
    owner = { release: [] as (() => void)[] };
    async begin() { mocks.transactions++; }
    request() { return makeRequest(this.owner); }
    async commit() { this.owner.release.splice(0).forEach((r) => r()); }
    async rollback() { mocks.rollbacks++; this.owner.release.splice(0).forEach((r) => r()); }
  }
  const pool = async () => ({ request: () => makeRequest() });
  return { pool, sql: { Int: 'int', NVarChar: () => 'nvarchar', MAX: -1, Transaction, ISOLATION_LEVEL: { READ_COMMITTED: 1 } } };
});import { HttpError, logger } from './errors.js';
import {
  cancelTeamsEvent, createTeamsEvent, createTeamsRouter, decryptConnection, encryptConnection, teamsStatus, validateTeamsEventInput, type TeamsEventInput,
} from './teams.js';

const realFetch = globalThis.fetch;
const graphFetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
const teacher = { id: 5, email: 'teacher@school.test', displayName: 'Teacher', isActive: true, sessionVersion: 3, roles: ['Staff'], studentEmails: [] };
const other = { ...teacher, id: 6, email: 'other@school.test' };
const student = { ...teacher, id: 7, email: 'student@school.test', roles: ['Student'] };
const admin = { ...teacher, id: 8, email: 'admin@school.test', roles: ['Full Admin'] };
const key = Buffer.from(KEY, 'base64');
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const idToken = (claims: Record<string, unknown>) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const configure = () => Object.assign(mocks.config, {
  PUBLIC_BASE_URL: 'https://learn.school.test', SESSION_SECRET: 'test-learning-secret-that-is-long-enough', production: true,
  ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: 'secret-value', TEAMS_TOKEN_KEY: KEY,
});
function seed(user: typeof teacher, overrides: Record<string, unknown> = {}) {
  mocks.store.set(user.id, encryptConnection(key, user.id, {
    v: 1, tenantId: TENANT, clientId: CLIENT, graphUserId: `oid-${user.id}`, account: user.email,
    accessToken: `access-${user.id}`, refreshToken: `refresh-${user.id}`, expiresAt: Date.now() + 3600_000, ...overrides,
  }));
}
const input: TeamsEventInput = {
  transactionId: 'occ-1111-2222', subject: 'Maths 7A', description: 'Fractions', date: '2026-11-02', start: '08:00', end: '08:45',
  attendees: [
    { email: 'Student@school.test', displayName: 'Student One' }, { email: 'student@school.test', displayName: 'Dup' },
    { email: 'teacher@school.test', displayName: 'Self' }, { email: 'two@school.test', displayName: 'Student Two' },
  ],
};
const created = { id: 'AAMkEvent=', transactionId: 'occ-1111-2222', onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' } };

let server: Server, url: string;
beforeEach(async () => {
  for (const k of Object.keys(mocks.config)) delete mocks.config[k];
  configure();
  mocks.store.clear(); mocks.teachers.clear(); mocks.queries.length = 0; mocks.users.clear(); mocks.transactions = 0; mocks.rollbacks = 0;
  mocks.teachers.add(teacher.id);
  for (const u of [teacher, other, student, admin]) mocks.users.set(u.id, u);
  graphFetch.mockReset();
  vi.stubGlobal('fetch', (target: string | URL | Request, init?: RequestInit) => {
    const href = String(target instanceof Request ? target.url : target);
    return href.startsWith('http://127.0.0.1') ? realFetch(target, init) : graphFetch(href, init ?? {});
  });
  const app = express();
  app.use(cookieParser());
  app.use('/api/teams', createTeamsRouter());
  app.use(((error, _req, res, _next) => {
    const status = error instanceof HttpError || typeof error?.status === 'number' ? error.status : error?.name === 'ZodError' ? 400 : 500;
    res.status(status).json({ error: error.message });
  }) as express.ErrorRequestHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no server');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
const get = (path: string, user?: number, cookie?: string) => realFetch(url + path, {
  redirect: 'manual', headers: { ...(user ? { 'x-test-user': String(user) } : {}), ...(cookie ? { Cookie: cookie } : {}) },
});
async function connect(user = teacher.id) {
  const response = await get('/api/teams/connect', user);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get('location')!);
  return { response, location, state: location.searchParams.get('state')!, nonce: location.searchParams.get('nonce')!,
    cookie: response.headers.get('set-cookie')!.split(';')[0] };
}
function microsoftSucceeds(nonce: string, me: Record<string, unknown> = { id: 'oid-5', mail: 'Teacher@school.test', userPrincipalName: 'Teacher@school.test', userType: 'Member' }, claims: Record<string, unknown> = {}) {
  graphFetch.mockImplementation(async (href) => {
    if (href.endsWith('/oauth2/v2.0/token')) return json(200, {
      token_type: 'Bearer', access_token: 'secret-access', refresh_token: 'secret-refresh', expires_in: 3600,
      scope: 'openid profile offline_access User.Read Calendars.ReadWrite',
      id_token: idToken({ tid: TENANT, oid: 'oid-5', aud: CLIENT, iss: `https://login.microsoftonline.com/${TENANT}/v2.0`, nonce, ...claims }),
    });
    if (href.startsWith('https://graph.microsoft.com/v1.0/me?')) return json(200, me);
    throw new Error(`unexpected ${href}`);
  });
}

describe('Teams configuration and status', () => {
  it('reports unconfigured without any database or network call', async () => {
    for (const k of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'TEAMS_TOKEN_KEY']) delete mocks.config[k];
    expect(await teamsStatus(teacher)).toEqual({ configured: false, connected: false });
    expect(mocks.queries).toEqual([]);
    expect(graphFetch).not.toHaveBeenCalled();
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 503 });
    expect((await get('/api/teams/connect', teacher.id)).status).toBe(503);
  });
  it('rejects partial or malformed configuration explicitly', async () => {
    mocks.config.TEAMS_TOKEN_KEY = Buffer.alloc(16).toString('base64');
    await expect(teamsStatus(teacher)).rejects.toMatchObject({ status: 503 });
    mocks.config.TEAMS_TOKEN_KEY = KEY;
    delete mocks.config.ENTRA_CLIENT_SECRET;
    await expect(teamsStatus(teacher)).rejects.toMatchObject({ status: 503 });
  });
  it('leaves Teams disabled when existing Entra credentials have no token key', async () => {
    delete mocks.config.TEAMS_TOKEN_KEY;
    expect(await teamsStatus(teacher)).toEqual({ configured: false, connected: false });
    expect(mocks.queries).toEqual([]);
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('requires a signed-in user on every route including the callback', async () => {
    for (const path of ['/api/teams/status', '/api/teams/connect', '/api/teams/callback?code=x&state=y']) expect((await get(path)).status).toBe(401);
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('reports connection state and never exposes tokens', async () => {
    expect(await (await get('/api/teams/status', teacher.id)).json()).toEqual({ configured: true, connected: false });
    seed(teacher);
    const body = await (await get('/api/teams/status', teacher.id)).text();
    expect(JSON.parse(body)).toEqual({ configured: true, connected: true, account: 'teacher@school.test' });
    expect(body).not.toContain('access-5');
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('requires reconnection when the stored account no longer matches or cannot be decrypted', async () => {
    seed(teacher, { account: 'old@school.test' });
    expect(await teamsStatus(teacher)).toEqual({ configured: true, connected: false, reconnectRequired: true });
    mocks.store.set(teacher.id, mocks.store.get(other.id) ?? 'v1.bad.bad.bad');
    expect(await teamsStatus(teacher)).toEqual({ configured: true, connected: false, reconnectRequired: true });
  });
});

describe('Token encryption', () => {
  it('round-trips with AES-GCM bound to the user and rejects tampering or the wrong key', () => {
    const value = { v: 1 as const, tenantId: TENANT, clientId: CLIENT, graphUserId: 'g', account: 'a@b.test', accessToken: 'tok-a', refreshToken: 'tok-r', expiresAt: 1 };
    const payload = encryptConnection(key, 5, value);
    expect(payload).toMatch(/^v1\./);
    expect(payload).not.toContain('tok-');
    expect(decryptConnection(key, 5, payload)).toEqual(value);
    expect(decryptConnection(key, 6, payload)).toBeUndefined();
    expect(decryptConnection(Buffer.alloc(32, 1), 5, payload)).toBeUndefined();
    const parts = payload.split('.');
    parts[2] = Buffer.from('x' + Buffer.from(parts[2], 'base64url').toString('latin1').slice(1), 'latin1').toString('base64url');
    expect(decryptConnection(key, 5, parts.join('.'))).toBeUndefined();
    expect(decryptConnection(key, 5, 'garbage')).toBeUndefined();
  });
});

describe('Teams OAuth connect flow', () => {
  it('only lets assigned staff teachers connect (admins are not impersonators)', async () => {
    expect((await get('/api/teams/connect', student.id)).status).toBe(403);
    expect((await get('/api/teams/connect', other.id)).status).toBe(403);
    expect((await get('/api/teams/connect', admin.id)).status).toBe(403);
  });
  it('redirects to the tenant authorize endpoint with PKCE and a bound HttpOnly flow cookie', async () => {
    const { response, location, cookie } = await connect();
    expect(location.origin + location.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: CLIENT, response_type: 'code', redirect_uri: 'https://learn.school.test/api/teams/callback',
      scope: 'openid profile offline_access User.Read Calendars.ReadWrite', code_challenge_method: 'S256', login_hint: teacher.email,
    });
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const setCookie = response.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/HttpOnly/); expect(setCookie).toMatch(/Secure/); expect(setCookie).toMatch(/SameSite=Lax/); expect(setCookie).toMatch(/Path=\/api\/teams/);
    expect(cookie).not.toContain(location.searchParams.get('code_challenge')!);
  });
  it('exchanges the code with the PKCE verifier, verifies the account and stores encrypted tokens', async () => {
    const flow = await connect();
    microsoftSucceeds(flow.nonce);
    const response = await get(`/api/teams/callback?code=auth.code-1&state=${flow.state}&session_state=x`, teacher.id, flow.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/classes?teams=connected');
    const [tokenUrl, tokenInit] = graphFetch.mock.calls[0];
    expect(tokenUrl).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`);
    const form = new URLSearchParams(String(tokenInit.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth.code-1');
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(flow.location.searchParams.get('code_challenge'));
    expect(graphFetch.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,userType');
    const stored = mocks.store.get(teacher.id)!;
    expect(stored).not.toContain('secret-');
    expect(decryptConnection(key, teacher.id, stored)).toMatchObject({ accessToken: 'secret-access', refreshToken: 'secret-refresh', graphUserId: 'oid-5', account: 'teacher@school.test' });
    expect(response.headers.getSetCookie().some((c) => c.startsWith('learning_teams_flow=;'))).toBe(true);
  });
  it('rejects a Microsoft account that does not match the Learning user', async () => {
    const flow = await connect();
    microsoftSucceeds(flow.nonce, { id: 'oid-5', mail: 'someone@school.test', userPrincipalName: 'someone@school.test', userType: 'Member' });
    const response = await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie);
    expect(response.status).toBe(403);
    expect(mocks.store.has(teacher.id)).toBe(false);
  });
  it('rejects a different staff account whose mail matches but sign-in name does not', async () => {
    const flow = await connect();
    microsoftSucceeds(flow.nonce, { id: 'oid-5', mail: 'teacher@school.test', userPrincipalName: 'teacher.admin@school.test', userType: 'Member' });
    const response = await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie);
    expect(response.status).toBe(403);
    expect(mocks.store.has(teacher.id)).toBe(false);
  });
  it('rejects guest accounts even when the sign-in name matches', async () => {
    const flow = await connect();
    microsoftSucceeds(flow.nonce, { id: 'oid-5', mail: 'teacher@school.test', userPrincipalName: 'teacher@school.test', userType: 'Guest' });
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(403);
    expect(mocks.store.size).toBe(0);
  });
  it('refuses to link one Microsoft account to two Learning users and replaces only the caller\'s row', async () => {
    seed(other, { graphUserId: 'oid-5' });
    let flow = await connect();
    microsoftSucceeds(flow.nonce);
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(409);
    expect(mocks.store.has(teacher.id)).toBe(false);
    seed(other);
    seed(teacher, { accessToken: 'old' });
    flow = await connect();
    microsoftSucceeds(flow.nonce);
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(302);
    expect(decryptConnection(key, teacher.id, mocks.store.get(teacher.id)!)!.accessToken).toBe('secret-access');
    expect(decryptConnection(key, other.id, mocks.store.get(other.id)!)!.accessToken).toBe('access-6');
  });  it('rejects tokens from another tenant or with a mismatched nonce', async () => {
    let flow = await connect();
    microsoftSucceeds(flow.nonce, undefined, { tid: '99999999-2222-4333-8444-555555555555' });
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(403);
    flow = await connect();
    microsoftSucceeds('wrong-nonce');
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(400);
    expect(mocks.store.size).toBe(0);
  });
  it('validates state, cookie and session binding before any token exchange', async () => {
    const flow = await connect();
    expect((await get(`/api/teams/callback?code=abc&state=${'x'.repeat(43)}`, teacher.id, flow.cookie)).status).toBe(400);
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id)).status).toBe(400);
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie.replace(/.$/, 'A'))).status).toBe(400);
    mocks.teachers.add(other.id);
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, other.id, flow.cookie)).status).toBe(403);
    mocks.users.set(teacher.id, { ...teacher, sessionVersion: 4 });
    expect((await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie)).status).toBe(403);
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('sanitizes OAuth errors from the redirect and the token endpoint', async () => {
    let flow = await connect();
    let response = await get(`/api/teams/callback?error=access_denied&error_description=${encodeURIComponent('<script>leak</script>')}&state=${flow.state}`, teacher.id, flow.cookie);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('leak');
    flow = await connect();
    graphFetch.mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'AADSTS70008 secret detail', correlation_id: 'c' }));
    response = await get(`/api/teams/callback?code=abc&state=${flow.state}`, teacher.id, flow.cookie);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('AADSTS');
  });
});

describe('Teams events', () => {
  beforeEach(() => seed(teacher));
  it('creates a delegated Teams meeting with server-controlled payload and deduplicated attendees', async () => {
    graphFetch.mockResolvedValue(json(201, created));
    const result = await createTeamsEvent(teacher, input);
    expect(result).toEqual({ eventId: 'AAMkEvent=', joinUrl: created.onlineMeeting.joinUrl, organizerId: 'oid-5' });
    const [href, init] = graphFetch.mock.calls[0];
    expect(href).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-5');
    expect(JSON.parse(String(init.body))).toEqual({
      subject: 'Maths 7A', body: { contentType: 'text', content: 'Fractions' },
      start: { dateTime: '2026-11-02T08:00:00', timeZone: 'Arabian Standard Time' },
      end: { dateTime: '2026-11-02T08:45:00', timeZone: 'Arabian Standard Time' },
      attendees: [
        { emailAddress: { address: 'student@school.test', name: 'Student One' }, type: 'required' },
        { emailAddress: { address: 'two@school.test', name: 'Student Two' }, type: 'required' },
      ],
      isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness', allowNewTimeProposals: false, transactionId: 'occ-1111-2222',
    });
  });
  it('rejects arbitrary organizers and invalid input', async () => {
    await expect(createTeamsEvent(teacher, { ...input, organizer: 'x@y.z' } as TeamsEventInput)).rejects.toThrow();
    await expect(createTeamsEvent(teacher, { ...input, end: '07:00' })).rejects.toThrow();
    await expect(createTeamsEvent(teacher, { ...input, date: '2026-02-30' })).rejects.toThrow();
    expect(graphFetch).not.toHaveBeenCalled();
  });
  it('requires an assigned staff teacher with a connection', async () => {
    await expect(createTeamsEvent(student, input)).rejects.toMatchObject({ status: 403 });
    await expect(createTeamsEvent(admin, input)).rejects.toMatchObject({ status: 403 });
    mocks.teachers.add(other.id);
    await expect(createTeamsEvent(other, input)).rejects.toMatchObject({ status: 409 });
  });
  it('enforces the 500-recipient invitation limit with an actionable error before any SQL or Microsoft call', async () => {
    const people = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `s${i}@school.test`, displayName: `Student ${i}` }));
    mocks.queries.length = 0;
    const error = await createTeamsEvent(teacher, { ...input, attendees: people(501) }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ status: 400, message: expect.stringMatching(/501 people.*at most 500.*Split the class/) });
    expect(mocks.queries).toEqual([]);
    expect(graphFetch).not.toHaveBeenCalled();
    await expect(createTeamsEvent(teacher, { ...input, attendees: people(5001) })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/5000/) });
    graphFetch.mockResolvedValue(json(201, created));
    const withDuplicates = [...people(500), ...people(20), { email: teacher.email, displayName: 'Self' }];
    await expect(createTeamsEvent(teacher, { ...input, attendees: withDuplicates })).resolves.toMatchObject({ eventId: 'AAMkEvent=' });
    expect(JSON.parse(String(graphFetch.mock.calls[0][1].body)).attendees).toHaveLength(500);
  });  it('validates synchronously without SQL, tokens or network, even when Teams is unconfigured', () => {
    for (const k of ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'TEAMS_TOKEN_KEY']) delete mocks.config[k];
    mocks.queries.length = 0;
    const value = validateTeamsEventInput(teacher, { ...input, subject: '  Maths 7A  ' });
    expect(value.subject).toBe('Maths 7A');
    expect(value.attendees).toEqual([
      { email: 'student@school.test', displayName: 'Student One' }, { email: 'two@school.test', displayName: 'Student Two' },
    ]);
    expect(() => validateTeamsEventInput(teacher, { ...input, subject: 'x'.repeat(256) })).toThrow(/subject.*255/);
    expect(() => validateTeamsEventInput(teacher, { ...input, description: 'x'.repeat(20001) })).toThrow(/20000/);
    expect(() => validateTeamsEventInput(teacher, { ...input, end: '07:00' })).toThrow(HttpError);
    expect(validateTeamsEventInput(teacher, { ...input, subject: 'x'.repeat(255) }).subject).toHaveLength(255);
    expect(mocks.queries).toEqual([]);
    expect(graphFetch).not.toHaveBeenCalled();
  });  it('rejects non-Teams join URLs', async () => {
    graphFetch.mockResolvedValue(json(201, { ...created, onlineMeeting: { joinUrl: 'https://evil.example/teams.microsoft.com' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 502 });
  });
  it('reports ambiguous timeouts with the same transactionId and does not replay', async () => {
    graphFetch.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const error = await createTeamsEvent(teacher, input).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 504 });
    expect((error as Error).message).toContain('occ-1111-2222');
    expect(graphFetch).toHaveBeenCalledTimes(1);
    graphFetch.mockReset();
    graphFetch.mockResolvedValue(json(500, { error: { code: 'generalException' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 504 });
    expect(graphFetch).toHaveBeenCalledTimes(1);
  });
  it('honours bounded Retry-After throttling', async () => {
    graphFetch.mockResolvedValueOnce(json(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(json(201, created));
    await expect(createTeamsEvent(teacher, input)).resolves.toMatchObject({ eventId: 'AAMkEvent=' });
    expect(graphFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(graphFetch.mock.calls[1][1].body)).transactionId).toBe('occ-1111-2222');
    graphFetch.mockReset();
    graphFetch.mockResolvedValue(json(429, {}, { 'Retry-After': '120' }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 503 });
    expect(graphFetch).toHaveBeenCalledTimes(1);
    graphFetch.mockReset();
    graphFetch.mockResolvedValue(json(429, {}, { 'Retry-After': '0' }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 503 });
    expect(graphFetch).toHaveBeenCalledTimes(3);
  });
  it('maps Graph 401 to an explicit reconnect error', async () => {
    graphFetch.mockResolvedValue(json(401, { error: { code: 'InvalidAuthenticationToken' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 409 });
  });
  it('cancels via the delegated cancel action and treats only ErrorItemNotFound 404 as already gone', async () => {
    graphFetch.mockResolvedValueOnce(new Response(null, { status: 202 }));
    expect(await cancelTeamsEvent(teacher, 'AAMk/Ev+nt=')).toEqual({ status: 'cancelled' });
    expect(graphFetch.mock.calls[0][0]).toBe('https://graph.microsoft.com/v1.0/me/events/AAMk%2FEv%2Bnt%3D/cancel');
    expect(graphFetch.mock.calls[0][1].method).toBe('POST');
    graphFetch.mockResolvedValueOnce(json(404, { error: { code: 'ErrorItemNotFound' } }));
    expect(await cancelTeamsEvent(teacher, 'AAMk')).toEqual({ status: 'alreadyGone' });
    graphFetch.mockResolvedValueOnce(json(404, {}));
    await expect(cancelTeamsEvent(teacher, 'AAMk')).rejects.toMatchObject({ status: 404 });
    await expect(cancelTeamsEvent(teacher, '../me')).rejects.toThrow();
    await expect(cancelTeamsEvent(student, 'AAMk')).rejects.toMatchObject({ status: 403 });
  });
});

describe('Teams cancellation contract', () => {
  beforeEach(() => seed(teacher));
  it('never reports success for a repeated cancel that Graph refuses with a non-404 status', async () => {
    graphFetch.mockResolvedValue(json(400, { error: { code: 'ErrorInvalidRequest', message: 'already cancelled' } }));
    await expect(cancelTeamsEvent(teacher, 'AAMk')).rejects.toMatchObject({ status: 502 });
    graphFetch.mockResolvedValue(json(403, { error: { code: 'ErrorAccessDenied' } }));
    await expect(cancelTeamsEvent(teacher, 'AAMk')).rejects.toMatchObject({ status: 403 });
  });
  it('reports an ambiguous cancel timeout explicitly without replaying', async () => {
    graphFetch.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const error = await cancelTeamsEvent(teacher, 'AAMk').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 504 });
    expect((error as Error).message).toMatch(/did not confirm/);
    expect(graphFetch).toHaveBeenCalledTimes(1);
  });
});
describe('Token refresh', () => {
  const refreshed = (n: number) => json(200, { token_type: 'Bearer', access_token: `new-access-${n}`, refresh_token: `new-refresh-${n}`, expires_in: 3600 });
  it('serializes refresh per user, rotates the refresh token and keeps users isolated', async () => {
    seed(teacher, { expiresAt: Date.now() - 1000 });
    mocks.teachers.add(other.id);
    seed(other, { expiresAt: Date.now() - 1000 });
    let n = 0;
    graphFetch.mockImplementation(async (href, init) => {
      if (href.endsWith('/token')) { await new Promise((r) => setTimeout(r, 20)); return refreshed(++n); }
      expect(href).toBe('https://graph.microsoft.com/v1.0/me/events');
      return json(201, created);
    });
    await Promise.all([createTeamsEvent(teacher, input), createTeamsEvent(teacher, input), createTeamsEvent(other, input)]);
    const tokenCalls = graphFetch.mock.calls.filter(([href]) => href.endsWith('/token'));
    expect(tokenCalls).toHaveLength(2);
    expect(tokenCalls.map(([, init]) => new URLSearchParams(String(init.body)).get('refresh_token')).sort()).toEqual(['refresh-5', 'refresh-6']);
    const a = decryptConnection(key, teacher.id, mocks.store.get(teacher.id)!)!;
    const b = decryptConnection(key, other.id, mocks.store.get(other.id)!)!;
    expect(a.refreshToken).not.toBe(b.refreshToken);
    expect(a.refreshToken).toMatch(/^new-refresh-/);
    expect(a.graphUserId).toBe('oid-5');
    expect(b.graphUserId).toBe('oid-6');
  });
  it('serializes refresh across separate server instances through the SQL app lock', async () => {
    seed(teacher, { expiresAt: Date.now() - 1000 });
    vi.resetModules();
    const instanceA = await import('./teams.js');
    vi.resetModules();
    const instanceB = await import('./teams.js');
    expect(instanceA).not.toBe(instanceB);
    let n = 0;
    graphFetch.mockImplementation(async (href, init) => {
      if (href.endsWith('/token')) { await new Promise((r) => setTimeout(r, 30)); return refreshed(++n); }
      return json(201, { ...created, transactionId: JSON.parse(String(init.body)).transactionId });
    });
    await Promise.all([instanceA.createTeamsEvent(teacher, input), instanceB.createTeamsEvent(teacher, { ...input, transactionId: 'occ-other-1' })]);
    const tokenCalls = graphFetch.mock.calls.filter(([href]) => href.endsWith('/token'));
    expect(tokenCalls).toHaveLength(1);
    const auth = graphFetch.mock.calls.filter(([href]) => href.endsWith('/me/events')).map(([, i]) => (i.headers as Record<string, string>).Authorization);
    expect(auth).toEqual(['Bearer new-access-1', 'Bearer new-access-1']);
    expect(decryptConnection(key, teacher.id, mocks.store.get(teacher.id)!)!.refreshToken).toBe('new-refresh-1');
  });
  it('rolls back and never writes stale tokens when the row changed outside the lock', async () => {
    seed(teacher, { expiresAt: Date.now() - 1000 });
    graphFetch.mockImplementation(async (href) => {
      if (href.endsWith('/token')) { seed(teacher, { accessToken: 'winner', refreshToken: 'winner-refresh' }); return refreshed(1); }
      return json(201, created);
    });
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 409 });
    expect(decryptConnection(key, teacher.id, mocks.store.get(teacher.id)!)!.refreshToken).toBe('winner-refresh');
    expect(mocks.rollbacks).toBe(1);
  });  it('removes a revoked connection and requires reconnect', async () => {
    seed(teacher, { expiresAt: Date.now() - 1000 });
    graphFetch.mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'revoked' }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.store.has(teacher.id)).toBe(false);
  });
  it('never logs tokens or secrets', async () => {
    const spies = (['info', 'warn', 'error'] as const).map((level) => vi.spyOn(logger, level));
    seed(teacher, { expiresAt: Date.now() - 1000 });
    graphFetch.mockResolvedValueOnce(refreshed(1)).mockResolvedValueOnce(json(500, { error: { code: 'x' } }));
    await expect(createTeamsEvent(teacher, input)).rejects.toMatchObject({ status: 504 });
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    for (const secret of ['access-5', 'refresh-5', 'new-access-1', 'new-refresh-1', 'secret-value', KEY]) expect(logged).not.toContain(secret);
  });
});