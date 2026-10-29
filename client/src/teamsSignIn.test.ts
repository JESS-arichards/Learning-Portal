import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ api: vi.fn(), store: vi.fn(), active: true }));
vi.mock('./api', () => ({ api: mocks.api }));
vi.mock('./teamsSession', () => ({ usesTeamsSession: () => mocks.active, storeTeamsSession: mocks.store }));
import { completeTeamsSignIn, startTeamsSignIn } from './teamsSignIn';

let storage: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks(); mocks.active = true; storage = new Map();
  const origin = 'https://learn.school.test';
  vi.stubGlobal('window', {
    location: { origin, pathname: '/classes', search: '?class=7', hash: '#resources', replace: vi.fn() },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    history: { replaceState: vi.fn((_state, _title, path: string) => {
      const target = new URL(path, origin);
      Object.assign(window.location, { pathname: target.pathname, search: target.search, hash: target.hash });
    }) },
  });
  mocks.api.mockImplementation(async (path) => path === '/auth/teams/start'
    ? { authorizationUrl: 'https://portal.school.test/learning-signin?teams=1&request=opaque' }
    : { sessionToken: 'learning-teams-session-token' });
});
afterEach(() => vi.unstubAllGlobals());
async function beginCallback() {
  await startTeamsSignIn();
  const flow = JSON.parse(storage.get('learning.teams.signin')!);
  Object.assign(window.location, { pathname: '/teams-signin', search: `?teams=1&state=${flow.state}&code=${'c'.repeat(43)}`, hash: '' });
  return flow;
}
describe('Teams PKCE handoff in third-party-cookie-blocked tabs', () => {
  it('keeps the verifier in tab storage and sends only the challenge when starting sign-in', async () => {
    await startTeamsSignIn();
    const flow = JSON.parse(storage.get('learning.teams.signin')!);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier)));
    const challenge = btoa(String.fromCharCode(...hash)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(mocks.api).toHaveBeenCalledWith('/auth/teams/start', 'POST', {
      state: flow.state, codeChallenge: challenge,
    });
    expect(window.location.replace).toHaveBeenCalledExactlyOnceWith('https://portal.school.test/learning-signin?teams=1&request=opaque');
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it('redeems once, scrubs the code from the URL and restores the requested deep link', async () => {
    const flow = await beginCallback();
    await completeTeamsSignIn();
    expect(mocks.api).toHaveBeenLastCalledWith('/auth/teams/redeem', 'POST', { code: 'c'.repeat(43), codeVerifier: flow.verifier });
    expect(mocks.store).toHaveBeenCalledWith('learning-teams-session-token');
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/classes?class=7#resources');
    expect(storage.has('learning.teams.signin')).toBe(false);
    await completeTeamsSignIn();
    expect(mocks.store).toHaveBeenCalledOnce();
  });
  it.each(['state', 'expiry', 'missing', 'host'])('rejects invalid %s before attempting redemption', async (kind) => {
    const flow = await beginCallback();
    if (kind === 'state') window.location.search = `?state=${'x'.repeat(43)}&code=${'c'.repeat(43)}`;
    if (kind === 'expiry') storage.set('learning.teams.signin', JSON.stringify({ ...flow, expires: Date.now() - 1 }));
    if (kind === 'missing') storage.clear();
    if (kind === 'host') mocks.active = false;
    mocks.api.mockClear();
    await expect(completeTeamsSignIn()).rejects.toThrow(/Teams sign-in/);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
    expect(window.location.search).toBe('');
  });
  it('does not restore an external return URL from modified storage', async () => {
    const flow = await beginCallback();
    storage.set('learning.teams.signin', JSON.stringify({ ...flow, returnTo: '//evil.test' }));
    await completeTeamsSignIn();
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/');
  });
});
