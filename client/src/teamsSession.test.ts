import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), context: vi.fn(), success: vi.fn() }));
vi.mock('@microsoft/teams-js', () => ({
  app: { initialize: mocks.initialize, getContext: mocks.context, notifySuccess: mocks.success },
  HostName: { teams: 'Teams', teamsModern: 'teamsModern' },
}));
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); storage = new Map();
  vi.stubGlobal('window', {
    location: { search: '' },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  mocks.initialize.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({ app: { host: { name: 'Teams' } } });
});
afterEach(() => vi.unstubAllGlobals());
describe('Learning Teams host and tab-local sessions', () => {
  it('does not initialize the SDK or send bearer credentials for browser visits', async () => {
    const host = await import('./teamsSession');
    expect(await host.initializeTeamsSession()).toBe(false);
    expect(host.teamsSessionHeaders()).toEqual({});
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it('checks the actual Teams host before restoring tab-local bearer credentials', async () => {
    storage.set('learning.teams.mode', '1');
    storage.set('learning.teams.session', 'stored-session');
    const host = await import('./teamsSession');
    expect(await host.initializeTeamsSession()).toBe(true);
    expect(host.teamsSessionHeaders()).toEqual({ Authorization: 'Bearer stored-session' });
    expect(storage.get('learning.teams.mode')).toBe('1');
    host.storeTeamsSession('renewed-session');
    expect(host.teamsSessionHeaders()).toEqual({ Authorization: 'Bearer renewed-session' });
    host.clearTeamsSession();
    expect(host.teamsSessionHeaders()).toEqual({});
    expect(storage.has('learning.teams.session')).toBe(false);
    expect(mocks.success).toHaveBeenCalledOnce();
  });
  it('starts fresh when entering from the Portal so a previous Learning identity is not reused', async () => {
    window.location.search = '?teams=1';
    storage.set('learning.teams.session', 'previous-identity');
    const host = await import('./teamsSession');
    expect(await host.initializeTeamsSession()).toBe(true);
    expect(host.teamsSessionHeaders()).toEqual({});
    expect(storage.has('learning.teams.session')).toBe(false);
  });
  it('restores mode on deep-link reloads and does not silently downgrade an invalid host', async () => {
    storage.set('learning.teams.mode', '1');
    const host = await import('./teamsSession');
    mocks.context.mockResolvedValueOnce({ app: { host: { name: 'untrusted' } } });
    await expect(host.initializeTeamsSession()).rejects.toThrow('Unable to connect Learning to Teams');
    expect(host.usesTeamsSession()).toBe(false);
    expect(host.teamsSessionHeaders()).toEqual({});
    await expect(host.initializeTeamsSession()).resolves.toBe(true);
  });
});
