import { createHash } from 'node:crypto';
import { config } from '../config.js';
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
function parseIntrospectBody(body: unknown): {
  userId: string;
  email: string | null;
  name: string | null;
} {
  const record = asRecord(body);
  if (!record) {
    throw new AuthServiceError(502, 'Introspect response is not JSON object');
  }
  const m = config.authMapping;
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

/**
 * Resuelve la identidad reenviando el Bearer al servicio configurado de introspección.
 * @param token Token Bearer recibido del cliente.
 * @returns Principal identificado por el servicio de autenticación.
 * @remarks Usa una caché breve indexada por hash; no valida localmente firmas JWT.
 * @throws {AuthServiceError} 401 si el token es inválido; 502 si falla la introspección o su respuesta.
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
      signal: AbortSignal.timeout(AUTH_INTROSPECT_TIMEOUT_MS),
    });
  } catch {
    throw new AuthServiceError(502, 'Auth introspection unavailable');
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthServiceError(401, 'Unauthorized');
  }
  if (!response.ok) {
    throw new AuthServiceError(502, 'Auth introspection failed');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthServiceError(502, 'Auth introspection returned non-JSON');
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
