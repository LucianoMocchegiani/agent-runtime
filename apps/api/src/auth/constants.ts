/** Tiempo durante el que una identidad introspectada puede reutilizarse en caché. */
export const AUTH_CACHE_TTL_MS = 30_000;

/** Cantidad máxima de identidades que conserva la caché de introspección. */
export const AUTH_CACHE_MAX_ENTRIES = 256;

/** Límite de espera para el servicio externo de introspección. */
export const AUTH_INTROSPECT_TIMEOUT_MS = 8_000;

/** Prefijo reservado para tokens de sesión anónima emitidos por la API. */
export const ANONYMOUS_TOKEN_PREFIX = 'anon:';
