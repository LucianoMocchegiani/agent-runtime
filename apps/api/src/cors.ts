/**
 * CORS del agent-runtime: lista `CORS_ORIGIN`, `*.localhost` y opcional `CORS_APP_DOMAIN`.
 * Portable: el huésped define el dominio.
 */

export function isLocalTenantOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    return /^[a-z0-9-]+\.localhost$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export function isAppDomainOrigin(origin: string, domain: string | null): boolean {
  if (!domain) {
    return false;
  }
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
    const host = url.hostname.toLowerCase();
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/**
 * Origin echo para Hono: refleja el Origin si está permitido.
 */
export function allowCorsOrigin(
  origin: string,
  exact: string[],
  appDomain: string | null,
): string | undefined {
  if (
    exact.includes(origin) ||
    isLocalTenantOrigin(origin) ||
    isAppDomainOrigin(origin, appDomain)
  ) {
    return origin;
  }
  return undefined;
}
