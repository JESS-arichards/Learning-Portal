import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'https://portal.school.test',
  PLATFORM_API_KEY: 'test-key-not-a-production-credential',
} }));
import { findUsers, getUser, platform, publicConfig } from './platform.js';

afterEach(() => vi.unstubAllGlobals());
describe('central platform consumer', () => {
  it('accepts central branding when optional website and assets are unset', async () => {
    const config = {
      branding: {
        organisationName: 'School', primaryColor: '#123456', backgroundColor: '', textColor: '',
        accentColor: '', logoUrl: null, iconUrl: null, backgroundUrl: null, footerLogoUrl: null, websiteUrl: null,
      },
      profileUrl: 'https://portal.school.test/profile',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(config), { status: 200 })));
    expect(await publicConfig()).toEqual(config);
  });
  it('sends service credentials only server-side, disables redirects, and has a timeout', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ users: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await findUsers(['teacher@school.test'])).toEqual([]);
    expect(fetch).toHaveBeenCalledWith('https://portal.school.test/api/platform/v1/users/lookup', expect.objectContaining({
      method: 'POST', redirect: 'error',
      headers: expect.objectContaining({ 'x-platform-key': 'test-key-not-a-production-credential' }),
      body: JSON.stringify({ emails: ['teacher@school.test'] }),
      signal: expect.any(AbortSignal),
    }));
  });
  it('fails closed on network errors and non-JSON upstream responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));
    await expect(getUser(1)).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })));
    await expect(getUser(1)).rejects.toMatchObject({ status: 503 });
  });
  it('treats a malformed central profile as an integration failure, never a local user', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, roles: ['Learn Admin'] }), { status: 200 })));
    await expect(getUser(1)).rejects.toMatchObject({ status: 503 });
  });
  it('preserves central authentication errors and maps central failures to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Invalid code' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500 })));
    await expect(platform('/otp/verify', 'POST', {})).rejects.toMatchObject({ status: 401, message: 'Invalid code' });
    await expect(platform('/learning/config')).rejects.toMatchObject({ status: 503 });
  });
});
