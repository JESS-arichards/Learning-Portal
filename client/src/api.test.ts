import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', { location: { origin: 'https://learn.school.test', pathname: '/classes', search: '?class=7', hash: '#resources', replace: vi.fn() } });
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
  it('uses bearer headers and no cookies for Teams JSON and binary resources', async () => {
    const session = await import('./teamsSession');
    vi.spyOn(session, 'usesTeamsSession').mockReturnValue(true);
    vi.spyOn(session, 'teamsSessionHeaders').mockReturnValue({ Authorization: 'Bearer tab-session' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"id":20}'))
      .mockResolvedValueOnce(new Response('image-data')));
    const { api, fetchResource } = await import('./api');
    await api('/me');
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/me', expect.objectContaining({
      credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer tab-session' }),
    }));
    await fetchResource('/api/me/avatar?v=1');
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://learn.school.test/api/me/avatar?v=1', expect.objectContaining({
      credentials: 'omit', headers: { Authorization: 'Bearer tab-session' },
    }));
    await expect(fetchResource('https://evil.test/api/file')).rejects.toThrow('Invalid Learning resource URL');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('clears expired Teams credentials without entering the browser cookie redirect flow', async () => {
    const session = await import('./teamsSession');
    vi.spyOn(session, 'usesTeamsSession').mockReturnValue(true);
    const clear = vi.spyOn(session, 'clearTeamsSession').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Please sign in."}', { status: 401 })));
    const { api } = await import('./api');
    await expect(api('/me')).rejects.toMatchObject({ status: 401 });
    expect(clear).toHaveBeenCalledOnce();
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});
