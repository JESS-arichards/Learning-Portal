export interface SupportSession {
  provider: 'entra' | 'otp' | 'central';
  host?: 'teams';
  user: { id: number; displayName: string; email: string; roles: readonly string[] };
  impersonation?: {
    actor: { id: number; displayName: string; email: string };
    startedAt: string;
    expiresAt: string;
  };
}

export interface BuildInfo {
  number: string;
  commit: string;
  branch: string;
  builtAt: string;
}

declare const __PORTAL_BUILD__: BuildInfo;
export const BUILD_INFO: Readonly<BuildInfo> = __PORTAL_BUILD__;

export function browserName(userAgent: string): string {
  const browsers: [string, RegExp][] = [
    ['Edge', /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],
    ['Opera', /(?:OPR|OPiOS)\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, pattern] of browsers) {
    const version = userAgent.match(pattern)?.[1];
    if (version) return `${name} ${version}`;
  }
  return 'Unrecognised browser (see user agent)';
}

export function operatingSystem(userAgent: string, platform: string, maxTouchPoints: number): string {
  if (/iPad/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'iPadOS';
  if (/iPhone|iPod/i.test(userAgent)) return 'iOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/CrOS/i.test(userAgent)) return 'ChromeOS';
  // Modern browsers report the same Windows NT version for Windows 10 and 11.
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Unrecognised OS (see user agent)';
}

export interface SupportEnvironment {
  origin: string;
  appLocation: string;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  language: string;
  timeZone: string;
  installed: boolean;
  capturedAt: string;
}

export function supportReport(session: SupportSession, environment: SupportEnvironment, build: BuildInfo = BUILD_INFO): string {
  const fields: [string, string][] = [
    ['Build number', build.number],
    ['Build branch', build.branch],
    ['Commit', build.commit],
    ['Built at (UTC)', build.builtAt],
    ['Portal', environment.origin],
    ['App location when clicked', environment.appLocation],
    ['Browser (reported)', browserName(environment.userAgent)],
    ['OS (reported)', operatingSystem(environment.userAgent, environment.platform, environment.maxTouchPoints)],
    ['App mode', environment.installed ? 'Installed / standalone' : 'Browser tab'],
    ['Language', environment.language],
    ['Time zone', environment.timeZone],
    ['Authentication', session.provider === 'central' ? 'Applications Portal SSO' : session.provider === 'entra' ? 'Microsoft Entra ID' : 'Email one-time code (OTP)'],
    ...(session.host === 'teams' ? [['Authentication host', 'Microsoft Teams SSO']] satisfies [string, string][] : []),
    ['User', session.user.displayName],
    ['Email', session.user.email],
    ['Portal user ID', String(session.user.id)],
    ['Roles', session.user.roles.join(', ') || 'None'],
    ...(session.impersonation ? [
      ['Impersonation', 'Active - User and Roles above are the impersonated identity'],
      ['Real signed-in admin', `${session.impersonation.actor.displayName} (${session.impersonation.actor.email})`],
      ['Real admin user ID', String(session.impersonation.actor.id)],
      ['Impersonation started (UTC)', session.impersonation.startedAt],
      ['Impersonation expires (UTC)', session.impersonation.expiresAt],
    ] satisfies [string, string][] : []),
    ['User agent', environment.userAgent],
    ['Captured at (UTC)', environment.capturedAt],
  ];
  return fields.map(([label, value]) => `${label}: ${value}`).join('\n');
}
