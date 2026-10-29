import { z } from 'zod';
import { api } from './api';
import { storeTeamsSession, usesTeamsSession } from './teamsSession';

const flowKey = 'learning.teams.signin';
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const flowSchema = z.object({ state: opaque, verifier: opaque, returnTo: z.string(), expires: z.number() });
const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function safePath(value: string) {
  const path = new URL(value, window.location.origin);
  return value.startsWith('/') && !/[\\\x00-\x20\x7f]/.test(value) && path.origin === window.location.origin
    && !path.pathname.startsWith('/api/') && path.pathname !== '/teams-signin' ? value : '/';
}
export async function startTeamsSignIn() {
  if (!usesTeamsSession()) throw new Error('Teams must initialize before starting Learning sign-in.');
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const target = new URL(window.location.pathname + window.location.search + window.location.hash, window.location.origin);
  target.searchParams.delete('teams');
  const returnTo = safePath(target.pathname + target.search + target.hash);
  window.sessionStorage.setItem(flowKey, JSON.stringify({ state, verifier, returnTo, expires: Date.now() + 300_000 }));
  const { authorizationUrl } = await api<{ authorizationUrl: string }>('/auth/teams/start', 'POST', { state, codeChallenge });
  window.location.replace(authorizationUrl);
}
export async function completeTeamsSignIn() {
  if (window.location.pathname !== '/teams-signin') return;
  const query = new URLSearchParams(window.location.search);
  const state = query.get('state'), code = query.get('code');
  window.history.replaceState(null, '', '/');
  const stored = window.sessionStorage.getItem(flowKey);
  window.sessionStorage.removeItem(flowKey);
  if (!usesTeamsSession() || !stored || !opaque.safeParse(code).success) throw new Error('Teams sign-in is missing or expired. Please try again.');
  let value: unknown;
  try { value = JSON.parse(stored); }
  catch { throw new Error('Teams sign-in state is invalid. Please try again.'); }
  const parsed = flowSchema.safeParse(value);
  if (!parsed.success || parsed.data.state !== state || parsed.data.expires <= Date.now()) {
    throw new Error('Teams sign-in does not match this tab or has expired. Please try again.');
  }
  const result = await api<{ sessionToken: string }>('/auth/teams/redeem', 'POST', { code, codeVerifier: parsed.data.verifier });
  storeTeamsSession(z.string().min(20).parse(result.sessionToken));
  window.history.replaceState(null, '', safePath(parsed.data.returnTo));
}
