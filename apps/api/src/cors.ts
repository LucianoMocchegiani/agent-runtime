/**
 * Reglas CORS de agent-runtime: lista exacta, tenants `.localhost` y dominio opcional del huésped.
 */

/** Acepta orígenes HTTP(S) con subdominio tenant bajo `.localhost`. */
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

/** Acepta el dominio de aplicación configurado y cualquiera de sus subdominios. */
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

/** Devuelve el origen para que Hono lo refleje solo si coincide con una regla permitida. */
/**
 * Comprueba si un origen puede reflejarse en la respuesta CORS.
 * @param origin Origen solicitado por el navegador.
 * @param exact Lista de orígenes permitidos explícitamente.
 * @param appDomain Dominio del huésped y sus subdominios, o `null`.
 * @returns El origen permitido o `undefined` para denegarlo.
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
