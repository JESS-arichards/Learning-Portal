import { clearTeamsSession, teamsSessionHeaders, usesTeamsSession } from './teamsSession';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
let redirecting = false;
export function redirectToSignIn() {
  if (redirecting) return;
  redirecting = true;
  window.location.replace(`/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname + window.location.search + window.location.hash)}`);
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    method, credentials: usesTeamsSession() ? 'omit' : 'same-origin',
    headers: { 'x-requested-with': 'learning-portal', ...teamsSessionHeaders(), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }),
  });
  if (response.status === 401) {
    if (usesTeamsSession()) clearTeamsSession();
    else redirectToSignIn();
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApiError(response.status || 503, 'The service returned an invalid response. Please try again or contact support.'); }
  if (typeof data !== 'object' || data === null) throw new ApiError(503, 'The service returned an invalid response. Please contact support.');
  if (!response.ok) throw new ApiError(response.status, 'error' in data && typeof data.error === 'string' ? data.error : 'Request failed. Please try again.');
  return data as T;
}
export async function fetchResource(path: string, signal?: AbortSignal): Promise<Response> {
  const url = new URL(path, window.location.origin);
  if (!path.startsWith('/api/') || url.origin !== window.location.origin) throw new Error('Invalid Learning resource URL.');
  const response = await fetch(url.toString(), {
    credentials: usesTeamsSession() ? 'omit' : 'same-origin', headers: teamsSessionHeaders(), signal,
  });
  if (response.status === 401) {
    if (usesTeamsSession()) clearTeamsSession();
    else redirectToSignIn();
  }
  if (!response.ok) throw new ApiError(response.status, 'Unable to load this resource. Please sign in again or retry.');
  return response;
}
export function fileBody(file: File) { const data = new FormData(); data.append('file', file); return data; }
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
