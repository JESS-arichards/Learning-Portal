import { describe, expect, it } from 'vitest';
import { BUILD_INFO, browserName, operatingSystem, supportReport, type SupportEnvironment, type SupportSession } from './supportInfo';

describe('support environment detection', () => {
  it.each([
    ['Mozilla Chrome/130.0 Safari/537.36 Edg/130.1', 'Edge 130.1'],
    ['Mozilla Chrome/130.0 Safari/537.36 OPR/115.1', 'Opera 115.1'],
    ['Mozilla Chrome/130.0 Safari/537.36', 'Chrome 130.0'],
    ['Mozilla CriOS/130.1 Mobile Safari/604.1', 'Chrome 130.1'],
    ['Mozilla Firefox/132.0', 'Firefox 132.0'],
    ['Mozilla FxiOS/132.1 Mobile Safari/604.1', 'Firefox 132.1'],
    ['Mozilla Version/18.0 Mobile Safari/604.1', 'Safari 18.0'],
    ['Mozilla EdgiOS/130.1 Mobile Safari/604.1', 'Edge 130.1'],
  ])('identifies browser from %s', (ua, expected) => {
    expect(browserName(ua)).toBe(expected);
  });
  it.each([
    ['iPad', 'iPad', 5, 'iPadOS'], ['Macintosh', 'MacIntel', 5, 'iPadOS'],
    ['iPhone OS 18_0', 'iPhone', 5, 'iOS'], ['Android Linux', 'Linux', 5, 'Android'],
    ['CrOS Linux', 'Linux', 0, 'ChromeOS'], ['Windows NT 10.0', 'Win32', 0, 'Windows'],
    ['Macintosh', 'MacIntel', 0, 'macOS'], ['Linux', 'Linux', 0, 'Linux'],
  ])('identifies OS without claiming Windows 10 vs 11 or mistaking iPad for Mac: %s', (ua, platform, touch, expected) => {
    expect(operatingSystem(ua, platform, touch)).toBe(expected);
  });
  it('explicitly labels unrecognised environments', () => {
    expect(browserName('custom')).toContain('Unrecognised');
    expect(operatingSystem('custom', '', 0)).toContain('Unrecognised');
  });
});

describe('support report', () => {
  const session = {
    provider: 'entra', user: { id: 7, displayName: 'Test User', email: 'test@example.org', roles: ['Staff', 'Staff Absence Admin'] },
    accessToken: 'SECRET-TOKEN', cookie: 'SECRET-COOKIE',
  } as SupportSession & { accessToken: string; cookie: string };
  const environment: SupportEnvironment = {
    origin: 'https://portal.example.org', appLocation: '/admin/staff-absence', userAgent: 'Windows NT 10.0 Chrome/130.0 Safari/537.36',
    platform: 'Win32', maxTouchPoints: 0, language: 'en-GB', timeZone: 'Asia/Dubai',
    installed: false, capturedAt: '2026-10-21T05:00:00.000Z',
  };
  const build = { number: '123.2', commit: 'abc123', branch: 'development', builtAt: '2026-10-21T04:00:00.000Z' };
  it('distinguishes the effective user from the real signed-in administrator without exposing session identifiers', () => {
    const impersonatedSession = {
      ...session, impersonation: {
        id: 'PRIVATE-CONTEXT',
        actor: { id: 9, displayName: 'Real Admin', email: 'admin@school.org' },
        startedAt: '2026-10-21T04:30:00Z', expiresAt: '2026-10-21T05:30:00Z',
      },
    };
    const report = supportReport(impersonatedSession, environment, build);
    expect(report).toContain('User: Test User');
    expect(report).toContain('Impersonation: Active');
    expect(report).toContain('Real signed-in admin: Real Admin (admin@school.org)');
    expect(report).toContain('Real admin user ID: 9');
    expect(report).not.toContain('PRIVATE-CONTEXT');
  });
  it('includes requested support details and only explicitly allowlisted session fields', () => {
    const report = supportReport(session, environment, build);
    for (const value of ['123.2', 'abc123', 'development', build.builtAt, 'Chrome 130.0', 'Windows', 'Microsoft Entra ID',
      'Test User', 'test@example.org', 'Portal user ID: 7', 'Staff, Staff Absence Admin', 'Asia/Dubai', 'en-GB', environment.userAgent]) {
      expect(report).toContain(value);
    }
    expect(report).not.toContain('SECRET');
    expect(report).toContain('App location when clicked: /admin/staff-absence');
    expect(report).toContain('App mode: Browser tab');
  });
  it('uses actual session authentication, not inferred roles or Entra profile flags', () => {
    const report = supportReport({ ...session, provider: 'otp' }, { ...environment, installed: true }, build);
    expect(report).toContain('Authentication: Email one-time code (OTP)');
    expect(report).toContain('Installed / standalone');
    expect(report).not.toContain('Microsoft Entra ID');
  });
  it('identifies central portal sign-in without guessing the upstream authentication provider', () => {
    const report = supportReport({ ...session, provider: 'central' }, environment, build);
    expect(report).toContain('Authentication: Applications Portal SSO');
    expect(report).not.toContain('Microsoft Entra ID');
  });
  it('has embedded build metadata with an ISO timestamp and distinct build identity', () => {
    expect(BUILD_INFO.number.length).toBeGreaterThan(0);
    expect(BUILD_INFO.commit.length).toBeGreaterThan(0);
    expect(new Date(BUILD_INFO.builtAt).toISOString()).toBe(BUILD_INFO.builtAt);
    expect(supportReport(session, environment)).toContain(`Build number: ${BUILD_INFO.number}`);
  });
});
