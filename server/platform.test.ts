import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config.js', () => ({ config: {
  APPLICATIONS_PORTAL_URL: 'https://portal.school.test',
  PLATFORM_API_KEY: 'test-key-not-a-production-credential',
} }));
import { findUsers, getUser, platform, publicConfig, platformImage, navigationFor } from './platform.js';

afterEach(() => vi.unstubAllGlobals());
describe('central platform consumer', () => {
  it('preserves the central parking label and account destinations', async () => {
    const navigation = {
      items: [], portalUrl: 'https://portal.school.test', learningUrl: 'https://learn.school.test',
      adminUrl: 'https://portal.school.test/admin',
      parkingReleaseUrl: 'https://portal.school.test/parking?release=1', parkingBay: 'A12',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(navigation))));
    expect(await navigationFor(42)).toEqual(navigation);
  });
  it('rewrites central asset URLs to same-origin image endpoints while preserving versions', async () => {
    const config = {
      branding: {
        appName: 'Portal', organisationName: 'School', primaryColor: '#123456', backgroundColor: '', textColor: '',
        accentColor: '', logoUrl: 'https://portal.school.test/api/branding/assets/logo?v=123',
        iconUrl: 'https://portal.school.test/api/branding/assets/icon', backgroundUrl: null, footerLogoUrl: null, websiteUrl: null,
      },
      profileUrl: 'https://portal.school.test/profile',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(config))));
    expect((await publicConfig()).branding).toEqual({ ...config.branding, logoUrl: '/api/branding/assets/logo?v=123', iconUrl: '/api/branding/assets/icon' });
  });
  it('transfers central image bytes server-side without forwarding browser cookies or resource policy', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('image', { headers: { 'content-type': 'image/png', 'cross-origin-resource-policy': 'same-origin' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await platformImage('/learning/assets/logo')).toEqual({ data: Buffer.from('image'), contentType: 'image/png' });
    expect(fetch).toHaveBeenCalledWith('https://portal.school.test/api/platform/v1/learning/assets/logo', expect.objectContaining({
      redirect: 'error', headers: { 'x-platform-key': 'test-key-not-a-production-credential' },
    }));
  });
  it('rejects invalid image responses and central outages rather than serving error HTML as an image', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('html', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockRejectedValueOnce(new Error('Offline'));
    vi.stubGlobal('fetch', fetch);
    await expect(platformImage('/learning/assets/logo')).rejects.toMatchObject({ status: 503 });
    await expect(platformImage('/learning/assets/logo')).rejects.toMatchObject({ status: 404 });
    await expect(platformImage('/learning/assets/logo')).rejects.toMatchObject({ status: 503 });
    await expect(platformImage('/learning/assets/logo')).rejects.toMatchObject({ status: 503 });
  });
  it('bounds image transfers and rejects malformed central menus', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } })));
    await expect(platformImage('/learning/assets/logo')).rejects.toMatchObject({ status: 503 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{ path: '//evil.test' }] }))));
    await expect(navigationFor(42)).rejects.toMatchObject({ status: 503 });
  });
  it('accepts central branding when optional website and assets are unset', async () => {
    const config = {
      branding: {
        appName: 'Applications Portal', organisationName: 'School', primaryColor: '#123456', backgroundColor: '', textColor: '',
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
