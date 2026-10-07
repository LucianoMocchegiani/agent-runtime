import { createHash } from 'node:crypto';
import { HTTPException } from 'hono/http-exception';
import { config } from '../config.js';
import type { Principal } from './principal.js';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 256;
const INTROSPECT_TIMEOUT_MS = 8_000;

type CacheEntry = {
  principal: Principal;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

function tokenCacheKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function cacheGet(key: string): Principal | null {
  const hit = cache.get(key);
  if (!hit) {
    return null;
  }
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.principal;
}

function cacheSet(key: string, principal: Principal): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }
  cache.set(key, {
    principal,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Mapea el JSON de `AUTH_INTROSPECT_URL` al contrato portable.
 *
 * @throws {HTTPException} 502 si el cuerpo no trae `userId`.
 */
function parseIntrospectBody(body: unknown): {
  userId: string;
  email: string | null;
  name: string | null;
} {
  const record = asRecord(body);
  if (!record) {
    throw new HTTPException(502, { message: 'Introspect response is not JSON object' });
  }
  const m = config.authMapping;
  const userId = readString(record, m.userId);
  if (!userId) {
    throw new HTTPException(502, {
      message: 'Introspect response missing userId',
    });
  }
  return {
    userId,
    email: m.email ? readString(record, m.email) : null,
    name: m.name ? readString(record, m.name) : null,
  };
}

/**
 * Resuelve el principal reenviando el Bearer a `AUTH_INTROSPECT_URL`.
 *
 * @remarks Cache ~30s por hash del token. No verifica firma JWT.
 * @throws {HTTPException} 401 token inválido; 403 perfil/tenant; 502 introspect caído.
 */
export async function resolvePrincipal(token: string): Promise<Principal> {
  const key = tokenCacheKey(token);
  const cached = cacheGet(key);
  if (cached) {
    return cached;
  }

  let response: Response;
  try {
    response = await fetch(config.authIntrospectUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(INTROSPECT_TIMEOUT_MS),
    });
  } catch {
    throw new HTTPException(502, { message: 'Auth introspection unavailable' });
  }

  if (response.status === 401 || response.status === 403) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  if (!response.ok) {
    throw new HTTPException(502, { message: 'Auth introspection failed' });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new HTTPException(502, { message: 'Auth introspection returned non-JSON' });
  }

  const parsed = parseIntrospectBody(body);
  const principal: Principal = {
    userId: parsed.userId,
    email: parsed.email,
    name: parsed.name,
  };
  cacheSet(key, principal);
  return principal;
}
