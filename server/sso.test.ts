import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'https://portal.school.test', PUBLIC_BASE_URL: 'https://learn.school.test',
  SESSION_SECRET: 'test-learning-secret-that-is-long-enough', production: true,
} }));
vi.mock('./platform.js', () => ({
  platform: vi.fn(),
  parsePlatform: (schema: { parse: (data: unknown) => unknown }, data: unknown) => schema.parse(data),
}));
import { createSsoRouter, safeReturnPath } from './sso.js';
import { errorHandler } from './errors.js';
import { platform } from './platform.js';

let server: Server, url: string;
const student = { id: 20, displayName: 'Student', email: 'student@school.test', isActive: true, sessionVersion: 1, roles: ['Student'], department: 'Jumeirah Student', studentEmails: [] };
beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(platform).mockImplementation(async (path) => path === '/learning/sso/start'
    ? { authorizationUrl: 'https://portal.school.test/api/auth/learning/authorize?request=opaque' } : student);
  const app = express();
  app.use(cookieParser());
  app.use('/api/auth', createSsoRouter());
  app.use(errorHandler);
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); });
async function begin(returnTo = '/classes?class=7#lessons') {
  const response = await fetch(url + '/api/auth/start?returnTo=' + encodeURIComponent(returnTo), { redirect: 'manual' });
  const body = vi.mocked(platform).mock.calls.at(-1)?.[2];
  if (!body || typeof body !== 'object' || !('state' in body) || !('codeChallenge' in body)) throw new Error('Missing start request');
  return { response, state: String(body.state), challenge: String(body.codeChallenge), cookie: response.headers.get('set-cookie')!.split(';')[0] };
}
async function callback(state: string, cookie?: string, code = 'c'.repeat(43)) {
  return fetch(url + `/api/auth/callback?code=${code}&state=${state}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
}
describe('Learning centralized sign-in', () => {
  it('redirects to the central Portal with a browser-bound HttpOnly, Secure, Lax transaction cookie', async () => {
    const flow = await begin();
    expect(flow.response.status).toBe(302);
    expect(flow.response.headers.get('location')).toBe('https://portal.school.test/api/auth/learning/authorize?request=opaque');
    expect(flow.response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(flow.response.headers.get('set-cookie')).toContain('Secure');
    expect(flow.response.headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.response.headers.get('location')).not.toContain('verifier');
  });
  it('redeems server-to-server with the PKCE verifier then restores the original Learn path', async () => {
    const flow = await begin();
    const response = await callback(flow.state, flow.cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/classes?class=7#lessons');
    expect(response.headers.getSetCookie().some((c) => c.startsWith('learning_session=') && c.includes('HttpOnly') && c.includes('Secure'))).toBe(true);
    const call = vi.mocked(platform).mock.calls.at(-1)!;
    expect(call[0]).toBe('/learning/sso/redeem');
    expect(call[1]).toBe('POST');
    const body = call[2];
    if (!body || typeof body !== 'object' || !('codeVerifier' in body)) throw new Error('Missing verifier');
    expect(createHash('sha256').update(String(body.codeVerifier)).digest('base64url')).toBe(flow.challenge);
    expect(response.headers.get('location')).not.toContain('code=');
  });
  it('rejects missing cookies, malformed codes and mismatched state without redeeming', async () => {
    const flow = await begin();
    expect((await callback(flow.state)).status).toBe(400);
    expect((await callback('x'.repeat(43), flow.cookie)).status).toBe(400);
    expect((await callback(flow.state, flow.cookie, 'bad-code')).status).toBe(400);
    expect(vi.mocked(platform).mock.calls.filter(([p]) => p.endsWith('/redeem'))).toHaveLength(0);
  });
  it('rejects expired/tampered browser transactions', async () => {
    const flow = await begin();
    const expired = await new SignJWT({ state: flow.state, verifier: 'v'.repeat(43), returnTo: '/' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('learning-signin').setAudience('learning-signin')
      .setExpirationTime('1 second ago').sign(new TextEncoder().encode('test-learning-secret-that-is-long-enough'));
    expect((await callback(flow.state, `learning_signin=${expired}`)).status).toBe(400);
    expect((await callback(flow.state, flow.cookie + 'tampered')).status).toBe(400);
    expect(vi.mocked(platform).mock.calls.filter(([p]) => p.endsWith('/redeem'))).toHaveLength(0);
  });
  it('never redirects to an untrusted authorization server', async () => {
    vi.mocked(platform).mockResolvedValueOnce({ authorizationUrl: 'https://evil.test/api/auth/learning/authorize' });
    const response = await fetch(url + '/api/auth/start', { redirect: 'manual' });
    expect(response.status).toBe(503);
    expect(response.headers.has('location')).toBe(false);
    expect(response.headers.has('set-cookie')).toBe(false);
  });
  it('refuses disabled central users and never issues a local session', async () => {
    const flow = await begin();
    vi.mocked(platform).mockResolvedValueOnce({ ...student, isActive: false });
    const response = await callback(flow.state, flow.cookie);
    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().some((c) => c.startsWith('learning_session='))).toBe(false);
  });
  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', '/api/auth/start', '/login', '/%2e%2e/api/auth/start'])('does not restore unsafe return path %s', (path) => {
    expect(safeReturnPath(path)).toBe('/');
  });
  it('preserves local deep links', () => expect(safeReturnPath('/classes?class=7#lessons')).toBe('/classes?class=7#lessons'));
});
