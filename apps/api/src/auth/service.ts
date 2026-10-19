import { createHash } from 'node:crypto';
import { config, type AuthMapping } from '../config.js';
import type { Principal } from './contracts.js';
import { AUTH_CACHE_MAX_ENTRIES, AUTH_CACHE_TTL_MS, AUTH_INTROSPECT_TIMEOUT_MS } from './constants.js';

/** Error de autenticación independiente de HTTP, traducible por los adaptadores de entrada. */
export class AuthServiceError extends Error {
  constructor(readonly status: 401 | 502, message: string) {
    super(message);
    this.name = 'AuthServiceError';
  }
}

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

export function clearAuthCache(): void {
  cache.clear();
}

function cacheSet(key: string, principal: Principal): void {
  if (cache.size >= AUTH_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) {
      cache.delete(oldest);
    }
  }
  cache.set(key, {
    principal,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
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
 * Mapea la respuesta JSON del servicio de introspección al contrato portable de identidad.
 * @param body Cuerpo sin validar devuelto por el servicio.
 * @returns Identificador de usuario y atributos opcionales configurados.
 * @throws {AuthServiceError} 502 si la respuesta no es válida o no contiene `userId`.
 */
function parseIntrospectBody(body: unknown, m: AuthMapping): {
  userId: string;
  email: string | null;
  name: string | null;
} {
  const record = asRecord(body);
  if (!record) {
    throw new AuthServiceError(502, 'Introspect response is not JSON object');
  }
  const userId = readString(record, m.userId);
  if (!userId) {
    throw new AuthServiceError(502, 'Introspect response missing userId');
  }
  return {
    userId,
    email: m.email ? readString(record, m.email) : null,
    name: m.name ? readString(record, m.name) : null,
  };
}

/** Llama al endpoint y traduce su JSON sin escribir en caché (usado también por la prueba administrativa). */
export async function testAuthIntrospection(introspectUrl: string, mapping: AuthMapping, token: string): Promise<Principal> {
  let response: Response;
  try {
    response = await fetch(introspectUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(AUTH_INTROSPECT_TIMEOUT_MS),
    });
  } catch {
    throw new AuthServiceError(502, 'Auth introspection unavailable');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthServiceError(401, 'Unauthorized: the introspection endpoint rejected this token');
  }
  if (!response.ok) {
    throw new AuthServiceError(502, `Auth introspection failed with HTTP ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthServiceError(502, 'Auth introspection returned non-JSON');
  }

  const parsed = parseIntrospectBody(body, mapping);
  return { userId: parsed.userId, email: parsed.email, name: parsed.name };
}

/**
 * Resuelve la identidad reenviando el Bearer al servicio configurado de introspección.
 * @remarks Usa una caché breve indexada por hash; no valida localmente firmas JWT.
 */
export async function resolvePrincipal(token: string): Promise<Principal> {
  const introspectUrl = config.authIntrospectUrl;
  if (!introspectUrl) throw new AuthServiceError(401, 'Bearer authentication is not configured');

  const key = tokenCacheKey(token);
  const cached = cacheGet(key);
  if (cached) return cached;

  const principal = await testAuthIntrospection(introspectUrl, config.authMapping, token);
  cacheSet(key, principal);
  return principal;
}
