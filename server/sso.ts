import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { SignJWT, jwtVerify, errors } from 'jose';
import { z } from 'zod';
import { config } from './config.js';
import { issueSession } from './auth.js';
import { HttpError } from './errors.js';
import { platform, parsePlatform } from './platform.js';
import { userSchema } from '../shared/learning.js';

const key = new TextEncoder().encode(config.SESSION_SECRET);
const flowCookie = 'learning_signin';
const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/api/auth' };
const opaque = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const flowSchema = z.object({ state: opaque, verifier: opaque, returnTo: z.string() });
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/') || value.startsWith('//')
    || /[\\\x00-\x20\x7f]/.test(value)) return '/';
  const parsed = new URL(value, config.PUBLIC_BASE_URL);
  if (parsed.origin !== new URL(config.PUBLIC_BASE_URL).origin || parsed.pathname.startsWith('/api/')
    || parsed.pathname === '/login') return '/';
  return value;
}
export function createSsoRouter() {
  const ssoRouter = Router();
  ssoRouter.use(rateLimit({
    windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many sign-in requests. Please wait a few minutes.' },
  }));
  ssoRouter.get('/start', async (req, res) => {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const returnTo = safeReturnPath(req.query.returnTo);
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url');
    const { authorizationUrl } = parsePlatform(z.object({ authorizationUrl: z.url() }),
      await platform('/learning/sso/start', 'POST', { state, codeChallenge }));
    const target = new URL(authorizationUrl);
    if (target.origin !== new URL(config.APPLICATIONS_PORTAL_URL).origin || target.pathname !== '/api/auth/learning/authorize'
      || target.username || target.password || target.hash) {
      throw new HttpError(503, 'The central Portal returned an invalid sign-in destination. Contact support.');
    }
    const flow = await new SignJWT({ state, verifier, returnTo })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('learning-signin').setAudience('learning-signin')
      .setIssuedAt().setExpirationTime('5m').sign(key);
    res.cookie(flowCookie, flow, { ...cookieOptions, maxAge: 5 * 60 * 1000 });
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(authorizationUrl);
  });
  ssoRouter.get('/callback', async (req, res) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    const query = z.object({ code: opaque, state: opaque }).strict().safeParse(req.query);
    const token: unknown = req.cookies?.[flowCookie];
    if (!query.success || typeof token !== 'string') throw new HttpError(400, 'Sign-in request is missing or expired. Start again from Learning Portal.');
    let flow: z.infer<typeof flowSchema>;
    try {
      const { payload } = await jwtVerify(token, key, { issuer: 'learning-signin', audience: 'learning-signin', algorithms: ['HS256'] });
      flow = flowSchema.parse(payload);
    } catch (error) {
      if (error instanceof errors.JOSEError || error instanceof z.ZodError) throw new HttpError(400, 'Sign-in request expired or is invalid. Start again from Learning Portal.');
      throw error;
    }
    if (!timingSafeEqual(Buffer.from(query.data.state), Buffer.from(flow.state))) {
      throw new HttpError(400, 'Sign-in state does not match this browser. Start again from Learning Portal.');
    }
    res.clearCookie(flowCookie, cookieOptions);
    const user = parsePlatform(userSchema, await platform('/learning/sso/redeem', 'POST', { code: query.data.code, codeVerifier: flow.verifier }));
    await issueSession(res, user);
    res.redirect(safeReturnPath(flow.returnTo));
  });
  return ssoRouter;
}
