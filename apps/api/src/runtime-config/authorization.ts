import { timingSafeEqual } from 'node:crypto';
import { ANONYMOUS_TOKEN_PREFIX, ACCESS_COOKIE_NAME } from '../auth/constants.js';
import type { Principal } from '../auth/contracts.js';
import { resolvePrincipal } from '../auth/service.js';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { isTrustedBrowserRequest } from '../auth/csrf.js';
import { prisma } from '../db/prisma.js';

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Cuenta local de recuperación: independiente del proveedor de auth y de la lista dinámica. */
function fallbackAdmin(header: string | undefined): Principal | null {
  const match = /^Basic\s+(\S+)$/i.exec(header?.trim() ?? '');
  if (!match) return null;

  let credentials: string;
  try {
    credentials = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const separator = credentials.indexOf(':');
  if (separator < 0) return null;

  const username = process.env.RUNTIME_ADMIN_USERNAME || 'admin';
  const password = process.env.RUNTIME_ADMIN_PASSWORD || 'admin';
  if (!constantTimeEqual(credentials.slice(0, separator), username)
    || !constantTimeEqual(credentials.slice(separator + 1), password)) return null;

  return { userId: 'fallback-admin', email: null, name: 'Fallback admin' };
}

/** Autoriza la cuenta local de recuperación o un usuario verificado presente en la base de datos. */
export async function authorizedPrincipal(header: string | undefined): Promise<Principal | null> {
  const recoveryPrincipal = fallbackAdmin(header);
  if (recoveryPrincipal) return recoveryPrincipal;

  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  if (!match || match[1].startsWith(ANONYMOUS_TOKEN_PREFIX)) return null;

  try {
    const principal = await resolvePrincipal(match[1]);
    const admin = await prisma.runtimeAdmin.findUnique({ where: { userId: principal.userId } });
    return admin ? principal : null;
  } catch {
    // Autenticación o base de datos indisponibles: denegar siempre.
    return null;
  }
}

/**
 * Autoriza una petición administrativa mediante Bearer explícito, cuenta Basic de recuperación
 * o cookie de sesión. Para credenciales ambientales exige un origen confiable (protección CSRF).
 */
export async function authorizedAdminRequest(c: Context): Promise<Principal | null> {
  const header = c.req.header('Authorization');
  const cookieToken = getCookie(c, ACCESS_COOKIE_NAME);

  if (header?.trim()) {
    if (/^Basic\s/i.test(header) && !isTrustedBrowserRequest(c.req.raw)) return null;
    return authorizedPrincipal(header);
  }

  if (!cookieToken || !isTrustedBrowserRequest(c.req.raw)) return null;
  return authorizedPrincipal(`Bearer ${cookieToken}`);
}

/** Comprueba si el encabezado corresponde a una identidad administradora persistida. */
export async function authorized(header: string | undefined): Promise<boolean> {
  return (await authorizedPrincipal(header)) !== null;
}
