import type { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify, errors } from 'jose';
import { config } from './config.js';
import { getUser } from './platform.js';
import { HttpError } from './errors.js';
import { isAdmin, type User } from '../shared/learning.js';

declare global {
  namespace Express { interface Request { user?: User } }
}
const key = new TextEncoder().encode(config.SESSION_SECRET);
const cookie = 'learning_session';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
export async function issueSession(res: Response, user: User) {
  if (!user.isActive) throw new HttpError(403, 'Your account is disabled.');
  const token = await new SignJWT({ sv: user.sessionVersion })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(String(user.id))
    .setIssuer('learning-portal').setAudience('learning-portal').setIssuedAt().setExpirationTime('8h').sign(key);
  res.cookie(cookie, token, { ...cookieOptions, maxAge: 8 * 3600000 });
}
export function signOut(res: Response) {
  res.clearCookie(cookie, cookieOptions);
  res.json({ redirectUrl: `${config.APPLICATIONS_PORTAL_URL}/` });
}
export async function requireUser(req: Request, _res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[cookie];
  if (typeof token !== 'string') throw new HttpError(401, 'Please sign in.');
  let id: number;
  let version: number;
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'learning-portal', audience: 'learning-portal', algorithms: ['HS256'] });
    id = Number(payload.sub);
    version = Number(payload.sv);
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(version)) throw new HttpError(401, 'Invalid session.');
  } catch (error) {
    if (error instanceof errors.JOSEError) throw new HttpError(401, 'Session expired. Please sign in.');
    throw error;
  }
  let user: User;
  try { user = await getUser(id); }
  catch (error) { if (error instanceof HttpError && error.status === 404) throw new HttpError(401, 'Account no longer exists.'); throw error; }
  if (!user.isActive || user.sessionVersion !== version) throw new HttpError(401, 'Account changed. Please sign in again.');
  req.user = user;
  next();
}
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user || !isAdmin(req.user)) throw new HttpError(403, 'Learning Portal administrator access required.');
  next();
}
