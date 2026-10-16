import { timingSafeEqual } from 'node:crypto';
import { resolvePrincipal } from '../auth/introspect.js';

function matchesSecret(actualValue: string, expectedValue: string | undefined): boolean {
  if (!expectedValue) return false;
  const actual = Buffer.from(actualValue);
  const expected = Buffer.from(expectedValue);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Comprueba si el encabezado autoriza la administración de la configuración runtime.
 * @param header Valor de `Authorization` recibido en la solicitud.
 * @returns `true` para el token de administrador o una identidad allowlisted.
 */
export async function authorized(header: string | undefined): Promise<boolean> {
  const value = header?.trim() ?? '';
  const configuredAdmins = (process.env.RUNTIME_CONFIG_ADMIN_USERS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  // Bootstrap credentials are enabled only until an admin identity is configured.
  // Credentials are never accepted alongside a non-empty allowlist.
  if (configuredAdmins.length === 0) {
    const basic = /^Basic\s+([A-Za-z0-9+/]+=*)$/i.exec(value);
    if (basic) {
      let decoded: string;
      try { decoded = Buffer.from(basic[1], 'base64').toString('utf8'); } catch { return false; }
      const separator = decoded.indexOf(':');
      if (separator < 0) return false;
      const username = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      const expectedUsername = process.env.RUNTIME_CONFIG_BOOTSTRAP_USER?.trim() || 'admin';
      const expectedPassword = process.env.RUNTIME_CONFIG_BOOTSTRAP_PASSWORD ?? 'admin';
      return matchesSecret(username, expectedUsername) && matchesSecret(password, expectedPassword);
    }
  }

  const match = /^Bearer\s+(\S+)$/i.exec(value);
  if (!match) return false;
  const token = match[1];

  // Keep the server-side admin token for automation/CLI, but never provide it to the UI.
  if (matchesSecret(token, process.env.RUNTIME_CONFIG_ADMIN_TOKEN?.trim())) return true;

  // Browser access is granted only to authenticated identities explicitly allowlisted by an operator.
  // Anonymous session ids used by the chat UI are deliberately not accepted here.
  if (token.startsWith('anon:') || configuredAdmins.length === 0) return false;

  const principal = await resolvePrincipal(token);
  return configuredAdmins.some((identity) =>
    principal.userId === identity || principal.email?.toLowerCase() === identity.toLowerCase(),
  );
}
