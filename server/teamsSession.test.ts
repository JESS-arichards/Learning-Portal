import express from 'express';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import { jwtVerify, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ enabled: true, platform: vi.fn(), getUser: vi.fn() }));
vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'https://portal.school.test', PUBLIC_BASE_URL: 'https://learn.school.test',
  SESSION_SECRET: 'test-learning-secret-that-is-long-enough', production: true,
  get TEAMS_ENABLED() { return mocks.enabled; },
} }));
vi.mock('./platform.js', () => ({
  platform: mocks.platform, getUser: mocks.getUser,
  parsePlatform: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
}));
import { createSsoRouter } from './sso.js';
import { requireUser, issueSession } from './auth.js';
import { errorHandler } from './errors.js';

const user = { id: 20, displayName: 'Teacher', email: 'teacher@school.test', isActive: true, sessionVersion: 3, roles: ['Staff', 'Learn User'], studentEmails: [] };
const key = new TextEncoder().encode('test-learning-secret-that-is-long-enough');
let server: Server, url: string;
beforeEach(async () => {
  vi.clearAllMocks(); mocks.enabled = true;
  mocks.getUser.mockResolvedValue(user);
  mocks.platform.mockImplementation(async (path) => path === '/learning/sso/start'
    ? { authorizationUrl: `https://portal.school.test/learning-signin?teams=1&request=${'r'.repeat(43)}` } : user);
  const app = express();
  app.use(express.json(), cookieParser());
  app.use('/api/auth', createSsoRouter());
  app.get('/me', requireUser, (req, res) => res.json(req.user));
  app.get('/browser-login', async (_req, res) => { await issueSession(res, user); res.json({ ok: true }); });
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
const post = (path: string, body: unknown) => fetch(`${url}/api/auth/teams/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
async function login() {
  const response = await post('redeem', { code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43) });
  expect(response.status).toBe(200);
  expect(response.headers.has('set-cookie')).toBe(false);
  return String((await response.json()).sessionToken);
}
describe('cookie-free Learning sessions in Teams', () => {
  it('starts the existing PKCE flow with a fixed Teams callback and no transaction cookie', async () => {
    const input = { state: 's'.repeat(43), codeChallenge: 'p'.repeat(43) };
    const response = await post('start', input);
    expect(response.status).toBe(200);
    expect(response.headers.has('set-cookie')).toBe(false);
    expect(mocks.platform).toHaveBeenCalledWith('/learning/sso/start', 'POST', { ...input, host: 'teams' });
    expect(JSON.stringify(await response.json())).not.toContain('sessionToken');
  });
  it('issues a transport-bound bearer token and revalidates the live central user', async () => {
    const token = await login();
    expect((await jwtVerify(token, key)).payload).toMatchObject({ sub: '20', sv: 3, transport: 'teams' });
    const response = await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ roles: ['Staff', 'Learn User'] });
    expect(mocks.getUser).toHaveBeenCalledWith(20);
    mocks.getUser.mockResolvedValue({ ...user, sessionVersion: 4 });
    expect((await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });
  it('does not mix Teams and browser session transports or fall back from invalid bearer credentials', async () => {
    const token = await login();
    expect((await fetch(`${url}/me`, { headers: { Cookie: `learning_session=${token}` } })).status).toBe(401);
    const browser = await fetch(`${url}/browser-login`);
    const cookie = browser.headers.get('set-cookie')!.split(';')[0];
    expect((await fetch(`${url}/me`, { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await fetch(`${url}/me`, { headers: { Authorization: `Bearer ${cookie.split('=')[1]}` } })).status).toBe(401);
    expect((await fetch(`${url}/me`, { headers: { Cookie: cookie, Authorization: 'invalid' } })).status).toBe(401);
  });
  it('retains existing browser sessions created before Teams support', async () => {
    const token = await new SignJWT({ sv: 3 }).setProtectedHeader({ alg: 'HS256' }).setSubject('20')
      .setIssuer('learning-portal').setAudience('learning-portal').setExpirationTime('1h').sign(key);
    expect((await fetch(`${url}/me`, { headers: { Cookie: `learning_session=${token}` } })).status).toBe(200);
  });
  it('rejects disabled Teams support and disabled users without issuing sessions', async () => {
    mocks.platform.mockResolvedValueOnce({ ...user, isActive: false });
    expect((await post('redeem', { code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43) })).status).toBe(403);
    mocks.enabled = false; mocks.platform.mockClear();
    expect((await post('start', { state: 's'.repeat(43), codeChallenge: 'p'.repeat(43) })).status).toBe(403);
    expect((await post('redeem', { code: 'c'.repeat(43), codeVerifier: 'v'.repeat(43) })).status).toBe(403);
    expect(mocks.platform).not.toHaveBeenCalled();
  });
  it('rejects untrusted sign-in destinations and malformed PKCE requests', async () => {
    mocks.platform.mockResolvedValueOnce({ authorizationUrl: 'https://evil.test/learning-signin?teams=1' });
    expect((await post('start', { state: 's'.repeat(43), codeChallenge: 'p'.repeat(43) })).status).toBe(503);
    expect((await post('redeem', { code: 'invalid', codeVerifier: 'v'.repeat(43) })).status).toBe(400);
  });
});
