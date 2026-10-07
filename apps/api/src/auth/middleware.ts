import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from './principal.js';
import { resolvePrincipal } from './introspect.js';

function readBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(\S+)/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Exige Bearer (identificado) o crea session anónima (público).
 *
 * @remarks Sin estado: la session anónima es el uuid de `anon:<uuid>` que guarda el cliente.
 */
const ANON_PREFIX = 'anon:';

function isAnonToken(value: string): boolean {
  return value.startsWith(ANON_PREFIX);
}

function stripAnonPrefix(value: string): string {
  return value.slice(ANON_PREFIX.length);
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

export const requirePrincipal = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    await next();
    return;
  }
  const token = readBearer(c.req.header('Authorization'));

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

  const principal = await resolvePrincipal(token);

  c.set('principal', principal);
  c.set('accessToken', token);
  c.set('mcpAuth', parseMcpAuth(c.req.header('X-MCP-Auth')));
  await next();
});