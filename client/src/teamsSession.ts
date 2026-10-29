let active = false;
let token: string | null = null;
let initialization: Promise<boolean> | null = null;
const modeKey = 'learning.teams.mode';
const sessionKey = 'learning.teams.session';

export function usesTeamsSession() { return active; }
export function teamsSessionHeaders(): Record<string, string> {
  return active && token ? { Authorization: `Bearer ${token}` } : {};
}
export function storeTeamsSession(value: string) {
  window.sessionStorage.setItem(sessionKey, value);
  token = value;
}
export function clearTeamsSession() {
  window.sessionStorage.removeItem(sessionKey);
  token = null;
}
export async function initializeTeamsSession(): Promise<boolean> {
  if (active) return true;
  const freshEntry = new URLSearchParams(window.location.search).get('teams') === '1';
  let requested = freshEntry;
  if (!requested) {
    try { requested = window.sessionStorage.getItem(modeKey) === '1'; }
    catch {
      console.warn('Browser session storage is unavailable; Learning Teams mode cannot be restored.');
      return false;
    }
  }
  if (!requested) return false;
  initialization ??= (async () => {
    try {
      const teams = await import('@microsoft/teams-js');
      await teams.app.initialize();
      const context = await teams.app.getContext();
      if (context.app.host.name !== teams.HostName.teams && context.app.host.name !== teams.HostName.teamsModern) {
        throw new Error('Unsupported embedding host.');
      }
      window.sessionStorage.setItem(modeKey, '1');
      if (freshEntry) window.sessionStorage.removeItem(sessionKey);
      token = window.sessionStorage.getItem(sessionKey);
      active = true;
      teams.app.notifySuccess();
      return true;
    } catch {
      active = false;
      token = null;
      throw new Error('Unable to connect Learning to Teams. Reopen the Portal Teams app and check its Learning domain configuration.');
    }
  })();
  try { return await initialization; }
  catch (error) { initialization = null; throw error; }
}
