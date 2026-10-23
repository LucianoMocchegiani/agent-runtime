import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { AuthServiceError, resolvePrincipal } from './service.js';
import { ACCESS_COOKIE_NAME } from './constants.js';
import { config } from '../config.js';
import { isTrustedBrowserRequest } from './csrf.js';

export { ACCESS_COOKIE_NAME } from './constants.js';
const COOKIE_PATH = '/';

type SessionBody = { token?: unknown };

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax' as const,
    path: COOKIE_PATH,
  };
}

function raiseAuthError(error: unknown): never {
  if (error instanceof AuthServiceError) {
    throw new HTTPException(error.status, { message: error.message });
  }
  throw error;
}

/** Endpoints de sesión del navegador: guardan el token en cookie HttpOnly, nunca en Web Storage. */
export const authSessionRoutes = new Hono();
authSessionRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (!isTrustedBrowserRequest(c.req.raw)) {
    return c.json({ error: 'Untrusted origin for session request' }, 403);
  }
  await next();
});

authSessionRoutes.get('/session', async (c) => {
  const token = getCookie(c, ACCESS_COOKIE_NAME);
  if (!token) return c.json({ authenticated: false });

  try {
    await resolvePrincipal(token);
    return c.json({ authenticated: true });
  } catch (error) {
    if (error instanceof AuthServiceError && error.status === 401) {
      deleteCookie(c, ACCESS_COOKIE_NAME, cookieOptions());
      return c.json({ authenticated: false });
    }
    return raiseAuthError(error);
  }
});

authSessionRoutes.post('/session', async (c) => {
  let body: SessionBody;
  try {
    body = await c.req.json<SessionBody>();
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || /\s/.test(token) || token.startsWith('anon:')) {
    throw new HTTPException(400, { message: 'A valid opaque Bearer token is required' });
  }
  if (!config.authIntrospectUrl) {
    throw new HTTPException(401, { message: 'Bearer authentication is not configured' });
  }

  try {
    await resolvePrincipal(token);
  } catch (error) {
    return raiseAuthError(error);
  }

  setCookie(c, ACCESS_COOKIE_NAME, token, cookieOptions());
  return c.json({ authenticated: true });
});

authSessionRoutes.delete('/session', (c) => {
  deleteCookie(c, ACCESS_COOKIE_NAME, cookieOptions());
  return c.json({ authenticated: false });
});
