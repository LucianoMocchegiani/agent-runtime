import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import type { AppEnv, Principal } from './contracts.js';
import { AuthServiceError, resolvePrincipal } from './service.js';
import { ANONYMOUS_TOKEN_PREFIX, ACCESS_COOKIE_NAME } from './constants.js';
import { config } from '../config.js';
import { isTrustedBrowserRequest } from './csrf.js';

function readBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Middleware que asocia a la petición un principal identificado o una sesión anónima.
 * @remarks No mantiene estado: el cliente conserva el UUID como `anon:<uuid>`; sin Bearer se crea una sesión nueva.
 */
function isAnonToken(value: string): boolean {
  return value.startsWith(ANONYMOUS_TOKEN_PREFIX);
}

function stripAnonPrefix(value: string): string {
  return value.slice(ANONYMOUS_TOKEN_PREFIX.length);
}

function parseMcpAuth(header: string | undefined): Record<string, string> | null {
  if (!header) {
    return null;
  }
  try {
    const parsed = JSON.parse(header) as Record<string, string>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Valida la identidad y carga principal, token y credenciales MCP en el contexto Hono. */
export const requirePrincipal = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }
  const bearer = readBearer(c.req.header('Authorization'));
  const cookieToken = getCookie(c, ACCESS_COOKIE_NAME) ?? null;
  // La cookie segura de sesión reemplaza el UUID anónimo del cliente, pero un Bearer
  // explícito no anónimo sigue teniendo precedencia para integraciones/API clients.
  const token = bearer && !isAnonToken(bearer) ? bearer : cookieToken ?? bearer;
  const usesCookieToken = cookieToken !== null && (!bearer || isAnonToken(bearer));
  if (usesCookieToken && !isTrustedBrowserRequest(c.req.raw)) {
    throw new HTTPException(403, { message: 'Untrusted origin for cookie-authenticated request' });
  }

  if (token && isAnonToken(token)) {
    const sessionId = stripAnonPrefix(token);
    const principal = {
      userId: sessionId,
      email: null,
      name: null,
    };
    c.set('principal', principal);
    c.set('accessToken', token);
    c.set('mcpAuth', parseMcpAuth(c.req.header('X-MCP-Auth')));
    await next();
    return;
  }

  // Sin introspección, un Bearer opaco no se puede validar. Rechazarlo explícitamente
  // evita que la petición continúe con una identidad anónima distinta a la esperada.
  if (!config.authIntrospectUrl && token) {
    throw new HTTPException(401, { message: 'Bearer authentication is not configured' });
  }

  // En modo público se permiten solicitudes sin Bearer, con identidad anónima por petición.
  if (!config.authIntrospectUrl) {
    const sessionId = randomUUID();
    c.set('principal', { userId: sessionId, email: null, name: null });
    c.set('accessToken', '');
    c.set('mcpAuth', parseMcpAuth(c.req.header('X-MCP-Auth')));
    await next();
    return;
  }

  if (!token) {
    const sessionId = randomUUID();
    const principal = {
      userId: sessionId,
      email: null,
      name: null,
    };
    c.set('principal', principal);
    c.set('accessToken', '');
    c.set('mcpAuth', parseMcpAuth(c.req.header('X-MCP-Auth')));
    await next();
    return;
  }

  let principal: Principal;
  try {
    principal = await resolvePrincipal(token);
  } catch (error) {
    if (error instanceof AuthServiceError) throw new HTTPException(error.status, { message: error.message });
    throw error;
  }

  c.set('principal', principal);
  c.set('accessToken', token);
  c.set('mcpAuth', parseMcpAuth(c.req.header('X-MCP-Auth')));
  await next();
});