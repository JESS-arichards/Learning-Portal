import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { location: { pathname: '/classes', search: '?class=7', hash: '#resources', replace: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());
describe('central sign-in redirection', () => {
  it('redirects an unauthenticated deep link to the server SSO flow only once', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response('{"error":"Please sign in."}', { status: 401 })));
    const { api } = await import('./api');
    await expect(api('/me')).rejects.toMatchObject({ status: 401 });
    await expect(api('/learning')).rejects.toMatchObject({ status: 401 });
    expect(window.location.replace).toHaveBeenCalledExactlyOnceWith('/api/auth/start?returnTo=%2Fclasses%3Fclass%3D7%23resources');
  });
  it('does not redirect a signed-in user for server outages or permission errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"error":"Unavailable"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"error":"Not permitted"}', { status: 403 })));
    const { api } = await import('./api');
    await expect(api('/config')).rejects.toMatchObject({ status: 503 });
    await expect(api('/admin/structure', 'PUT', [])).rejects.toMatchObject({ status: 403 });
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
